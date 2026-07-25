// agentes/meli-scraper.js
// Raspa repuestos usados desde la API pública de MercadoLibre Chile
// y los guarda en listings_externos para mostrar en la vitrina.
// Las imágenes de mlstatic.com son URLs permanentes — no expiran.
// Uso: node agentes/meli-scraper.js

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { guardarListingsExternos, contarListingsExternos } = require("./supabase-client");

const SITE     = "MLC";
const CATEGORY = "MLC174408"; // Repuestos para Autos y Camionetas
const BASE_URL = "https://api.mercadolibre.com";

const DELAY = (ms) => new Promise((r) => setTimeout(r, ms));

const BUSQUEDAS = [
  "alternador auto",
  "motor arranque auto",
  "radiador auto",
  "suspension delantera auto",
  "amortiguador auto",
  "caja cambios manual",
  "frenos disco auto",
  "pastillas freno auto",
  "disco freno auto",
  "bomba combustible auto",
  "bomba agua motor",
  "embrague auto",
  "turbo auto diesel",
  "inyector gasolina auto",
  "transmision automatica auto",
  "culata motor",
  "diferencial trasero auto",
  "correa distribucion auto",
  "sensor oxigeno auto",
  "alternador toyota",
  "repuestos toyota hilux",
  "repuestos toyota corolla",
  "repuestos nissan np300",
  "repuestos hyundai accent",
  "repuestos chevrolet sail",
  "repuestos kia rio",
  "repuestos mazda 3",
  "repuestos ford ranger",
  "repuestos suzuki alto",
  "repuestos renault duster",
];

async function buscarListings(query) {
  const params = new URLSearchParams({
    q:         query,
    limit:     "50",
    offset:    "0",
    condition: "used",
    category:  CATEGORY,
  });

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${BASE_URL}/sites/${SITE}/search?${params}`, {
      headers: { Accept: "application/json" },
      signal:  controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return [];

    const data = await res.json();

    return (data.results ?? []).map((item) => ({
      fuente:          "mercadolibre",
      titulo:          item.title ?? null,
      precio:          Math.round(item.price ?? 0),
      // mlstatic.com URLs son permanentes — se muestran directo sin subir a Storage
      imagen:          item.thumbnail
        ? item.thumbnail.replace("-I.jpg", "-O.jpg").replace(/^http:/, "https:")
        : null,
      descripcion:     item.title ?? null,
      url_original:    item.permalink,
      categoria:       null,
      marca:           null,
      modelo:          null,
      vendedor_nombre: item.seller?.nickname ?? null,
      ubicacion:       item.address?.city_name ?? "Chile",
    }));
  } catch (err) {
    clearTimeout(timeout);
    if (err.name !== "AbortError") throw err;
    return [];
  }
}

async function ejecutar() {
  console.log("🔍 Agente MeLi Scraper — iniciando...\n");

  const todos = new Map(); // url_original → item (deduplicar)

  for (const busqueda of BUSQUEDAS) {
    console.log(`   📦 Buscando: "${busqueda}"...`);
    try {
      const items = await buscarListings(busqueda);
      console.log(`   ✅ ${items.length} items`);
      for (const item of items) {
        if (item.url_original) todos.set(item.url_original, item);
      }
    } catch (err) {
      console.warn(`   ⚠️  Error: ${err.message}`);
    }
    await DELAY(400); // respetar rate limit de la API pública
  }

  const items = Array.from(todos.values());
  console.log(`\n💾 Guardando ${items.length} listings únicos de MercadoLibre...`);

  if (items.length > 0) {
    await guardarListingsExternos(items);
  }

  const conteo = await contarListingsExternos();
  console.log("📊 Totales en DB:");
  conteo.forEach((c) => console.log(`   ${c.fuente}: ${c.total} listings`));
  console.log("\n✅ Agente MeLi Scraper completado");
}

ejecutar().catch((err) => {
  console.error("❌ Error fatal:", err.message);
  process.exit(1);
});

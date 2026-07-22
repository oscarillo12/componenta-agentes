// agentes/meli.js
// Raspa repuestos usados desde la web pública de MercadoLibre Chile (Temuco)
// y los guarda en la base de datos de Componenta.
// Uso: node agentes/meli.js

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { chromium } = require("@playwright/test");
const { guardarListingsExternos, contarListingsExternos } = require("./supabase-client");

const BUSQUEDAS = [
  "alternador auto usado",
  "motor arranque auto",
  "radiador auto usado",
  "suspension auto usado",
  "caja cambios auto",
  "amortiguador auto",
  "pastillas freno auto",
  "disco freno auto",
  "bomba combustible auto",
  "bomba agua motor",
  "embrague auto usado",
  "turbo auto usado",
  "inyector combustible auto",
  "termostato motor auto",
  "correa distribucion auto",
  "diferencial auto usado",
  "culata motor usado",
  "bujias auto",
  "sensor oxigeno auto",
  "repuestos motor usado",
];

const DELAY = (ms) => new Promise((r) => setTimeout(r, ms));
const DELAY_ALEATORIO = (min, max) =>
  DELAY(Math.floor(Math.random() * (max - min) + min));

// Palabras que sugieren que el item es nuevo / e-commerce, no una desarmaduria
const PALABRAS_NUEVO = [
  'nuevo', 'new ', '0km', '0 km', 'original oem', 'importado nuevo',
  'kit completo nuevo', 'marca nueva', 'sin uso', 'sellado', 'caja cerrada',
]

function esItemNuevo(titulo = '') {
  const t = titulo.toLowerCase()
  return PALABRAS_NUEVO.some(p => t.includes(p))
}

async function rasparBusqueda(page, busqueda) {
  // CONDITION_2230581 = filtro "Usado" en MercadoLibre Chile
  const url = `https://listado.mercadolibre.cl/${encodeURIComponent(busqueda)}_Desde_1_ITEM*CONDITION_2230581_NoIndex_True`;

  console.log(`   Navegando a MeLi: ${busqueda}...`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await DELAY_ALEATORIO(1500, 3000);

  // Scroll progresivo para cargar todos los items
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await DELAY_ALEATORIO(500, 1200);
  }

  const items = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(
      ".ui-search-result, .poly-card, [class*='result-item']"
    ));

    return cards.map((card) => {
      // Título
      const titulo =
        card.querySelector(".poly-component__title, .ui-search-item__title, h2")?.innerText?.trim() || null;

      // Precio — solo el número principal, sin decimales ni rangos
      const precioEl = card.querySelector(
        ".andes-money-amount__fraction, .price-tag-fraction"
      );
      const precioRaw = precioEl?.innerText?.trim() || "0";
      // Elimina puntos de miles chilenos y toma solo la parte entera
      const precio = parseInt(precioRaw.replace(/\./g, "").replace(/,\d+$/, ""), 10) || 0;

      // Imagen
      const img =
        card.querySelector("img[src], img[data-src]");
      const imagen = img?.src || img?.dataset?.src || null;

      // URL
      const linkEl = card.querySelector("a[href*='mercadolibre.cl']");
      const url_original = linkEl?.href?.split("#")[0] || null;

      // Ubicación
      const ubicacion =
        card.querySelector(".poly-component__location, .ui-search-item__location, [class*='location']")
          ?.innerText?.trim() || null;

      // Vendedor
      const vendedor =
        card.querySelector(".poly-component__seller, [class*='seller']")
          ?.innerText?.trim() || null;

      return { titulo, precio, imagen, url_original, ubicacion, vendedor };
    }).filter((i) => i.titulo && i.url_original);
  });

  return items;
}

async function ejecutar() {
  console.log("🔍 Agente MercadoLibre (scraping) iniciando...");

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "es-CL",
  });

  const page = await context.newPage();

  // Ocultar que es Playwright
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  const todosLosItems = new Map();

  for (const busqueda of BUSQUEDAS) {
    console.log(`\n📦 Buscando: "${busqueda}"...`);
    try {
      const items = await rasparBusqueda(page, busqueda);
      console.log(`   ✅ ${items.length} items encontrados`);

      for (const item of items) {
        if (item.url_original && !esItemNuevo(item.titulo)) {
          todosLosItems.set(item.url_original, {
            fuente: "mercadolibre",
            titulo: item.titulo,
            precio: item.precio,
            imagen: item.imagen,
            descripcion: item.titulo,
            url_original: item.url_original,
            categoria: "Repuestos",
            marca: null,
            modelo: null,
            vendedor_nombre: item.vendedor,
            ubicacion: item.ubicacion || "Chile",
          });
        }
      }

      await DELAY_ALEATORIO(1000, 2500);
    } catch (err) {
      console.warn(`   ⚠️  Error en "${busqueda}": ${err.message}`);
    }
  }

  await browser.close();

  const items = Array.from(todosLosItems.values());
  console.log(`\n💾 Guardando ${items.length} listings únicos...`);

  if (items.length > 0) {
    await guardarListingsExternos(items);
  }

  const conteo = await contarListingsExternos();
  console.log("📊 Totales en DB:");
  conteo.forEach((c) => console.log(`   ${c.fuente}: ${c.total} listings`));
  console.log("\n✅ Agente MercadoLibre completado");
}

ejecutar().catch((err) => {
  console.error("❌ Error fatal:", err.message);
  process.exit(1);
});

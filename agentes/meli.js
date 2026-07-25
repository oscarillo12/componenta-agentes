// agentes/meli.js
// Publica automáticamente piezas del inventario en MercadoLibre Chile.
// Lee de Supabase: products con canal 'mercadolibre' y sin ml_item_id.
// Uso: node agentes/meli.js

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { supabase } = require("./supabase-client");

const ML_APP_ID     = process.env.ML_APP_ID;
const ML_SECRET_KEY = process.env.ML_SECRET_KEY;

const DELAY = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Token management ──────────────────────────────────────────────────────────

async function getValidToken(userId) {
  const { data } = await supabase
    .from("ml_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .single();

  if (!data) return null;

  if (new Date(data.expires_at) > new Date(Date.now() + 5 * 60 * 1000)) {
    return data.access_token;
  }

  if (!ML_APP_ID || !ML_SECRET_KEY) {
    console.error("❌ Faltan ML_APP_ID o ML_SECRET_KEY en el entorno");
    return null;
  }

  const res = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      client_id:     ML_APP_ID,
      client_secret: ML_SECRET_KEY,
      refresh_token: data.refresh_token,
    }),
  });

  if (!res.ok) {
    console.error(`❌ No se pudo refrescar token ML para user ${userId}`);
    return null;
  }

  const fresh = await res.json();
  await supabase.from("ml_tokens").update({
    access_token:  fresh.access_token,
    refresh_token: fresh.refresh_token,
    expires_at:    new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
  }).eq("user_id", userId);

  return fresh.access_token;
}

// ── Utilidades ───────────────────────────────────────────────────────────────

async function detectarCategoria(query) {
  const FALLBACK = "MLC174408"; // Repuestos para Autos y Camionetas
  try {
    const res = await fetch(
      `https://api.mercadolibre.com/sites/MLC/domain_discovery/search?q=${encodeURIComponent(query)}&limit=1`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) return FALLBACK;
    const data = await res.json();
    return Array.isArray(data) && data[0]?.category_id ? data[0].category_id : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

async function subirImagen(imageUrl, token) {
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return null;
    const buffer = await imgRes.arrayBuffer();
    const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";
    const formData = new FormData();
    formData.append("file", new Blob([buffer], { type: contentType }), `image.${ext}`);
    const mlRes = await fetch("https://api.mercadolibre.com/pictures/items/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!mlRes.ok) return null;
    const mlImg = await mlRes.json();
    return mlImg?.id ? { id: mlImg.id } : null;
  } catch {
    return null;
  }
}

// Intenta publicar degradando tipo si la cuenta no es elegible
async function publicarConFallback(payload, token) {
  const cola = ["gold_special", "bronze", "free"];
  for (const tipo of cola) {
    const res = await fetch("https://api.mercadolibre.com/items", {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept:         "application/json",
      },
      body: JSON.stringify({ ...payload, listing_type_id: tipo }),
    });
    const data = await res.json();
    if (res.ok) return { mlData: data, tipoUsado: tipo };
    if (data.error !== "not_eligible_for_listing_type") {
      throw new Error(`MeLi error (${tipo}): ${data.message ?? data.error}`);
    }
    console.log(`      ↳ No elegible para "${tipo}", degradando...`);
  }
  throw new Error("Sin tipo de publicación disponible para esta cuenta");
}

// ── Publicar un producto ──────────────────────────────────────────────────────

async function publicarProducto(product, token) {
  const fitment = Array.isArray(product.fitment) ? product.fitment : [];

  // Título (máx 60 chars) con rango de años para más relevancia en búsquedas
  const yearFrom = fitment.length > 0 ? Math.min(...fitment.map((f) => f.yearFrom)) : null;
  const yearTo   = fitment.length > 0 ? Math.max(...fitment.map((f) => f.yearTo))   : null;
  const yearStr  = yearFrom
    ? yearFrom === yearTo ? ` ${yearFrom}` : ` ${yearFrom}-${yearTo}`
    : "";
  let title = [product.pieza, product.marca, product.modelo, yearStr]
    .filter(Boolean).join(" ").trim();
  if (title.length > 60) title = title.slice(0, 57) + "...";

  // Categoría específica por tipo de pieza
  const catQuery = [product.pieza, product.marca, product.modelo].filter(Boolean).join(" ");
  const category_id = await detectarCategoria(catQuery);

  // Imágenes
  const imageUrls = [product.imagen_url].filter(Boolean);
  const pictureResults = await Promise.all(imageUrls.map((url) => subirImagen(url, token)));
  const pictures = pictureResults.filter(Boolean);

  // Descripción
  const estadoLabel = {
    excelente:      "Excelente estado — como nuevo, sin detalles.",
    bueno:          "Buen estado — uso normal, funciona perfectamente.",
    "con-detalles": "Con detalles menores — funciona bien.",
    "para-reparar": "Para reparar — requiere reparación.",
  };
  const compatLines = fitment.map(
    (f) => `• ${f.make} ${f.model} ${f.yearFrom === f.yearTo ? f.yearFrom : `${f.yearFrom}–${f.yearTo}`}`
  );
  const descripcion = [
    estadoLabel[product.estado] ?? "",
    product.descripcion ?? "",
    product.oem ? `Número de parte OEM: ${product.oem}` : "",
    compatLines.length > 0 ? `\nVehículos compatibles:\n${compatLines.join("\n")}` : "",
    product.envio ? `\nEnvío: ${product.envio}` : "",
    "\nPieza extraída de desarmaduria. Verificada y probada antes de publicar.",
    "Consultas sin compromiso.",
  ].filter(Boolean).join("\n");

  // Atributos
  const attributes = [];
  if (product.marca)  attributes.push({ id: "BRAND",             value_name: product.marca });
  if (product.modelo) attributes.push({ id: "MODEL",             value_name: product.modelo });
  if (product.oem)    attributes.push({ id: "PART_NUMBER",       value_name: product.oem });
  if (product.oem)    attributes.push({ id: "SELLER_SKU",        value_name: product.oem });
  if (yearFrom)       attributes.push({ id: "VEHICLE_YEAR_FROM", value_name: String(yearFrom) });
  if (yearTo)         attributes.push({ id: "VEHICLE_YEAR_TO",   value_name: String(yearTo) });

  const marcasCompat  = [...new Set(fitment.map((f) => f.make).filter(Boolean))];
  const modelosCompat = [...new Set(fitment.map((f) => f.model).filter(Boolean))];
  for (const m of marcasCompat)  attributes.push({ id: "COMPATIBLE_BRANDS", value_name: m });
  for (const m of modelosCompat) attributes.push({ id: "COMPATIBLE_MODELS", value_name: m });

  // Envío
  const localPickup = (product.envio ?? "").toLowerCase().includes("retiro");
  const shipping = {
    mode: localPickup ? "not_specified" : "me2",
    local_pick_up: true,
    free_shipping: false,
  };

  const payload = {
    title,
    category_id,
    price:              product.precio,
    currency_id:        "CLP",
    available_quantity: 1,
    condition:          "used",
    sale_terms: [{ id: "WARRANTY_TYPE", value_name: "Sin garantía" }],
    shipping,
    ...(attributes.length > 0 && { attributes }),
    ...(pictures.length > 0   && { pictures }),
  };

  const { mlData, tipoUsado } = await publicarConFallback(payload, token);

  // Descripción como paso separado (más confiable que inline para ciertas categorías)
  await fetch(`https://api.mercadolibre.com/items/${mlData.id}/description`, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ plain_text: descripcion }),
  }).catch(() => {});

  return {
    ml_item_id:   mlData.id,
    ml_permalink: mlData.permalink,
    listing_type: tipoUsado,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function ejecutar() {
  console.log("📤 Agente MercadoLibre — publicador iniciando...\n");

  // Productos con canal MercadoLibre seleccionado, disponibles, sin ml_item_id
  const { data: productos, error } = await supabase
    .from("products")
    .select("*")
    .contains("canales", ["mercadolibre"])
    .is("ml_item_id", null)
    .eq("disponible", true);

  if (error) {
    console.error("❌ Error leyendo productos:", error.message);
    process.exit(1);
  }

  if (!productos?.length) {
    console.log("✅ Sin productos pendientes de publicar en MercadoLibre");
    return;
  }

  console.log(`📦 ${productos.length} producto(s) pendientes\n`);

  // Agrupar por user_id para reutilizar tokens y minimizar llamadas OAuth
  const byUser = {};
  for (const p of productos) {
    if (!byUser[p.user_id]) byUser[p.user_id] = [];
    byUser[p.user_id].push(p);
  }

  let publicados = 0;
  let errores    = 0;

  for (const [userId, prods] of Object.entries(byUser)) {
    console.log(`👤 Usuario ${userId} — ${prods.length} producto(s)`);

    const token = await getValidToken(userId);
    if (!token) {
      console.warn(`   ⚠️  Sin token ML válido — saltando\n`);
      errores += prods.length;
      continue;
    }

    for (const product of prods) {
      try {
        console.log(`   ⬆️  "${product.pieza}" (${product.id})`);
        const { ml_item_id, ml_permalink, listing_type } = await publicarProducto(product, token);

        await supabase.from("products").update({
          ml_item_id,
          ml_permalink,
          canales: [...new Set([...(product.canales ?? []), "mercadolibre"])],
        }).eq("id", product.id);

        console.log(`   ✅ Publicado [${listing_type}]: ${ml_permalink}`);
        publicados++;
      } catch (err) {
        console.error(`   ❌ Error: ${err.message}`);
        errores++;
      }

      await DELAY(2000); // Respetar rate limits de la API
    }
    console.log("");
  }

  console.log(`📊 Resultado: ${publicados} publicados, ${errores} errores`);
  console.log("✅ Agente MercadoLibre completado");
}

ejecutar().catch((err) => {
  console.error("❌ Error fatal:", err.message);
  process.exit(1);
});

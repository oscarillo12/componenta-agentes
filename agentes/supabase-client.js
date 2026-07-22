// agentes/supabase-client.js
// Cliente Supabase con service-role para que los agentes puedan escribir en la DB.
// Requiere @supabase/supabase-js instalado en el proyecto.

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error(
    "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el .env"
  );
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

/**
 * Inserta o actualiza listings externos en Supabase.
 * Usa url_original como clave de unicidad (upsert).
 */
async function guardarListingsExternos(listings) {
  if (!listings || listings.length === 0) return;

  const rows = listings.map((item) => {
    const precioRaw = Math.round(item.precio || 0)
    const precio = precioRaw > 999_999_999 ? 0 : precioRaw  // descarta precios mal parseados
    return {
    fuente:          item.fuente,
    titulo:          item.titulo || null,
    precio,
    imagen:          item.imagen || null,
    descripcion:     item.descripcion || null,
    url_original:    item.url_original,
    categoria:       item.categoria || null,
    marca:           item.marca || null,
    modelo:          item.modelo || null,
    vendedor_nombre: item.vendedor_nombre || null,
    ubicacion:       item.ubicacion || null,
    activo:          true,
  }})

  const { error } = await supabase
    .from("listings_externos")
    .upsert(rows, { onConflict: "url_original", ignoreDuplicates: false });

  if (error) throw new Error(`Supabase upsert falló: ${error.message}`);
}

/**
 * Devuelve el conteo de listings activos por fuente.
 * Retorna [{ fuente, total }]
 */
async function contarListingsExternos() {
  const { data, error } = await supabase
    .from("listings_externos")
    .select("fuente")
    .eq("activo", true);

  if (error) return [];

  const conteo = {};
  for (const row of data) {
    conteo[row.fuente] = (conteo[row.fuente] || 0) + 1;
  }
  return Object.entries(conteo).map(([fuente, total]) => ({ fuente, total }));
}

module.exports = { supabase, guardarListingsExternos, contarListingsExternos };

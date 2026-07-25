// agentes/supabase-client.js
// Cliente Supabase con service-role para que los agentes puedan escribir en la DB.
// Requiere @supabase/supabase-js instalado en el proyecto.

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

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
 * Descarga una imagen desde imageUrl y la sube a Supabase Storage.
 * Retorna la URL pública permanente, o null si falla.
 *
 * Las URLs de Facebook CDN (scontent) expiran en 24-48h.
 * Subiendo a Storage se garantiza que la URL no caduca nunca.
 * Las URLs de MeLi (mlstatic.com) ya son permanentes — se devuelven sin subir.
 *
 * PREREQUISITO: bucket "listing-images" creado en Supabase Storage con acceso público.
 */
async function subirImagenAStorage(imageUrl) {
  if (!imageUrl) return null;

  // URLs ya permanentes no necesitan re-subirse
  if (
    imageUrl.includes(".supabase.co/storage") ||
    imageUrl.includes("mlstatic.com")
  ) {
    return imageUrl;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(imageUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
      ? "webp"
      : "jpg";

    // Nombre de archivo determinístico: mismo URL → mismo archivo (evita duplicados)
    const hash = crypto.createHash("md5").update(imageUrl).digest("hex");
    const filename = `${hash}.${ext}`;

    const { error } = await supabase.storage
      .from("listing-images")
      .upload(filename, buffer, { contentType, upsert: true });

    if (error) {
      console.warn(`   ⚠️  Storage upload falló: ${error.message}`);
      return null;
    }

    const { data } = supabase.storage
      .from("listing-images")
      .getPublicUrl(filename);

    return data.publicUrl;
  } catch (err) {
    if (err.name !== "AbortError") {
      console.warn(`   ⚠️  Error subiendo imagen: ${err.message}`);
    }
    return null;
  }
}

/**
 * Sube imágenes de un array de items a Supabase Storage en paralelo (máx 5 a la vez).
 * Modifica los items en lugar (muta item.imagen → URL permanente).
 */
async function procesarImagenesItems(items) {
  const CONCURRENCY = 5;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (item) => {
        if (!item.imagen) return;
        const permanentUrl = await subirImagenAStorage(item.imagen);
        if (permanentUrl) item.imagen = permanentUrl;
      })
    );
  }
}

/**
 * Inserta o actualiza listings externos en Supabase.
 * Usa url_original como clave de unicidad (upsert).
 */
async function guardarListingsExternos(listings) {
  if (!listings || listings.length === 0) return;

  const rows = listings.map((item) => {
    const precioRaw = Math.round(item.precio || 0);
    const precio = precioRaw > 999_999_999 ? 0 : precioRaw;
    return {
      fuente: item.fuente,
      titulo: item.titulo || null,
      precio,
      imagen: item.imagen || null,
      descripcion: item.descripcion || null,
      url_original: item.url_original,
      categoria: item.categoria || null,
      marca: item.marca || null,
      modelo: item.modelo || null,
      vendedor_nombre: item.vendedor_nombre || null,
      ubicacion: item.ubicacion || null,
      activo: true,
    };
  });

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

module.exports = {
  supabase,
  guardarListingsExternos,
  contarListingsExternos,
  subirImagenAStorage,
  procesarImagenesItems,
};

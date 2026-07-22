const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

const dbPath = path.join(__dirname, "componenta.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vendedores (
      id          TEXT PRIMARY KEY,
      nombre      TEXT NOT NULL,
      telefono    TEXT UNIQUE NOT NULL,
      negocio     TEXT,
      creado_en   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS piezas (
      id                      TEXT PRIMARY KEY,
      vendedor_id             TEXT NOT NULL,
      nombre                  TEXT,
      categoria               TEXT,
      marca_vehiculo_probable TEXT,
      modelo_vehiculo_probable TEXT,
      estado_visual           TEXT,
      descripcion             TEXT,
      precio                  REAL DEFAULT 0,
      imagen                  TEXT,
      estado                  TEXT DEFAULT 'disponible',
      creado_en               TEXT NOT NULL,
      vendido_en              TEXT,
      FOREIGN KEY (vendedor_id) REFERENCES vendedores(id)
    );

    CREATE TABLE IF NOT EXISTS listings_externos (
      id             TEXT PRIMARY KEY,
      fuente         TEXT NOT NULL,
      titulo         TEXT,
      precio         REAL,
      imagen         TEXT,
      descripcion    TEXT,
      url_original   TEXT UNIQUE,
      categoria      TEXT,
      marca          TEXT,
      modelo         TEXT,
      vendedor_nombre TEXT,
      ubicacion      TEXT,
      fecha_obtenida TEXT NOT NULL,
      activo         INTEGER DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_piezas_estado    ON piezas(estado);
    CREATE INDEX IF NOT EXISTS idx_piezas_vendedor  ON piezas(vendedor_id);
    CREATE INDEX IF NOT EXISTS idx_ext_fuente       ON listings_externos(fuente);
    CREATE INDEX IF NOT EXISTS idx_ext_activo       ON listings_externos(activo);
  `);

  // Tabla tokens MercadoLibre por vendedor
  db.exec(`
    CREATE TABLE IF NOT EXISTS ml_tokens (
      vendedor_id    TEXT PRIMARY KEY,
      access_token   TEXT NOT NULL,
      refresh_token  TEXT NOT NULL,
      expires_at     TEXT NOT NULL,
      ml_user_id     TEXT,
      creado_en      TEXT NOT NULL,
      actualizado_en TEXT NOT NULL,
      FOREIGN KEY (vendedor_id) REFERENCES vendedores(id)
    );
  `);

  // Columnas nuevas del flujo de publicación avanzado (idempotente)
  const nuevasCols = [
    "ALTER TABLE piezas ADD COLUMN oem TEXT",
    "ALTER TABLE piezas ADD COLUMN anios TEXT",
    "ALTER TABLE piezas ADD COLUMN envio TEXT",
    "ALTER TABLE piezas ADD COLUMN canales TEXT",
    "ALTER TABLE piezas ADD COLUMN fitment TEXT",
    "ALTER TABLE piezas ADD COLUMN condicion TEXT",
    "ALTER TABLE piezas ADD COLUMN seller_telefono TEXT",
    "ALTER TABLE piezas ADD COLUMN ml_item_id TEXT",
    "ALTER TABLE piezas ADD COLUMN ml_permalink TEXT",
  ];
  for (const sql of nuevasCols) {
    try { db.exec(sql); } catch (_) { /* columna ya existe */ }
  }

  _migrarDesdeJSON();
}

function _migrarDesdeJSON() {
  const jsonPath = path.join(__dirname, "componenta.json");
  if (!fs.existsSync(jsonPath)) return;

  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

    const insV = db.prepare(`
      INSERT OR IGNORE INTO vendedores (id, nombre, telefono, negocio, creado_en)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insP = db.prepare(`
      INSERT OR IGNORE INTO piezas
        (id, vendedor_id, nombre, categoria, marca_vehiculo_probable,
         modelo_vehiculo_probable, estado_visual, descripcion, precio,
         imagen, estado, creado_en, vendido_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (const v of data.vendedores || []) {
        insV.run(v.id, v.nombre, v.telefono, v.negocio || null, v.creadoEn);
      }
      for (const p of data.piezas || []) {
        insP.run(
          p.id, p.vendedorId, p.nombre, p.categoria,
          p.marcaVehiculoProbable || null, p.modeloVehiculoProbable || null,
          p.estadoVisual || null, p.descripcion || null,
          p.precio || 0, p.imagen || null,
          p.estado || "disponible", p.creadoEn, p.vendidoEn || null
        );
      }
    })();

    fs.renameSync(jsonPath, jsonPath + ".migrado");
    console.log("✅ Datos migrados desde componenta.json → SQLite");
  } catch (e) {
    console.warn("⚠️  Migración JSON fallida:", e.message);
  }
}

// ─── VENDEDORES ────────────────────────────────────────────────────────────────

function crearVendedorSiNoExiste({ nombre, telefono, negocio }) {
  let v = db.prepare("SELECT * FROM vendedores WHERE telefono = ?").get(telefono);
  if (!v) {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO vendedores (id, nombre, telefono, negocio, creado_en)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, nombre, telefono, negocio || null, new Date().toISOString());
    v = db.prepare("SELECT * FROM vendedores WHERE id = ?").get(id);
  }
  return _fmtVendedor(v);
}

function obtenerVendedor(id) {
  const v = db.prepare("SELECT * FROM vendedores WHERE id = ?").get(id);
  return v ? _fmtVendedor(v) : null;
}

function _fmtVendedor(v) {
  return {
    id: v.id,
    nombre: v.nombre,
    telefono: v.telefono,
    negocio: v.negocio,
    creadoEn: v.creado_en,
  };
}

// ─── PIEZAS PROPIAS ────────────────────────────────────────────────────────────

function crearPieza(pieza) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO piezas
      (id, vendedor_id, nombre, categoria, marca_vehiculo_probable,
       modelo_vehiculo_probable, estado_visual, descripcion, precio, imagen,
       oem, anios, envio, canales, fitment, condicion, seller_telefono,
       estado, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'disponible', ?)
  `).run(
    id,
    pieza.vendedorId,
    pieza.nombre,
    pieza.categoria || null,
    pieza.marcaVehiculoProbable || null,
    pieza.modeloVehiculoProbable || null,
    pieza.estadoVisual || null,
    pieza.descripcion || null,
    pieza.precio || 0,
    pieza.imagen || null,
    pieza.oem || null,
    pieza.anios || null,
    pieza.envio || null,
    pieza.canales ? JSON.stringify(pieza.canales) : null,
    pieza.fitment ? JSON.stringify(pieza.fitment) : null,
    pieza.condicion || null,
    pieza.sellerTelefono || null,
    new Date().toISOString()
  );
  return obtenerPieza(id);
}

function listarPiezas({ vendedorId, soloDisponibles = false, busqueda = "" } = {}) {
  let sql = "SELECT * FROM piezas WHERE 1=1";
  const params = [];

  if (vendedorId) { sql += " AND vendedor_id = ?"; params.push(vendedorId); }
  if (soloDisponibles) { sql += " AND estado = 'disponible'"; }
  if (busqueda) {
    sql += ` AND (nombre LIKE ? OR descripcion LIKE ?
             OR marca_vehiculo_probable LIKE ? OR modelo_vehiculo_probable LIKE ?
             OR categoria LIKE ?)`;
    const q = `%${busqueda}%`;
    params.push(q, q, q, q, q);
  }

  sql += " ORDER BY creado_en DESC";
  return db.prepare(sql).all(...params).map(_fmtPieza);
}

function obtenerPieza(id) {
  const p = db.prepare("SELECT * FROM piezas WHERE id = ?").get(id);
  return p ? _fmtPieza(p) : null;
}

function actualizarPieza(id, cambios) {
  const fields = [];
  const params = [];

  if (cambios.precio !== undefined)     { fields.push("precio = ?");     params.push(cambios.precio); }
  if (cambios.descripcion !== undefined){ fields.push("descripcion = ?"); params.push(cambios.descripcion); }
  if (cambios.estado !== undefined)     { fields.push("estado = ?");      params.push(cambios.estado); }
  if (cambios.vendidoEn !== undefined)  { fields.push("vendido_en = ?");  params.push(cambios.vendidoEn); }

  if (fields.length === 0) return obtenerPieza(id);
  params.push(id);
  db.prepare(`UPDATE piezas SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  return obtenerPieza(id);
}

function marcarVendido(id) {
  return actualizarPieza(id, { estado: "vendido", vendidoEn: new Date().toISOString() });
}

function _fmtPieza(p) {
  return {
    id: p.id,
    vendedorId: p.vendedor_id,
    nombre: p.nombre,
    categoria: p.categoria,
    marcaVehiculoProbable: p.marca_vehiculo_probable,
    modeloVehiculoProbable: p.modelo_vehiculo_probable,
    estadoVisual: p.estado_visual,
    descripcion: p.descripcion,
    precio: p.precio,
    imagen: p.imagen,
    estado: p.estado,
    creadoEn: p.creado_en,
    vendidoEn: p.vendido_en,
  };
}

// ─── LISTINGS EXTERNOS ─────────────────────────────────────────────────────────

function guardarListingsExternos(listings) {
  const upsert = db.prepare(`
    INSERT INTO listings_externos
      (id, fuente, titulo, precio, imagen, descripcion, url_original,
       categoria, marca, modelo, vendedor_nombre, ubicacion, fecha_obtenida, activo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(url_original) DO UPDATE SET
      titulo         = excluded.titulo,
      precio         = excluded.precio,
      imagen         = excluded.imagen,
      descripcion    = excluded.descripcion,
      categoria      = excluded.categoria,
      marca          = excluded.marca,
      modelo         = excluded.modelo,
      fecha_obtenida = excluded.fecha_obtenida,
      activo         = 1
  `);

  db.transaction((items) => {
    for (const item of items) {
      upsert.run(
        item.id || randomUUID(), item.fuente, item.titulo,
        item.precio || 0, item.imagen || null, item.descripcion || null,
        item.url_original, item.categoria || null,
        item.marca || null, item.modelo || null,
        item.vendedor_nombre || null, item.ubicacion || null,
        new Date().toISOString()
      );
    }
  })(listings);
}

function contarListingsExternos() {
  return db.prepare("SELECT fuente, COUNT(*) as total FROM listings_externos WHERE activo = 1 GROUP BY fuente").all();
}

// ─── BÚSQUEDA UNIFICADA ────────────────────────────────────────────────────────
// Mezcla piezas propias + listings externos en un formato común para la vitrina.

function buscarTodo({ busqueda = "", limite = 60 } = {}) {
  const q = `%${busqueda}%`;

  let sqlPropias = `
    SELECT id, 'componenta' AS fuente,
           nombre, categoria, imagen, precio,
           marca_vehiculo_probable AS marcaVehiculoProbable,
           modelo_vehiculo_probable AS modeloVehiculoProbable,
           '/pieza/' || id AS url,
           creado_en AS fecha
    FROM piezas
    WHERE estado = 'disponible'
  `;
  const pP = [];
  if (busqueda) {
    sqlPropias += ` AND (nombre LIKE ? OR descripcion LIKE ?
      OR marca_vehiculo_probable LIKE ? OR modelo_vehiculo_probable LIKE ?
      OR categoria LIKE ?)`;
    pP.push(q, q, q, q, q);
  }

  let sqlExternos = `
    SELECT id, fuente,
           titulo AS nombre, categoria, imagen, precio,
           marca AS marcaVehiculoProbable,
           modelo AS modeloVehiculoProbable,
           url_original AS url,
           fecha_obtenida AS fecha
    FROM listings_externos
    WHERE activo = 1
  `;
  const pE = [];
  if (busqueda) {
    sqlExternos += ` AND (titulo LIKE ? OR descripcion LIKE ?
      OR marca LIKE ? OR modelo LIKE ? OR categoria LIKE ?)`;
    pE.push(q, q, q, q, q);
  }

  const propias   = db.prepare(sqlPropias).all(...pP);
  const externos  = db.prepare(sqlExternos).all(...pE);

  return [...propias, ...externos]
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    .slice(0, limite);
}

module.exports = {
  initDB,
  crearVendedorSiNoExiste,
  obtenerVendedor,
  crearPieza,
  listarPiezas,
  obtenerPieza,
  actualizarPieza,
  marcarVendido,
  guardarListingsExternos,
  contarListingsExternos,
  buscarTodo,
};

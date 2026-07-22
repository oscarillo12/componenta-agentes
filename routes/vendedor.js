// routes/vendedor.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

const { identificarPieza } = require("../ia/identificarPieza");
const {
  crearVendedorSiNoExiste,
  obtenerVendedor,
  crearPieza,
  listarPiezas,
  obtenerPieza,
  marcarVendido,
  actualizarPieza,
} = require("../db");

const router = express.Router();

// --- configuración de subida de fotos ---
const carpetaUploads = path.join(__dirname, "..", "public", "uploads");
if (!fs.existsSync(carpetaUploads)) fs.mkdirSync(carpetaUploads, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, carpetaUploads),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB máx por foto
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("El archivo debe ser una imagen"));
    }
    cb(null, true);
  },
});

// --- Login simple por teléfono (sin contraseña, pensado para piloto) ---
// En una v2 esto se reemplaza por login real con código SMS o similar.

router.get("/ingresar", (req, res) => {
  res.render("vendedor/ingresar", { error: null });
});

router.post("/ingresar", async (req, res) => {
  const { nombre, telefono, negocio } = req.body;
  if (!nombre || !telefono) {
    return res.render("vendedor/ingresar", { error: "Completa nombre y teléfono" });
  }
  const vendedor = await crearVendedorSiNoExiste({ nombre, telefono, negocio });
  res.cookie("vendedorId", vendedor.id, { maxAge: 1000 * 60 * 60 * 24 * 30 });
  res.redirect("/vendedor/panel");
});

router.get("/salir", (req, res) => {
  res.clearCookie("vendedorId");
  res.redirect("/vendedor/ingresar");
});

// Middleware: exige sesión de vendedor
async function exigirVendedor(req, res, next) {
  const vendedorId = req.cookies.vendedorId;
  if (!vendedorId) return res.redirect("/vendedor/ingresar");
  const vendedor = await obtenerVendedor(vendedorId);
  if (!vendedor) return res.redirect("/vendedor/ingresar");
  req.vendedor = vendedor;
  next();
}

// --- Panel principal: subir foto + listado de piezas propias ---

router.get("/panel", exigirVendedor, async (req, res) => {
  const piezas = await listarPiezas({ vendedorId: req.vendedor.id });
  res.render("vendedor/panel", { vendedor: req.vendedor, piezas, error: null });
});

// Paso 1: el vendedor sube la foto -> la IA genera el borrador de ficha
router.post(
  "/panel/analizar",
  exigirVendedor,
  upload.single("foto"),
  async (req, res) => {
    try {
      if (!req.file) {
        const piezas = await listarPiezas({ vendedorId: req.vendedor.id });
        return res.render("vendedor/panel", {
          vendedor: req.vendedor,
          piezas,
          error: "Debes seleccionar una foto",
        });
      }

      const rutaAbsoluta = req.file.path;
      const ficha = await identificarPieza(rutaAbsoluta);
      const rutaPublica = "/uploads/" + path.basename(rutaAbsoluta);

      res.render("vendedor/confirmar", {
        vendedor: req.vendedor,
        ficha,
        rutaImagen: rutaPublica,
        error: null,
      });
    } catch (err) {
      console.error(err);
      const piezas = await listarPiezas({ vendedorId: req.vendedor.id });
      res.render("vendedor/panel", {
        vendedor: req.vendedor,
        piezas,
        error:
          "No pudimos analizar la foto (" +
          err.message +
          "). Intenta de nuevo con otra foto o más luz.",
      });
    }
  }
);

// Paso 2: el vendedor confirma/edita la ficha generada por la IA y la publica
router.post("/panel/publicar", exigirVendedor, async (req, res) => {
  const {
    nombre,
    categoria,
    marcaVehiculoProbable,
    modeloVehiculoProbable,
    estadoVisual,
    descripcion,
    precio,
    rutaImagen,
  } = req.body;

  await crearPieza({
    vendedorId: req.vendedor.id,
    nombre,
    categoria,
    marcaVehiculoProbable: marcaVehiculoProbable || null,
    modeloVehiculoProbable: modeloVehiculoProbable || null,
    estadoVisual,
    descripcion,
    precio: Number(precio) || 0,
    imagen: rutaImagen,
  });

  res.redirect("/vendedor/panel");
});

// Marcar una pieza como vendida (oculta del catálogo público)
router.post("/panel/piezas/:id/vendido", exigirVendedor, async (req, res) => {
  const pieza = await obtenerPieza(req.params.id);
  if (pieza && pieza.vendedorId === req.vendedor.id) {
    await marcarVendido(pieza.id);
  }
  res.redirect("/vendedor/panel");
});

// ── Nuevo flujo de publicación ─────────────────────────────────────────────

router.get("/nuevo", exigirVendedor, (req, res) => {
  res.render("vendedor/nuevo", { vendedor: req.vendedor });
});

// API: identificar pieza con IA (recibe foto, devuelve JSON)
router.post(
  "/api/identificar",
  exigirVendedor,
  upload.single("foto"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "Sin imagen" });

      const vehicleHint =
        req.body.marca && req.body.modelo && req.body.anio
          ? { marca: req.body.marca, modelo: req.body.modelo, anio: req.body.anio }
          : null;

      const ficha = await identificarPieza(req.file.path, vehicleHint);
      const rutaPublica = "/uploads/" + path.basename(req.file.path);
      res.json({ ...ficha, rutaImagen: rutaPublica });
    } catch (err) {
      console.error("[identificar]", err.message);
      res.status(500).json({ error: err.message || "Error al identificar" });
    }
  }
);

// API: publicar pieza (recibe JSON, guarda en SQLite)
router.post("/api/publicar", exigirVendedor, async (req, res) => {
  try {
    const b = req.body;
    const compat = Array.isArray(b.compatibilidad) ? b.compatibilidad : [];
    const pieza = await crearPieza({
      vendedorId:              req.vendedor.id,
      nombre:                  b.pieza || b.nombre || "Sin nombre",
      categoria:               b.categoria || null,
      marcaVehiculoProbable:   b.marca || compat[0]?.marca || null,
      modeloVehiculoProbable:  compat[0]?.modelo || null,
      estadoVisual:            b.condicion || null,
      descripcion:             b.descripcion || null,
      precio:                  Number(b.precio) || 0,
      imagen:                  b.rutaImagen || null,
      oem:                     b.oem || null,
      anios:                   compat[0]?.anios || null,
      envio:                   b.envio || null,
      canales:                 b.canales || ["componenta"],
      fitment:                 compat,
      condicion:               b.condicion || "bueno",
      sellerTelefono:          b.telefono || req.vendedor.telefono || null,
    });
    res.json({ ok: true, id: pieza.id });
  } catch (err) {
    console.error("[publicar]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Editar precio/descripcion rápidamente desde el panel
router.post("/panel/piezas/:id/editar", exigirVendedor, async (req, res) => {
  const pieza = await obtenerPieza(req.params.id);
  if (pieza && pieza.vendedorId === req.vendedor.id) {
    const { precio, descripcion } = req.body;
    await actualizarPieza(pieza.id, {
      precio: Number(precio) || pieza.precio,
      descripcion: descripcion || pieza.descripcion,
    });
  }
  res.redirect("/vendedor/panel");
});

module.exports = router;

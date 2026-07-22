const express = require("express");
const { obtenerEstado, correrAgente } = require("../scheduler");
const { contarListingsExternos } = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
  const estadoAgentes = obtenerEstado();
  const conteos = contarListingsExternos();
  const totales = { mercadolibre: 0, facebook: 0 };
  conteos.forEach(c => { totales[c.fuente] = c.total; });
  res.render("admin/panel", { estadoAgentes, totales });
});

// Correr agente manualmente desde el panel
router.post("/correr/:agente", (req, res) => {
  const { agente } = req.params;
  const archivos = { mercadolibre: "meli.js", facebook: "facebook.js" };
  if (archivos[agente]) {
    correrAgente(agente, archivos[agente]);
  }
  res.redirect("/admin");
});

module.exports = router;

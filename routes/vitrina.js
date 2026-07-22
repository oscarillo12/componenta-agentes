// routes/vitrina.js
const express = require("express");
const { buscarTodo, obtenerPieza, obtenerVendedor } = require("../db");

const router = express.Router();

// Página principal: catálogo unificado (piezas propias + externos)
router.get("/", async (req, res) => {
  const busqueda = req.query.q || "";
  const piezas = buscarTodo({ busqueda });
  res.render("vitrina/inicio", { piezas, busqueda });
});

// Ficha individual de una pieza
router.get("/pieza/:id", async (req, res) => {
  const pieza = await obtenerPieza(req.params.id);
  if (!pieza || pieza.estado !== "disponible") {
    return res.status(404).render("vitrina/no-encontrado");
  }
  const vendedor = await obtenerVendedor(pieza.vendedorId);
  res.render("vitrina/detalle", { pieza, vendedor });
});

module.exports = router;

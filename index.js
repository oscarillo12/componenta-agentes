// index.js — punto de entrada del servidor Componenta
require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");

const { initDB } = require("./db");
const rutasVendedor = require("./routes/vendedor");
const rutasVitrina = require("./routes/vitrina");
const rutasAdmin = require("./routes/admin");
const { iniciarScheduler } = require("./scheduler");

const app = express();
const PORT = process.env.PORT || 3000;

// Vistas (EJS)
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// Rutas
app.use("/vendedor", rutasVendedor);
app.use("/admin", rutasAdmin);
app.use("/", rutasVitrina);

// 404 simple
app.use((req, res) => {
  res.status(404).send("Página no encontrada");
});

async function iniciar() {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes("pega_aqui")) {
    console.warn(
      "\n⚠️  ADVERTENCIA: No has configurado GEMINI_API_KEY en tu archivo .env\n" +
      "   La identificación automática de piezas NO funcionará hasta que la configures.\n"
    );
  }

  await initDB();
  iniciarScheduler();

  app.listen(PORT, () => {
    console.log(`\n🔧 Componenta corriendo en http://localhost:${PORT}`);
    console.log(`   Vitrina pública:   http://localhost:${PORT}/`);
    console.log(`   Panel vendedor:    http://localhost:${PORT}/vendedor/ingresar`);
    console.log(`   Panel admin:       http://localhost:${PORT}/admin\n`);
  });
}

iniciar();

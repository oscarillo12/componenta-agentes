// scheduler.js
// Corre los agentes de scraping automáticamente en horarios definidos.
// Se integra al servidor Express — no requiere proceso separado.

const cron = require("node-cron");
const { fork } = require("child_process");
const path = require("path");

// Estado de las últimas corridas (en memoria)
const estado = {
  mercadolibre: { ultimaCorrida: null, estado: "pendiente", mensaje: "" },
  facebook:     { ultimaCorrida: null, estado: "pendiente", mensaje: "" },
};

function correrAgente(nombre, archivo) {
  if (estado[nombre].estado === "corriendo") {
    console.log(`⏭  Agente ${nombre} ya está corriendo, se omite esta corrida`);
    return;
  }

  estado[nombre].estado = "corriendo";
  estado[nombre].mensaje = "Corriendo...";
  console.log(`\n🤖 [Scheduler] Iniciando agente ${nombre}...`);

  const proceso = fork(path.join(__dirname, "agentes", archivo), [], {
    silent: true,
    env: process.env,
  });

  let salida = "";
  proceso.stdout.on("data", (d) => { salida += d.toString(); process.stdout.write(d); });
  proceso.stderr.on("data", (d) => { salida += d.toString(); process.stderr.write(d); });

  proceso.on("close", (code) => {
    estado[nombre].ultimaCorrida = new Date().toISOString();
    if (code === 0) {
      estado[nombre].estado = "ok";
      // Extraer el conteo de la salida
      const match = salida.match(/(\d+) listings únicos/);
      estado[nombre].mensaje = match ? `${match[1]} listings actualizados` : "Completado";
      console.log(`✅ [Scheduler] Agente ${nombre} completado`);
    } else {
      estado[nombre].estado = "error";
      estado[nombre].mensaje = `Error (código ${code})`;
      console.error(`❌ [Scheduler] Agente ${nombre} falló con código ${code}`);
    }
  });
}

function iniciarScheduler() {
  // MercadoLibre: cada 4 horas en horario humano (8am, 12pm, 4pm, 8pm)
  cron.schedule("0 8,12,16,20 * * *", () => {
    correrAgente("mercadolibre", "meli.js");
  }, { timezone: "America/Santiago" });

  // Facebook: cada 6 horas (9am, 3pm, 9pm)
  cron.schedule("0 9,15,21 * * *", () => {
    correrAgente("facebook", "facebook.js");
  }, { timezone: "America/Santiago" });

  console.log("⏰ Scheduler activo:");
  console.log("   MercadoLibre → 8am, 12pm, 4pm, 8pm (Santiago)");
  console.log("   Facebook     → 9am, 3pm, 9pm (Santiago)");
}

function obtenerEstado() {
  return estado;
}

module.exports = { iniciarScheduler, obtenerEstado, correrAgente };

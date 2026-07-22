// agentes/facebook-setup.js
// Ejecutar UNA SOLA VEZ para guardar la sesión de Facebook.
// Abre un navegador real donde tú haces login manualmente.
// Las cookies se guardan y el agente las reutiliza sin volver a pedir login.
// Uso: node agentes/facebook-setup.js

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const path = require("path");
const fs = require("fs");

chromium.use(StealthPlugin());

const SESION_PATH = path.join(__dirname, "fb-session.json");

async function ejecutar() {
  console.log("\n🔐 SETUP DE SESIÓN FACEBOOK");
  console.log("═══════════════════════════════════════════");
  console.log("Se abrirá una ventana de Chrome.");
  console.log("1. Inicia sesión en Facebook normalmente");
  console.log("2. Completa cualquier verificación que pida");
  console.log("3. Cuando veas tu feed de Facebook, VUELVE AQUÍ");
  console.log("4. Presiona ENTER en esta ventana para guardar la sesión");
  console.log("═══════════════════════════════════════════\n");

  const browser = await chromium.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1100,750",
      "--start-maximized",
    ],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1100, height: 750 },
    locale: "es-CL",
    timezoneId: "America/Santiago",
  });

  const page = await context.newPage();
  await page.goto("https://www.facebook.com/login");

  console.log("⏳ Esperando que inicies sesión...\n");

  // Revisar cada 5 segundos si la cookie de sesión de FB ya existe
  let logueado = false;
  for (let intento = 0; intento < 120; intento++) {
    await new Promise(r => setTimeout(r, 5000));
    const cookies = await context.cookies("https://www.facebook.com");
    const cUser = cookies.find(c => c.name === "c_user");
    const xs    = cookies.find(c => c.name === "xs");
    if (cUser && xs) {
      logueado = true;
      console.log("✅ Sesión detectada. Guardando cookies...");
      fs.writeFileSync(SESION_PATH, JSON.stringify({ cookies }, null, 2));
      break;
    }
    if (intento % 6 === 5) {
      const url = page.url();
      console.log(`   [${Math.round((intento+1)*5/60)} min] Esperando... URL: ${url.substring(0,60)}`);
    }
  }

  await browser.close();

  if (!logueado) {
    throw new Error("No se detectó login después de 10 minutos");
  }

  console.log(`✅ Sesión guardada en: ${SESION_PATH}`);
  console.log("✅ Ahora puedes correr: node agentes/facebook.js\n");
}

ejecutar().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});

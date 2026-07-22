// agentes/facebook.js
// Raspa repuestos desde Facebook Marketplace Temuco con técnicas anti-detección.
// Primera vez: hace login y guarda la sesión. Las siguientes usa las cookies guardadas.
// Uso: node agentes/facebook.js

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const path = require("path");
const fs = require("fs");
const { guardarListingsExternos, contarListingsExternos } = require("./supabase-client");

chromium.use(StealthPlugin());

const SESION_PATH = path.join(__dirname, "fb-session.json");
const EMAIL    = process.env.FACEBOOK_EMAIL;
const PASSWORD = process.env.FACEBOOK_PASSWORD;

// Búsquedas en Marketplace
const BUSQUEDAS_MARKETPLACE = [
  "alternador auto",
  "motor arranque auto",
  "radiador auto",
  "suspension auto",
  "amortiguador auto",
  "caja cambios auto",
  "repuestos auto",
  "frenos auto",
  "pastillas freno auto",
  "disco freno auto",
  "bomba combustible auto",
  "bomba agua motor",
  "embrague auto",
  "turbo auto",
  "inyector auto",
  "transmision auto",
  "culata motor",
  "diferencial auto",
  "correa distribucion auto",
  "sensor auto",
];

// Búsquedas en grupos y publicaciones públicas
const BUSQUEDAS_GRUPOS = [
  "repuestos auto temuco",
  "alternador temuco",
  "piezas auto temuco",
  "desarmaduria temuco",
  "repuestos usados temuco",
];

// Delay humano aleatorio
const PAUSA = (min, max) =>
  new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));

// Simula escritura humana tecla por tecla
async function escribirDespacio(page, selector, texto) {
  await page.click(selector);
  await PAUSA(300, 600);
  for (const char of texto) {
    await page.keyboard.type(char);
    await PAUSA(60, 180);
  }
}

async function hacerLogin(page) {
  console.log("   🔐 Iniciando sesión en Facebook...");
  await page.goto("https://www.facebook.com/login", { waitUntil: "domcontentloaded" });
  await PAUSA(3000, 5000);

  // Esperar que el campo email esté disponible con múltiples selectores posibles
  const emailSelector = await Promise.race([
    page.waitForSelector("#email", { timeout: 15000 }).then(() => "#email"),
    page.waitForSelector('[name="email"]', { timeout: 15000 }).then(() => '[name="email"]'),
    page.waitForSelector('input[type="email"]', { timeout: 15000 }).then(() => 'input[type="email"]'),
  ]).catch(() => null);

  if (!emailSelector) {
    await page.screenshot({ path: path.join(__dirname, "debug-login.png") });
    throw new Error("No se encontró el campo email — revisa debug-login.png");
  }

  await escribirDespacio(page, emailSelector, EMAIL);
  await PAUSA(500, 900);

  const passSelector = await Promise.race([
    page.waitForSelector("#pass", { timeout: 10000 }).then(() => "#pass"),
    page.waitForSelector('[name="pass"]', { timeout: 10000 }).then(() => '[name="pass"]'),
    page.waitForSelector('input[type="password"]', { timeout: 10000 }).then(() => 'input[type="password"]'),
  ]).catch(() => null);

  if (!passSelector) throw new Error("No se encontró el campo contraseña");

  await escribirDespacio(page, passSelector, PASSWORD);
  await PAUSA(600, 1000);

  // Intentar click en el botón solo si todavía estamos en la página de login
  const enLogin = page.url().includes("facebook.com/login") || page.url().includes("facebook.com/?");
  if (enLogin) {
    await page.click('[name="login"], button[type="submit"]').catch(() => {});
  }

  await PAUSA(3000, 5000);

  // Esperar hasta 3 minutos — el usuario puede necesitar aprobar 2FA en su teléfono
  console.log("   ⏳ Si Facebook pide verificación en 2 pasos, apruébala en tu teléfono...");
  try {
    await page.waitForFunction(
      () => !window.location.href.includes("login") &&
            !window.location.href.includes("two_step") &&
            !window.location.href.includes("checkpoint"),
      { timeout: 180000 }
    );
  } catch {
    // Tiempo agotado — ver dónde quedamos
  }

  await PAUSA(2000, 3000);
  const url = page.url();
  console.log("   URL actual:", url.substring(0, 80));

  if (url.includes("login") || url.includes("two_step") || url.includes("checkpoint")) {
    throw new Error("Login no completado — aprueba la verificación en tu teléfono y vuelve a correr el agente");
  }

  // Guardar sesión
  const cookies = await page.context().cookies();
  const storage = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }));
  fs.writeFileSync(SESION_PATH, JSON.stringify({ cookies, storage }, null, 2));
  console.log("   ✅ Sesión guardada en fb-session.json");
}

async function cargarSesion(context, page) {
  if (!fs.existsSync(SESION_PATH)) return false;

  try {
    const { cookies } = JSON.parse(fs.readFileSync(SESION_PATH, "utf8"));
    await context.addCookies(cookies);
    console.log("   🍪 Sesión previa cargada");
    return true;
  } catch {
    return false;
  }
}

async function verificarSesionActiva(page) {
  await page.goto("https://www.facebook.com", { waitUntil: "domcontentloaded" });
  await PAUSA(2000, 3000);
  const url = page.url();
  return !url.includes("login");
}

async function rasparGrupos(page, busqueda) {
  const url = `https://www.facebook.com/search/posts/?q=${encodeURIComponent(busqueda)}&filters=eyJycF9jcmVhdGlvbl90aW1lIjoieyBcIm5hbWVcIjogXCJjcmVhdGlvbl90aW1lXCIsIFwidHlwZVwiOiBcInJhbmdlXCIsIFwib2Zmc2V0XCI6IDAsIFwicmFuZ2VcIjogODY0MDAgfSJ9`;

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await PAUSA(2500, 4000);

  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, Math.floor(Math.random() * 500 + 300)));
    await PAUSA(1000, 2000);
  }

  const items = await page.evaluate(() => {
    const posts = Array.from(document.querySelectorAll(
      '[data-pagelet*="FeedUnit"], [role="article"], [data-testid*="post"]'
    ));

    const resultados = [];
    const vistos = new Set();

    for (const post of posts) {
      // Buscar links de grupos dentro del post
      const links = Array.from(post.querySelectorAll('a[href*="/groups/"]'))
        .filter(a => a.href.includes("/posts/") || a.href.includes("permalink"));

      const linkGrupo = links[0]?.href?.split("?")[0];
      if (!linkGrupo || vistos.has(linkGrupo)) continue;
      vistos.add(linkGrupo);

      const texto = post.innerText?.trim().substring(0, 200) || null;
      const imagen = post.querySelector("img[src*='scontent']")?.src || null;

      // Extrae solo el primer número después del símbolo $
      const precioMatchGrupo = texto?.match(/\$[\s]*([\d.]+)/);
      const precio = precioMatchGrupo
        ? parseInt(precioMatchGrupo[1].replace(/\./g, ""), 10)
        : 0;

      if (texto) {
        resultados.push({
          titulo: texto.split("\n")[0].substring(0, 100),
          precio,
          imagen,
          url_original: linkGrupo,
          ubicacion: "Temuco",
        });
      }
    }
    return resultados;
  });

  return items;
}

async function rasparBusqueda(page, busqueda) {
  const url = `https://www.facebook.com/marketplace/temuco/search/?query=${encodeURIComponent(busqueda)}&exact=false`;

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await PAUSA(2500, 4000);

  // Scroll progresivo como humano
  for (let i = 0; i < 4; i++) {
    const scrollAmount = Math.floor(Math.random() * 400 + 300);
    await page.evaluate((s) => window.scrollBy(0, s), scrollAmount);
    await PAUSA(800, 1800);
  }

  const items = await page.evaluate(() => {
    // Selectores de Facebook Marketplace (pueden cambiar)
    const cards = Array.from(document.querySelectorAll(
      '[data-testid="marketplace_feed_item"], ' +
      'a[href*="/marketplace/item/"], ' +
      '[class*="x1lliihq"] a[href*="marketplace"]'
    ));

    const vistos = new Set();
    const resultados = [];

    for (const card of cards) {
      const href = card.href || card.querySelector("a")?.href;
      if (!href || !href.includes("/marketplace/item/")) continue;
      const url_original = href.split("?")[0];
      if (vistos.has(url_original)) continue;
      vistos.add(url_original);

      const imgs = card.querySelectorAll("img");
      const imagen = imgs[0]?.src || null;

      const textos = Array.from(card.querySelectorAll("span, div"))
        .map((el) => el.innerText?.trim())
        .filter((t) => t && t.length > 2 && t.length < 200);

      const titulo = textos[0] || null;
      // Extrae solo el primer número después del símbolo $
      const precioTexto = textos.find((t) => t.includes("$")) || "";
      const precioMatch = precioTexto.match(/\$[\s]*([\d.]+)/);
      const precio = precioMatch ? parseInt(precioMatch[1].replace(/\./g, ""), 10) : 0;

      if (titulo) {
        resultados.push({ titulo, precio, imagen, url_original, ubicacion: "Temuco" });
      }
    }
    return resultados;
  });

  return items;
}

async function ejecutar() {
  console.log("🔍 Agente Facebook Marketplace iniciando...");

  if (!EMAIL || !PASSWORD) {
    console.error("❌ Faltan FACEBOOK_EMAIL o FACEBOOK_PASSWORD en el .env");
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1280,800",
    ],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "es-CL",
    timezoneId: "America/Santiago",
  });

  const page = await context.newPage();

  // Intentar cargar sesión guardada
  const sesionCargada = await cargarSesion(context, page);
  let sesionActiva = false;

  if (sesionCargada) {
    sesionActiva = await verificarSesionActiva(page);
    if (!sesionActiva) {
      console.log("   ⚠️  Sesión expirada, haciendo login nuevo...");
    }
  }

  if (!sesionActiva) {
    await hacerLogin(page);
    await PAUSA(2000, 3000);
  }

  const todosLosItems = new Map();

  const agregarItems = (items) => {
    for (const item of items) {
      if (item.url_original) {
        todosLosItems.set(item.url_original, {
          fuente: "facebook",
          titulo: item.titulo,
          precio: item.precio,
          imagen: item.imagen,
          descripcion: item.titulo,
          url_original: item.url_original,
          categoria: "Repuestos",
          marca: null,
          modelo: null,
          vendedor_nombre: null,
          ubicacion: item.ubicacion || "Temuco",
        });
      }
    }
  };

  // 1. Marketplace Temuco
  console.log("\n🛒 Rastreando Facebook Marketplace Temuco...");
  for (const busqueda of BUSQUEDAS_MARKETPLACE) {
    console.log(`\n   📦 Marketplace: "${busqueda}"...`);
    try {
      const items = await rasparBusqueda(page, busqueda);
      console.log(`   ✅ ${items.length} items`);
      agregarItems(items);
      await PAUSA(3000, 5000);
    } catch (err) {
      console.warn(`   ⚠️  Error: ${err.message}`);
    }
  }

  // 2. Grupos y publicaciones públicas
  console.log("\n👥 Rastreando grupos de Facebook...");
  for (const busqueda of BUSQUEDAS_GRUPOS) {
    console.log(`\n   📦 Grupos: "${busqueda}"...`);
    try {
      const items = await rasparGrupos(page, busqueda);
      console.log(`   ✅ ${items.length} publicaciones`);
      agregarItems(items);
      await PAUSA(4000, 7000);
    } catch (err) {
      console.warn(`   ⚠️  Error: ${err.message}`);
    }
  }

  await browser.close();

  const items = Array.from(todosLosItems.values());
  console.log(`\n💾 Guardando ${items.length} listings únicos de Facebook...`);

  if (items.length > 0) {
    await guardarListingsExternos(items);
  }

  const conteo = await contarListingsExternos();
  console.log("📊 Totales en DB:");
  conteo.forEach((c) => console.log(`   ${c.fuente}: ${c.total} listings`));
  console.log("\n✅ Agente Facebook completado");
}

ejecutar().catch((err) => {
  console.error("❌ Error fatal:", err.message);
  process.exit(1);
});

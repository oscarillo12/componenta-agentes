// agentes/facebook-publish.js
// Publica piezas del inventario en Facebook Marketplace.
// Prerrequisito: fb-session.json válido (correr facebook.js al menos una vez).
// Límite: MAX_POR_CORRIDA publicaciones por corrida para evitar detección.
// Uso: node agentes/facebook-publish.js

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const path  = require("path");
const fs    = require("fs");
const os    = require("os");
const { supabase } = require("./supabase-client");

chromium.use(StealthPlugin());

const SESION_PATH    = path.join(__dirname, "fb-session.json");
const MAX_POR_CORRIDA = 5; // no subir más de 5 por corrida para no gatillar límites de FB

const PAUSA = (min, max) =>
  new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));

// ── Imagen temporal ───────────────────────────────────────────────────────────

async function descargarImagenTemp(url) {
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const ext = (res.headers.get("content-type") ?? "").includes("png") ? "png" : "jpg";
    const tmpPath = path.join(os.tmpdir(), `fb_pub_${Date.now()}.${ext}`);
    fs.writeFileSync(tmpPath, Buffer.from(buffer));
    return tmpPath;
  } catch {
    return null;
  }
}

// ── Sesión ────────────────────────────────────────────────────────────────────

async function cargarSesion(context) {
  if (!fs.existsSync(SESION_PATH)) return false;
  try {
    const { cookies } = JSON.parse(fs.readFileSync(SESION_PATH, "utf8"));
    await context.addCookies(cookies);
    return true;
  } catch {
    return false;
  }
}

async function verificarSesionActiva(page) {
  await page.goto("https://www.facebook.com", { waitUntil: "domcontentloaded", timeout: 30000 });
  await PAUSA(2000, 3000);
  return !page.url().includes("login");
}

// ── Publicar en Marketplace ───────────────────────────────────────────────────

async function publicarPieza(page, product) {
  const titulo = [product.pieza, product.marca, product.modelo]
    .filter(Boolean).join(" ").substring(0, 99);

  const estadoLabel = {
    excelente:      "Excelente estado — como nuevo.",
    bueno:          "Buen estado — funciona perfectamente.",
    "con-detalles": "Con detalles menores — funciona bien.",
    "para-reparar": "Para reparar.",
  }[product.estado] ?? "";

  const descripcion = [
    estadoLabel,
    product.descripcion ?? "",
    product.oem ? `N° de parte OEM: ${product.oem}` : "",
    product.envio ? `Envío: ${product.envio}` : "",
    "Pieza extraída de desarmaduria. Verificada antes de publicar.",
    "Consultas sin compromiso al WhatsApp.",
  ].filter(Boolean).join("\n");

  const imgPath = await descargarImagenTemp(product.imagen_url);

  await page.goto("https://www.facebook.com/marketplace/create/item", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await PAUSA(3000, 5000);

  // Screenshot inicial para debug si algo falla
  const debugPath = path.join(__dirname, `debug-publish-${product.id}.png`);

  try {
    // ── 1. Foto ──────────────────────────────────────────────────────────────
    if (imgPath) {
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(imgPath);
        await PAUSA(2500, 4000);
        console.log("      📷 Foto subida");
      }
    }

    // ── 2. Título ─────────────────────────────────────────────────────────────
    const tituloInput = await page.waitForSelector(
      '[aria-label="Título"], [aria-label="Title"], [placeholder*="título" i], [placeholder*="title" i]',
      { timeout: 10000 }
    ).catch(() => null);

    if (tituloInput) {
      await tituloInput.click({ clickCount: 3 });
      await PAUSA(200, 400);
      await tituloInput.type(titulo, { delay: 45 });
      await PAUSA(600, 1000);
    } else {
      // Fallback: buscar inputs visibles en el formulario
      const inputs = await page.$$('input[type="text"]:visible');
      if (inputs[0]) {
        await inputs[0].click({ clickCount: 3 });
        await inputs[0].type(titulo, { delay: 45 });
      }
    }

    // ── 3. Precio ─────────────────────────────────────────────────────────────
    const precioInput = await page.$(
      '[aria-label="Precio"], [aria-label="Price"], [placeholder*="precio" i], [placeholder*="price" i]'
    );
    if (precioInput) {
      await precioInput.click({ clickCount: 3 });
      await PAUSA(200, 400);
      await precioInput.type(String(product.precio), { delay: 45 });
      await PAUSA(600, 1000);
    }

    // ── 4. Categoría ─────────────────────────────────────────────────────────
    try {
      const catInput = await page.$(
        '[aria-label="Categoría" i], [aria-label="Category" i], [placeholder*="categoría" i]'
      );
      if (catInput) {
        await catInput.click();
        await PAUSA(800, 1200);
        await catInput.fill("Piezas");
        await PAUSA(1200, 1800);
        const opt = await page.$('[role="option"]:first-child');
        if (opt) { await opt.click(); await PAUSA(500, 800); }
      }
    } catch { /* categoría opcional */ }

    // ── 5. Condición → Usado ─────────────────────────────────────────────────
    try {
      const condBtn = await page.$('[aria-label="Condición" i], [aria-label="Condition" i]');
      if (condBtn) {
        await condBtn.click();
        await PAUSA(600, 900);
        const usadoOpt = await page.$(
          '[role="option"]:has-text("Usado"), [role="option"]:has-text("Used")'
        );
        if (usadoOpt) { await usadoOpt.click(); await PAUSA(400, 700); }
      }
    } catch { /* condición opcional */ }

    // ── 6. Descripción ───────────────────────────────────────────────────────
    const descInput = await page.$(
      '[aria-label="Descripción" i], [aria-label="Description" i], ' +
      '[placeholder*="descripción" i], [placeholder*="description" i]'
    );
    if (descInput) {
      await descInput.click();
      await PAUSA(300, 600);
      await descInput.type(descripcion, { delay: 20 });
      await PAUSA(800, 1200);
    }

    // ── 7. Siguiente → Publicar (hasta 3 pasos) ───────────────────────────────
    for (let step = 0; step < 3; step++) {
      await PAUSA(1500, 2500);
      const btn = await page.$(
        '[data-testid="marketplace-listing-composer-submit-button"], ' +
        'div[role="button"]:has-text("Siguiente"), div[role="button"]:has-text("Publicar"), ' +
        'div[role="button"]:has-text("Next"), div[role="button"]:has-text("Publish")'
      );
      if (!btn) break;
      const txt = (await btn.textContent() ?? "").toLowerCase();
      await btn.click();
      await PAUSA(3000, 5000);
      if (txt.includes("public") || txt.includes("publish")) break;
    }

    // ── 8. Esperar redirección y obtener ID ───────────────────────────────────
    await PAUSA(4000, 7000);
    const finalUrl = page.url();
    const idMatch  = finalUrl.match(/\/item\/(\d+)/);
    const fb_item_id  = idMatch ? idMatch[1] : null;
    const fb_permalink = fb_item_id
      ? `https://www.facebook.com/marketplace/item/${fb_item_id}/`
      : null;

    if (!fb_item_id) {
      await page.screenshot({ path: debugPath });
      throw new Error(`Sin ID en URL "${finalUrl}" — revisa ${debugPath}`);
    }

    return { fb_item_id, fb_permalink };

  } finally {
    if (imgPath && fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function ejecutar() {
  console.log("📤 Agente Facebook Publisher — iniciando...\n");

  const { data: productos, error } = await supabase
    .from("products")
    .select("*")
    .contains("canales", ["facebook"])
    .is("fb_item_id", null)
    .eq("disponible", true)
    .limit(MAX_POR_CORRIDA);

  if (error) {
    console.error("❌ Error leyendo productos:", error.message);
    process.exit(1);
  }

  if (!productos?.length) {
    console.log("✅ Sin productos pendientes de publicar en Facebook Marketplace");
    return;
  }

  console.log(`📦 ${productos.length} producto(s) pendientes (máx ${MAX_POR_CORRIDA}/corrida)\n`);

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
    viewport:   { width: 1280, height: 800 },
    locale:     "es-CL",
    timezoneId: "America/Santiago",
  });

  const page = await context.newPage();

  await cargarSesion(context);
  const sesionActiva = await verificarSesionActiva(page);

  if (!sesionActiva) {
    await browser.close();
    console.error("❌ Sesión de Facebook expirada.");
    console.error("   Corre primero: node agentes/facebook.js  (para renovar la sesión)");
    process.exit(1);
  }

  let publicados = 0;
  let errores    = 0;

  for (const product of productos) {
    console.log(`   ⬆️  "${product.pieza}" (${product.id})`);
    try {
      const { fb_item_id, fb_permalink } = await publicarPieza(page, product);

      await supabase.from("products").update({
        fb_item_id,
        fb_permalink,
        canales: [...new Set([...(product.canales ?? []), "facebook"])],
      }).eq("id", product.id);

      console.log(`   ✅ Publicado: ${fb_permalink}`);
      publicados++;
    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
      errores++;
    }

    // Pausa larga entre publicaciones para no gatillar límites de FB
    if (publicados + errores < productos.length) {
      const espera = Math.floor(Math.random() * 7000 + 8000);
      console.log(`   ⏳ Esperando ${Math.round(espera / 1000)}s antes del siguiente...`);
      await PAUSA(espera, espera + 2000);
    }
  }

  await browser.close();
  console.log(`\n📊 Resultado: ${publicados} publicados, ${errores} errores`);
  console.log("✅ Agente Facebook Publisher completado");
}

ejecutar().catch((err) => {
  console.error("❌ Error fatal:", err.message);
  process.exit(1);
});

// ia/identificarPieza.js
const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MODELOS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite"];

function buildPrompt(vehicleHint) {
  const ctx = vehicleHint
    ? `\nCONTEXTO CRÍTICO: Esta pieza pertenece a un ${vehicleHint.marca} ${vehicleHint.modelo} año ${vehicleHint.anio}. Usa este dato para identificar con mayor certeza la pieza y proporcionar el código OEM exacto.\n`
    : "";

  return `Eres un experto en repuestos automotrices con acceso a catálogos OEM de todas las marcas. Trabajas para Componenta, un marketplace chileno de piezas usadas.
${ctx}
Analiza esta imagen de una pieza usada de automóvil. Responde EXCLUSIVAMENTE con un JSON válido, sin markdown ni explicaciones:

{
  "esPieza": true,
  "pieza": "nombre exacto en español (ej: Cuerpo de aceleración, Bomba de agua, Alternador)",
  "categoria": "Motor / Suspensión / Eléctrico / Frenos / Transmisión / Carrocería / Interior / Escape",
  "marca": "${vehicleHint?.marca ?? "fabricante del vehículo al que pertenece"}",
  "oem": "CÓDIGO OEM del fabricante${vehicleHint ? ` para el ${vehicleHint.marca} ${vehicleHint.modelo} ${vehicleHint.anio}` : ""}. Si reconoces la pieza y el vehículo, proporciona el código aunque no sea visible. Formato sin guiones extra. null solo si genuinamente desconoces.",
  "compatibilidad": [
    {"marca": "${vehicleHint?.marca ?? "Toyota"}", "modelo": "${vehicleHint?.modelo ?? "Yaris"}", "anios": "${vehicleHint ? `${vehicleHint.anio}-${vehicleHint.anio}` : "2014-2020"}"}
  ],
  "confianza": 94,
  "precioSugeridoMinCLP": 25000,
  "precioSugeridoMaxCLP": 60000,
  "descripcion": "Descripción de venta de 2-3 frases, natural y persuasiva, en español de Chile",
  "motivo": null
}

Reglas:
- Si NO es una pieza automotriz, responde con esPieza:false y explica en motivo
- confianza: 0-100 según certeza de identificación
- compatibilidad: lista todos los vehículos compatibles que conozcas (al menos el principal)
- anios siempre en formato "YYYY-YYYY"
- precio: rango realista para piezas USADAS en Chile (CLP)`;
}

function archivoABase64(rutaArchivo) {
  return fs.readFileSync(rutaArchivo).toString("base64");
}

function mimeTypeDesdeRuta(ruta) {
  const ext = ruta.split(".").pop().toLowerCase();
  if (ext === "png")  return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

async function _intentarModelo(modelName, imagenBase64, mimeType, vehicleHint) {
  const respuesta = await ai.models.generateContent({
    model: modelName,
    contents: [{
      role: "user",
      parts: [
        { text: buildPrompt(vehicleHint) },
        { inlineData: { mimeType, data: imagenBase64 } },
      ],
    }],
    config: { temperature: 0.3, responseMimeType: "application/json" },
  });

  const texto = respuesta.text;
  const match = texto.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Respuesta IA no válida");
  return JSON.parse(match[0]);
}

/**
 * Identifica una pieza automotriz a partir de una foto.
 * @param {string} rutaImagen - ruta local del archivo
 * @param {object|null} vehicleHint - { marca, modelo, anio } opcional
 * @returns {Promise<object>} ficha estructurada
 */
async function identificarPieza(rutaImagen, vehicleHint = null) {
  const imagenBase64 = archivoABase64(rutaImagen);
  const mimeType = mimeTypeDesdeRuta(rutaImagen);

  let ultimoError = null;
  for (const modelo of MODELOS) {
    try {
      console.log(`[IA] Intentando ${modelo}…`);
      const ficha = await _intentarModelo(modelo, imagenBase64, mimeType, vehicleHint);
      console.log(`[IA] Éxito con ${modelo}`);
      return ficha;
    } catch (err) {
      const msg = String(err?.message || err);
      console.warn(`[IA] ${modelo} falló: ${msg}`);
      if (msg.includes("503") || msg.includes("429") || msg.includes("overload")) {
        ultimoError = err;
        continue;
      }
      throw err;
    }
  }
  throw ultimoError || new Error("Todos los modelos fallaron");
}

module.exports = { identificarPieza };

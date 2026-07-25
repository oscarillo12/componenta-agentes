// Scheduler de agentes Componenta
// MeLi Publisher:  1x/día — 09:00
// MeLi Scraper:    4x/día — 00:00, 06:00, 12:00, 18:00
// Facebook:        3x/día — 01:00, 09:00, 17:00

require('dotenv').config({ path: require('path').join(__dirname, '../.env') })

const cron = require('node-cron')
const { spawn } = require('child_process')
const path = require('path')

let corriendo = false

function correrAgente(script) {
  return new Promise((resolve) => {
    const nombre = path.basename(script, '.js')
    console.log(`\n[${new Date().toISOString()}] ▶ Iniciando ${nombre}...`)

    const child = spawn('node', [path.join(__dirname, script)], {
      cwd: path.join(__dirname, '..'),
      env: process.env,
      stdio: 'inherit',
    })

    child.on('close', (code) => {
      console.log(`[${new Date().toISOString()}] ■ ${nombre} terminó (código ${code})`)
      resolve(code)
    })
  })
}

async function cicloCompleto() {
  if (corriendo) {
    console.log('⚠️  Ya hay un ciclo en curso, saltando...')
    return
  }
  corriendo = true
  try {
    await correrAgente('meli-scraper.js')    // llena vitrina con repuestos de MeLi
    await correrAgente('facebook.js')        // llena vitrina con repuestos de Facebook
    await correrAgente('facebook-publish.js') // publica piezas propias en FB Marketplace
  } finally {
    corriendo = false
  }
}

// MeLi Scraper vitrina: 00:00 / 06:00 / 12:00 / 18:00
cron.schedule('0 0,6,12,18 * * *', () => correrAgente('meli-scraper.js'), {
  timezone: 'America/Santiago',
})

// Facebook: 01:00 / 09:00 / 17:00 (incluye subida de imágenes a Storage)
cron.schedule('0 1,9,17 * * *', () => correrAgente('facebook.js'), {
  timezone: 'America/Santiago',
})

// MeLi Publisher (publica piezas propias a MeLi): 09:00
cron.schedule('0 9 * * *', () => correrAgente('meli.js'), {
  timezone: 'America/Santiago',
})

console.log('🕐 Scheduler Componenta iniciado')
console.log('   MeLi Scraper  → 00:00 / 06:00 / 12:00 / 18:00 (Santiago)')
console.log('   Facebook      → 01:00 / 09:00 / 17:00 (Santiago)')
console.log('   MeLi Publisher → 09:00 (Santiago)')
console.log('')

// Correr scraper al arrancar para poblar la DB inmediatamente
cicloCompleto()

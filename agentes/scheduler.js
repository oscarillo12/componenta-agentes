// Scheduler de agentes Componenta
// MercadoLibre: 4x/día — 00:00, 06:00, 12:00, 18:00
// Facebook:     3x/día — 01:00, 09:00, 17:00

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

async function correrSecuencial() {
  if (corriendo) {
    console.log('⚠️  Ya hay un ciclo en curso, saltando...')
    return
  }
  corriendo = true
  try {
    await correrAgente('meli.js')
    await correrAgente('facebook.js')
  } finally {
    corriendo = false
  }
}

// MercadoLibre solo: 06:00, 12:00, 18:00 (el de 00:00 lo hace el ciclo completo)
cron.schedule('0 6,12,18 * * *', () => correrAgente('meli.js'), {
  timezone: 'America/Santiago',
})

// Ciclo completo: 00:00 y 09:00
cron.schedule('0 0,9 * * *', correrSecuencial, {
  timezone: 'America/Santiago',
})

// Facebook por su cuenta: 17:00
cron.schedule('0 17 * * *', () => correrAgente('facebook.js'), {
  timezone: 'America/Santiago',
})

console.log('🕐 Scheduler Componenta iniciado')
console.log('   MeLi  → 00:00 / 06:00 / 12:00 / 18:00 (Santiago)')
console.log('   FB    → 00:00 / 09:00 / 17:00 (Santiago)')
console.log('')

// Correr ambos al arrancar para poblar la DB inmediatamente
correrSecuencial()

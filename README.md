# Componenta

El mostrador digital de tu desarmaduría. Sube una foto de un repuesto, la IA
genera la ficha (nombre, categoría, vehículo probable, descripción y precio
sugerido) en segundos, y queda publicado en tu vitrina pública.

## Requisitos

- Node.js 18 o superior (verifica con `node -v`)
- Una API key gratuita de Gemini: https://aistudio.google.com/app/apikey

## Instalación (primera vez)

```bash
npm install
```

## Configurar tu API key

1. Copia el archivo de ejemplo:
   ```bash
   copy .env.example .env
   ```
   (en Mac/Linux: `cp .env.example .env`)

2. Abre `.env` con cualquier editor de texto y pega tu API key de Gemini:
   ```
   GEMINI_API_KEY=tu_api_key_real_aqui
   ```

## Correr el proyecto

```bash
npm run dev
```

Luego abre en tu navegador:

- **Vitrina pública** (lo que verían tus clientes): http://localhost:3000
- **Panel del vendedor** (donde subes fotos): http://localhost:3000/vendedor/ingresar

## Cómo funciona el flujo

1. El vendedor entra a `/vendedor/ingresar`, pone su nombre y teléfono (no
   necesita contraseña, pensado para que cualquier dueño de desarmaduría
   pueda usarlo sin fricción).
2. En el panel, sube una foto del repuesto.
3. Gemini analiza la foto y devuelve: nombre, categoría, marca/modelo de
   vehículo probable, estado visual, descripción de venta y un rango de
   precio sugerido.
4. El vendedor revisa esa ficha (puede editar cualquier campo) y la publica.
5. La pieza aparece automáticamente en la vitrina pública `/`, donde
   cualquier visitante puede buscarla y contactar al vendedor por WhatsApp.

## Estructura del proyecto

```
componenta/
├── index.js              servidor principal (Express)
├── db/index.js            base de datos (archivo JSON local)
├── ia/identificarPieza.js  conexión con Gemini Vision
├── routes/
│   ├── vendedor.js         rutas del panel del vendedor
│   └── vitrina.js          rutas de la vitrina pública
├── views/                  plantillas EJS (HTML)
└── public/
    ├── css/estilos.css     estilos visuales
    └── uploads/             fotos subidas por vendedores
```

## Próximos pasos sugeridos (cuando quieras crecer)

- **Subir a internet de verdad**: hoy corre solo en tu computador
  (`localhost`). Para que sea accesible como `componenta.cl`, se sube a un
  hosting (ej. Railway, Render, o un VPS) y se conecta el dominio.
- **Base de datos más robusta**: el archivo JSON (`db/componenta.json`) es
  perfecto para probar con tus primeros 5-10 vendedores piloto. Si crece
  mucho, se migra a PostgreSQL sin tocar las rutas, solo `db/index.js`.
- **Cobrar suscripción a otras desarmadurías**: se puede integrar Flow,
  MercadoPago o Webpay (pasarelas de pago chilenas) para que otras
  desarmadurías paguen una mensualidad por usar Componenta.
- **Repuestos nuevos**: el modelo de datos ya soporta agregar un campo
  `tipo: "usado" | "nuevo"` cuando quieras sumar esa línea de negocio.

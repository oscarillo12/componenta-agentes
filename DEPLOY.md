# Deploy de agentes Componenta en VPS

## Requisitos del VPS
- Ubuntu 22.04 LTS (DigitalOcean Basic $6/mes o Contabo VPS S)
- 1 vCPU / 1 GB RAM mínimo (2 GB recomendado para Chromium)
- Docker + Docker Compose instalados

---

## 1. Instalar Docker en el VPS (solo la primera vez)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

---

## 2. Copiar archivos al VPS

Desde tu máquina local (Windows), usa `scp` o FileZilla para subir:

```bash
# Copia todo el proyecto (reemplaza IP con la del VPS)
scp -r "C:\Users\user\Downloads\COMPONENTA\componenta" root@IP_DEL_VPS:/opt/componenta-agentes

# O si usas SSH key:
scp -i ~/.ssh/id_rsa -r "C:\Users\user\Downloads\COMPONENTA\componenta" root@IP_DEL_VPS:/opt/componenta-agentes
```

---

## 3. Configurar el .env en el VPS

Conéctate al VPS y crea el archivo `.env`:

```bash
ssh root@IP_DEL_VPS
cd /opt/componenta-agentes
nano .env
```

Pega este contenido (reemplaza con tus valores reales):

```
PORT=3000
SUPABASE_URL=https://baibggmxuczcyoqslglw.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
FACEBOOK_EMAIL=comprarecordchile@gmail.com
FACEBOOK_PASSWORD=tu_password
GEMINI_API_KEY=tu_gemini_key
SITE_URL=http://localhost:3000
```

---

## 4. Levantar el contenedor

```bash
cd /opt/componenta-agentes
docker compose up -d --build
```

Verifica que esté corriendo:

```bash
docker compose ps
docker compose logs -f --tail=50
```

---

## 5. Verificar que el scheduler está activo

```bash
docker compose logs agentes | grep Scheduler
# Debe mostrar:
# ⏰ Scheduler activo:
#    MercadoLibre → 8am, 12pm, 4pm, 8pm (Santiago)
#    Facebook     → 9am, 3pm, 9pm (Santiago)
```

---

## Actualizar después de cambios en el código

```bash
# Sube los archivos nuevos al VPS, luego:
docker compose up -d --build
```

---

## Sesión de Facebook — qué hacer cuando expira

La sesión de Facebook dura ~30-60 días. Cuando el agente falle con error de login:

**Paso 1 — En tu máquina local**, cambia `headless: false` en `agentes/facebook.js` temporalmente:
```js
const browser = await chromium.launch({ headless: false, ... })
```

**Paso 2** — Corre el agente localmente:
```bash
cd "C:\Users\user\Downloads\COMPONENTA\componenta"
node agentes/facebook.js
```
Aprueba el 2FA en tu teléfono si Facebook lo pide. El agente guarda la nueva sesión en `agentes/fb-session.json`.

**Paso 3** — Sube el archivo al VPS:
```bash
scp "C:\Users\user\Downloads\COMPONENTA\componenta\agentes\fb-session.json" root@IP_DEL_VPS:/opt/componenta-agentes/agentes/fb-session.json
```

**Paso 4** — Vuelve a cambiar `headless: true` y haz deploy:
```bash
docker compose up -d --build
```

---

## Comandos útiles

```bash
# Ver logs en tiempo real
docker compose logs -f agentes

# Detener
docker compose down

# Reiniciar
docker compose restart agentes

# Correr un agente manualmente dentro del contenedor
docker compose exec agentes node agentes/meli.js
docker compose exec agentes node agentes/facebook.js

# Ver uso de recursos
docker stats
```

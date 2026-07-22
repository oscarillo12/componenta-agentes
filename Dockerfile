# Imagen oficial de Playwright con Chromium, Node 20 y todas las deps del SO
FROM mcr.microsoft.com/playwright/node:20-noble

WORKDIR /app

# Instalar dependencias (sin devDependencies)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copiar código (sin .env ni node_modules — ver .dockerignore)
COPY . .

EXPOSE 3000

CMD ["node", "index.js"]

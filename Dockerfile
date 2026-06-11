# Estágio 1: Build
FROM node:22-alpine AS builder
WORKDIR /app

# Copia apenas os arquivos de dependência
COPY package*.json ./

# Instala apenas as dependências de produção de forma limpa
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts

# Copia apenas os arquivos necessários do projeto
COPY index.js ./
COPY public ./public
COPY views ./views

# Estágio 2: Runtime (Imagem final enxuta)
FROM node:22-alpine AS runtime
WORKDIR /app

# Atualiza pacotes do sistema por segurança
RUN apk update && apk upgrade --no-cache

# Copia os arquivos do builder aplicando a permissão ao usuário 'node' (que já existe na imagem)
COPY --from=builder --chown=node:node /app /app

# Define o usuário seguro
USER node
EXPOSE 3000

# Healthcheck corrigido (em uma única linha para evitar falhas de parse)
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 CMD node -e "require('http').get('http://localhost:3000/', res => { if (![200,302].includes(res.statusCode)) process.exit(1) }, err => process.exit(1))"

CMD ["node", "index.js"]

# Amser — imagem de produção (Next.js + Prisma + sharp).
# Uso local: docker compose --profile app up --build
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Variáveis só para o build (não são usadas em runtime).
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" SESSION_SECRET="build-only-secret-build-only-secret-xx" npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && groupadd -r amser && useradd -r -g amser amser \
  && mkdir -p /data/uploads && chown -R amser:amser /data
# A pasta das fotos já pertence ao usuário do app: um volume nomeado novo herda esse dono.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build --chown=amser:amser /app/package.json /app/package-lock.json ./
COPY --from=build --chown=amser:amser /app/node_modules ./node_modules
COPY --from=build --chown=amser:amser /app/.next ./.next
COPY --from=build --chown=amser:amser /app/public ./public
COPY --from=build --chown=amser:amser /app/prisma ./prisma
COPY --from=build --chown=amser:amser /app/scripts ./scripts
COPY --from=build --chown=amser:amser /app/src ./src
COPY --from=build --chown=amser:amser /app/next.config.ts /app/tsconfig.json ./
USER amser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Aplica migrations e sobe o servidor.
CMD ["sh", "-c", "npx prisma migrate deploy && node scripts/bootstrap.mjs && npx next start -p ${PORT}"]

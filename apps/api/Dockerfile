FROM node:20-alpine AS builder
WORKDIR /repo

# Instalar dependencias del workspace
COPY package*.json ./
COPY packages/shared/package*.json packages/shared/
COPY apps/api/package*.json apps/api/
RUN npm ci

# Copiar fuentes
COPY turbo.json tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/

# Build: shared → Prisma client → API
RUN npm run build --workspace=packages/shared
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma
RUN npm run build --workspace=apps/api

# Eliminar devDependencies para el runtime
RUN npm prune --omit=dev && mkdir -p apps/api/node_modules

# ---- runtime ----
FROM node:20-alpine
WORKDIR /repo
ENV NODE_ENV=production

COPY --from=builder /repo/node_modules ./node_modules
# npm deja aquí las dependencias con conflicto de versión (p. ej. @nestjs/swagger).
COPY --from=builder /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /repo/packages/shared ./packages/shared
COPY --from=builder /repo/apps/api/dist ./apps/api/dist
COPY --from=builder /repo/apps/api/prisma ./apps/api/prisma
COPY --from=builder /repo/apps/api/package.json ./apps/api/
COPY --from=builder /repo/package.json ./
# La documentación de la web: la lee el copiloto del administrador (admin-copilot.docs.ts).
COPY apps/web/content/docs ./apps/web/content/docs

# Script de arranque: migra la DB y luego inicia el servidor
COPY apps/api/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /repo/apps/api
EXPOSE 3001
ENTRYPOINT ["/entrypoint.sh"]

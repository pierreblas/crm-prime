FROM node:20-alpine AS builder
WORKDIR /repo

# Variables NEXT_PUBLIC_* se hornean en el bundle en tiempo de build
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WHATSAPP_APP_ID
ARG NEXT_PUBLIC_WHATSAPP_CONFIG_ID
ARG NEXT_PUBLIC_COMPANY_NAME
ARG NEXT_PUBLIC_CONTACT_EMAIL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WHATSAPP_APP_ID=$NEXT_PUBLIC_WHATSAPP_APP_ID \
    NEXT_PUBLIC_WHATSAPP_CONFIG_ID=$NEXT_PUBLIC_WHATSAPP_CONFIG_ID \
    NEXT_PUBLIC_COMPANY_NAME=$NEXT_PUBLIC_COMPANY_NAME \
    NEXT_PUBLIC_CONTACT_EMAIL=$NEXT_PUBLIC_CONTACT_EMAIL

# La dirección pública de la web, para las páginas que se escriben en el build
# (documentación, blog, mapa del sitio): con ella salen bien el canónico y la
# imagen al compartir. Solo viven en esta etapa; en ejecución mandan las del compose.
ARG NEXT_PUBLIC_SITE_URL
ARG SAAS_BASE_DOMAIN
ARG AUTH_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    SAAS_BASE_DOMAIN=$SAAS_BASE_DOMAIN \
    AUTH_URL=$AUTH_URL

# Instalar dependencias del workspace
COPY package*.json ./
COPY packages/shared/package*.json packages/shared/
COPY apps/web/package*.json apps/web/
RUN npm ci

# Copiar fuentes
COPY turbo.json tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/

# Build: shared → Next.js (genera output standalone)
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=apps/web

# ---- runtime ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# El standalone de Next.js (con outputFileTracingRoot=monorepo-root)
# coloca todo en .next/standalone/ con la estructura del monorepo.
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public ./apps/web/public

EXPOSE 3000
# El servidor arranca desde la raíz del standalone
CMD ["node", "apps/web/server.js"]

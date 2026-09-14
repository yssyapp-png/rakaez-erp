FROM node:26-alpine AS web-dependencies
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts

FROM web-dependencies AS web-build
COPY frontend/ ./
ARG VITE_API_BASE_URL=/api
ARG VITE_MOYASAR_PUBLISHABLE_KEY=
ARG VITE_PAYMENTS_ENABLED=false
ARG VITE_PUBLIC_REGISTRATION_ENABLED=false
ARG VITE_MOYASAR_SCRIPT_INTEGRITY=
ARG VITE_MOYASAR_STYLE_INTEGRITY=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_MOYASAR_PUBLISHABLE_KEY=$VITE_MOYASAR_PUBLISHABLE_KEY
ENV VITE_PAYMENTS_ENABLED=$VITE_PAYMENTS_ENABLED
ENV VITE_PUBLIC_REGISTRATION_ENABLED=$VITE_PUBLIC_REGISTRATION_ENABLED
ENV VITE_MOYASAR_SCRIPT_INTEGRITY=$VITE_MOYASAR_SCRIPT_INTEGRITY
ENV VITE_MOYASAR_STYLE_INTEGRITY=$VITE_MOYASAR_STYLE_INTEGRITY
RUN npm run build

FROM node:26-alpine AS dependencies
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:26-alpine
ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-proto=throw \
    HEALTHCHECK_HOST=rakaezerp.sa
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY backend/package.json backend/package-lock.json ./
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY backend/certs ./certs
COPY --from=web-build /web/dist ./public
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health',{headers:{'X-Forwarded-Proto':'https','Host':process.env.HEALTHCHECK_HOST||'rakaezerp.sa'}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]

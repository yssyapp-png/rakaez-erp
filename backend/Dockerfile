FROM node:24-alpine AS web-dependencies
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts

FROM web-dependencies AS web-build
COPY frontend/ ./
ARG VITE_API_BASE_URL=/api
ARG VITE_MOYASAR_PUBLISHABLE_KEY=
ARG VITE_PAYMENTS_ENABLED=false
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_MOYASAR_PUBLISHABLE_KEY=$VITE_MOYASAR_PUBLISHABLE_KEY
ENV VITE_PAYMENTS_ENABLED=$VITE_PAYMENTS_ENABLED
RUN npm run build

FROM node:24-alpine AS dependencies
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY backend/package.json backend/package-lock.json ./
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY --from=web-build /web/dist ./public
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]

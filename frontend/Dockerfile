FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 10001 sgr && adduser --system --uid 10001 --ingroup sgr sgr
COPY --from=build --chown=sgr:sgr /app/.next/standalone ./
COPY --from=build --chown=sgr:sgr /app/.next/static ./.next/static
USER sgr
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]

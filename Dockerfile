# syntax=docker/dockerfile:1.7

# ---- build stage: compile TS, prune dev deps ----
FROM node:20-alpine AS build
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY widgets ./widgets
RUN pnpm build && pnpm prune --prod

# ---- runtime stage: minimal image with only what's needed at runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# tini handles PID 1 signal forwarding so SIGTERM from Railway shuts the
# Node process down cleanly instead of hanging until the kill timeout.
RUN apk add --no-cache tini

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/widgets ./widgets
COPY package.json ./

# Railway injects $PORT; the http entrypoint reads it.
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/http.js"]

FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1-alpine AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json tsconfig.server.json svelte.config.js vite.config.ts ./
COPY src ./src
COPY public ./public
RUN bun run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/build ./build
COPY public ./public
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "dist/server.js"]

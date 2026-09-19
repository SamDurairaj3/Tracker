FROM node:24-bookworm-slim AS build

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN npm install --global --no-audit --no-fund pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-bookworm-slim AS production-deps

WORKDIR /app
RUN npm install --global --no-audit --no-fund pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apt-get update \
    && apt-get install --no-install-recommends -y gosu \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global --no-audit --no-fund pnpm@11.19.0
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next-node ./.next-node
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/db ./db
COPY --from=build --chown=node:node /app/lib ./lib
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/package.json /app/next.config.ts /app/tsconfig.json ./
COPY infra/docker/pi/web-entrypoint.sh /usr/local/bin/tracker-web-entrypoint.sh
EXPOSE 5173
ENTRYPOINT ["/bin/sh", "/usr/local/bin/tracker-web-entrypoint.sh"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "5173"]

FROM oven/bun:1.4.4
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts
ARG VITE_LOT_CONTRACT
RUN cd apps/web && bun --bun vite build
WORKDIR /app/apps/web
CMD ["bun", ".output/server/index.mjs"]

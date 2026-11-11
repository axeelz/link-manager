FROM oven/bun:1.4.4-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY src src
COPY web web
COPY migrations migrations

USER bun
EXPOSE 3500
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD ["bun", "-e", "const r = await fetch('http://localhost:3500/api/health'); process.exit(r.ok ? 0 : 1)"]
CMD ["bun", "src/index.ts"]

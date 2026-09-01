FROM oven/bun:1.1.38-slim

WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

EXPOSE 3000

CMD ["sh", "-c", "bun run migration:up && bun run start"]

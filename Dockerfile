FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4317 GAUGECRAFT_DB=/data/gaugecraft.sqlite REQUIRE_EXISTING_DB=1
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/config ./config
COPY --from=build /app/package.json /app/SOURCES.md /app/PLAN.md ./
EXPOSE 4317
CMD ["node", "--import", "tsx", "server/index.ts", "--production"]

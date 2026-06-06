FROM node:22-bookworm-slim AS build

ARG APP_NAME

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /workspace

RUN corepack enable
RUN corepack prepare pnpm@10.12.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml nx.json tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/job-manager/package.json apps/job-manager/package.json
COPY apps/scraper/package.json apps/scraper/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/logger/package.json packages/logger/package.json
COPY packages/messaging/package.json packages/messaging/package.json
COPY packages/persistence/package.json packages/persistence/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/tracing/package.json packages/tracing/package.json

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm nx run ${APP_NAME}:build

FROM node:22-bookworm-slim AS runtime

ARG APP_PORT
ARG APP_ENTRYPOINT

ENV NODE_ENV=production
ENV APP_PORT=${APP_PORT}
ENV APP_ENTRYPOINT=${APP_ENTRYPOINT}

WORKDIR /workspace

COPY --from=build /workspace /workspace

EXPOSE ${APP_PORT}

CMD ["sh", "-c", "node \"$APP_ENTRYPOINT\""]

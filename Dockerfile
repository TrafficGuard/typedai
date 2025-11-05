# Production Dockerfile
FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive

# Update package lists without signature verification to avoid "At least one invalid signature was encountered." on debian repos
RUN apt-get -o Acquire::Check-Valid-Until=false -o Acquire::AllowInsecureRepositories=true -o Acquire::AllowDowngradeToInsecureRepositories=true update

# 1) Base OS deps (git, toolchain for node-gyp, curl, CA certs)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      build-essential \
      gcc \
      g++ \
      make \
    && rm -rf /var/lib/apt/lists/*

# 2) Node.js 22 via NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get update && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

# 3) Enable corepack and pin pnpm
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# 4) Create non-root user and group
ARG APP_USER=typedai
ARG APP_GROUP=typedai
ARG APP_HOME=/home/${APP_USER}
RUN groupadd -r ${APP_GROUP} && useradd -r -m -g ${APP_GROUP} ${APP_USER}

WORKDIR ${APP_HOME}

# 5) Copy only lock/manifests (layer caching), and husky install script if used during install
COPY --chown=${APP_USER}:${APP_GROUP} package*.json pnpm-lock.yaml ./
RUN mkdir -p .husky
COPY --chown=${APP_USER}:${APP_GROUP} .husky/install.mjs .husky/install.mjs

# 6) Install dependencies as non-root so node_modules is owned by the app user
USER ${APP_USER}
RUN pnpm config set store-dir ${APP_HOME}/.pnpm-store
RUN pnpm install --frozen-lockfile

# 7) Copy the rest of the project (including .git, if present) with proper ownership
USER root
COPY --chown=${APP_USER}:${APP_GROUP} . .
RUN ls -la .typedai/functions/ || echo ".typedai/functions does not exist"

# 8) Switch back to non-root user for all remaining steps and runtime
USER ${APP_USER}

# Optional: allow Git to operate in APP_HOME (not strictly needed if ownership matches, but harmless)
RUN git config --global --add safe.directory ${APP_HOME}

# 9) Project-specific prefetch/build steps (now writable by ${APP_USER}
# Download the tiktokenizer model, which is written to node_modules/@microsoft/tiktokenizer/model
RUN pnpm run initTiktokenizer
# Function schemas are already copied from the build, but run generation to ensure any missing ones are created
# Disabled for now due to OOM errors, so ensure they are updated and committed
# RUN pnpm run functionSchemas

# 10) Runtime configuration
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Build will have performed type checking. Use esbuild-register for efficiency
CMD ["node", "-r", "esbuild-register", "--env-file=variables/.env", "src/index.ts"]

# Production Dockerfile
FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive

# Update package lists without signature verification to avoid "At least one invalid signature was encountered." on debian repos
RUN apt-get -o Acquire::Check-Valid-Until=false -o Acquire::AllowInsecureRepositories=true -o Acquire::AllowDowngradeToInsecureRepositories=true update

# make g++ gcc build-essential are needed for node-gyp
RUN apt-get install -y curl make g++ gcc build-essential git && \
    curl -sL https://deb.nodesource.com/setup_22.x -o nodesource_setup.sh && \
    bash ./nodesource_setup.sh && \
    apt-get install -y nodejs && \
    rm nodesource_setup.sh && \
    npm install -g pnpm

ENV user=typedai
ENV homedir=/home/typedai/

RUN useradd --create-home -g users typedai
WORKDIR $homedir

RUN mkdir ".husky"
COPY .husky/install.mjs .husky/install.mjs

COPY package*.json pnpm-lock.yaml ./
RUN pnpm install

COPY . .

# Download the tiktokenizer model, which is written to node_modules/@microsoft/tiktokenizer/model,
# as the root user, as the typedai user can't write to node_modules
RUN pnpm run initTiktokenizer

USER $user

RUN mkdir .typedai
# Generate the function schemas
RUN pnpm run functionSchemas

# Needed to avoid the error "fatal: detected dubious ownership in repository at '/home/typedai'" when running git commands
# as the application files are owned by the root user so an agent (which runs as the typedai user) can't modify them.
RUN git config --global --add safe.directory /home/typedai

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD [ "node", "-r", "ts-node/register", "--env-file=variables/.env", "src/index.ts" ]

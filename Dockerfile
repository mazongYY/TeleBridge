FROM node:22-bookworm-slim AS builder

ENV NPM_CONFIG_AUDIT=false
ENV NPM_CONFIG_FUND=false
ENV NPM_CONFIG_INSTALL_LINKS=true
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY vendor ./vendor

RUN npm ci --omit=dev

FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=7860

WORKDIR /home/node/app

COPY --from=builder /build/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY vendor ./vendor
COPY scripts ./scripts
COPY README.md ./

RUN chown -R node:node /home/node/app

USER node

EXPOSE 7860

CMD ["npm", "run", "user:forward"]

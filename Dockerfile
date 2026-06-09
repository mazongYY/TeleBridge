FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=7860
ENV NPM_CONFIG_AUDIT=false
ENV NPM_CONFIG_FUND=false
ENV NPM_CONFIG_INSTALL_LINKS=true
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /home/node/app

RUN chown -R node:node /home/node/app

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node vendor ./vendor

USER node

RUN npm ci --omit=dev

COPY --chown=node:node scripts ./scripts
COPY --chown=node:node README.md ./

EXPOSE 7860

CMD ["npm", "run", "user:forward"]

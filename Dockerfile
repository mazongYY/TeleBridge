FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=7860

WORKDIR /home/node/app

RUN chown -R node:node /home/node/app

COPY --chown=node:node package.json package-lock.json ./

USER node

RUN npm ci --omit=dev

COPY --chown=node:node scripts ./scripts
COPY --chown=node:node README.md ./

EXPOSE 7860

CMD ["npm", "run", "user:forward"]

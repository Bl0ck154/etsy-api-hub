FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src/ ./src/
COPY --chown=node:node bin/ ./bin/
USER node
ENV ETSY_HUB_CONFIG=/data/config.json
EXPOSE 3737
CMD ["node", "src/server.mjs"]

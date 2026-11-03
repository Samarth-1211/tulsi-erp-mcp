# syntax=docker/dockerfile:1
# Tulsi ERP MCP connector. No npm dependencies: the image is Node + our files.
# Same Node line as the backend image. Build context = this folder (tulsi-erp-mcp/).
ARG NODE_IMAGE=node:24.19.0-alpine
FROM ${NODE_IMAGE}

ENV NODE_ENV=production \
    PORT=8790 \
    DATA_DIR=/data \
    TOOL_MODE=catalog \
    CATALOG_FILE=/app/catalog/actions.json

WORKDIR /app
# Only what runs: the connector code and the generated catalog (private; never served).
COPY connector/server.js connector/server.js
COPY connector/lib connector/lib
COPY connector/scripts connector/scripts
COPY catalog/actions.json catalog/actions.json
COPY package.json ./

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

CMD ["node", "connector/server.js"]

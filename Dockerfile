# Besy in a container.
#
# Node 22 because the database is node:sqlite, which arrived in 22.5, and
# ffmpeg because without it there is no rendition ladder, no thumbnails, no
# Shorts and no live — the app runs, it just does less.
#
# Nothing is compiled here: the dependencies are pure JavaScript, so this is a
# single stage and the image is the runtime.
FROM node:22-alpine

RUN apk add --no-cache ffmpeg tini

WORKDIR /app

# Dependencies first, so a code change does not re-resolve the tree.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY README.md ./

# The image ships no data. Everything that survives a restart — the database,
# the media, the outbox — lives in this volume.
ENV BESY_DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data /app

USER node
EXPOSE 3000 1935
VOLUME ["/data"]

# The health endpoint is what the reverse proxy and compose wait on.
HEALTHCHECK --interval=20s --timeout=4s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini reaps the ffmpeg children a live stream spawns.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--experimental-sqlite", "server/index.js"]

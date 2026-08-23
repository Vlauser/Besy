'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('../db');
const { LocalStorage } = require('./local');
const { S3Storage } = require('./s3');

function createStorage(env = process.env) {
  const driver = (env.BESY_STORAGE || 'local').toLowerCase();

  if (driver === 's3') {
    return new S3Storage({
      bucket: env.BESY_S3_BUCKET,
      region: env.BESY_S3_REGION,
      endpoint: env.BESY_S3_ENDPOINT,
      prefix: env.BESY_S3_PREFIX,
      forcePathStyle: env.BESY_S3_FORCE_PATH_STYLE === 'true',
      accessKeyId: env.BESY_S3_ACCESS_KEY_ID,
      secretAccessKey: env.BESY_S3_SECRET_ACCESS_KEY,
    });
  }

  if (driver !== 'local') {
    throw new Error(`Неизвестный BESY_STORAGE: ${driver} (доступны local и s3)`);
  }

  const root = env.BESY_STORAGE_ROOT || path.join(DATA_DIR, 'media');
  moveLegacyFolders(root);
  return new LocalStorage({ root });
}

/** Earlier builds kept media directly in the data directory; move it under the storage root. */
function moveLegacyFolders(root) {
  for (const folder of ['videos', 'thumbs']) {
    const from = path.join(DATA_DIR, folder);
    const to = path.join(root, folder);
    if (fs.existsSync(from) && !fs.existsSync(to)) {
      fs.mkdirSync(root, { recursive: true });
      fs.renameSync(from, to);
    }
  }
}

const storage = createStorage();

/** Key helpers keep the storage layout in one place. */
const keys = {
  video: (id, ext) => `videos/${id}${ext}`,
  thumb: (id) => `thumbs/${id}.jpg`,
  hlsDir: (id) => `hls/${id}`,
  hlsMaster: (id) => `hls/${id}/master.m3u8`,
  hlsFile: (id, name) => `hls/${id}/${name}`,
  caption: (videoId, captionId) => `captions/${videoId}/${captionId}.vtt`,
  captionDir: (videoId) => `captions/${videoId}`,
};

module.exports = { storage, createStorage, keys, LocalStorage, S3Storage };

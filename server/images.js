'use strict';

/**
 * What counts as a picture, decided from the bytes.
 *
 * Channel artwork and video covers arrive through different routers but face
 * the same question, and the answer must not depend on the filename or on the
 * Content-Type the browser volunteered — both are written by whoever is
 * uploading.
 */

const SIGNATURES = [
  { ext: '.jpg', type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.png', type: 'image/png', test: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  { ext: '.webp', type: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { ext: '.gif', type: 'image/gif', test: (b) => b.subarray(0, 3).toString('latin1') === 'GIF' },
];

/** Returns the matching signature, or null when the bytes are something else. */
function identify(buffer) {
  if (!buffer || buffer.length < 12) return null;
  return SIGNATURES.find((sig) => sig.test(buffer)) || null;
}

const MAX_BYTES = Number(process.env.BESY_ARTWORK_MAX_KB || 4096) * 1024;

module.exports = { SIGNATURES, identify, MAX_BYTES };

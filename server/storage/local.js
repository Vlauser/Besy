'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * Stores objects as plain files under a root directory.
 * Keys are POSIX-style paths ("videos/abc.mp4") and are resolved inside the root.
 */
class LocalStorage {
  constructor({ root }) {
    this.root = root;
    this.kind = 'local';
    fs.mkdirSync(root, { recursive: true });
  }

  resolve(key) {
    const target = path.resolve(this.root, key);
    const root = path.resolve(this.root);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Ключ выходит за пределы хранилища: ${key}`);
    }
    return target;
  }

  async putFile(key, sourcePath) {
    const target = this.resolve(key);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    try {
      await fsp.rename(sourcePath, target);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      await fsp.copyFile(sourcePath, target);
      await fsp.rm(sourcePath, { force: true });
    }
    return key;
  }

  async putBuffer(key, buffer) {
    const target = this.resolve(key);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, buffer);
    return key;
  }

  async stat(key) {
    try {
      const stats = await fsp.stat(this.resolve(key));
      return { size: stats.size };
    } catch {
      return null;
    }
  }

  async getBuffer(key) {
    return fsp.readFile(this.resolve(key));
  }

  /** Returns a readable stream, optionally for the byte range [start, end]. */
  async getStream(key, range) {
    const target = this.resolve(key);
    return range
      ? fs.createReadStream(target, { start: range.start, end: range.end })
      : fs.createReadStream(target);
  }

  async delete(key) {
    await fsp.rm(this.resolve(key), { force: true });
  }

  async deletePrefix(prefix) {
    await fsp.rm(this.resolve(prefix), { recursive: true, force: true });
  }
}

module.exports = { LocalStorage };

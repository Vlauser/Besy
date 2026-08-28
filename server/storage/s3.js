'use strict';

const fs = require('node:fs');

/**
 * Stores objects in any S3-compatible bucket (AWS S3, MinIO, Cloudflare R2, …).
 * The AWS SDK is an optional dependency, so it is only required when this
 * driver is actually selected.
 */
class S3Storage {
  constructor(config) {
    let sdk;
    try {
      sdk = require('@aws-sdk/client-s3');
    } catch {
      throw new Error(
        'Для BESY_STORAGE=s3 нужен пакет @aws-sdk/client-s3: npm install @aws-sdk/client-s3'
      );
    }

    if (!config.bucket) throw new Error('Не задан BESY_S3_BUCKET');

    this.sdk = sdk;
    this.kind = 's3';
    this.bucket = config.bucket;
    this.prefix = config.prefix ? config.prefix.replace(/\/*$/, '/') : '';
    this.client = new sdk.S3Client({
      region: config.region || 'us-east-1',
      endpoint: config.endpoint || undefined,
      forcePathStyle: config.forcePathStyle,
      credentials: config.accessKeyId
        ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
        : undefined,
    });
  }

  objectKey(key) {
    // Mirrors the local driver's guard: a blank key must never turn into a
    // request scoped to the bucket prefix itself (e.g. deleting everything
    // under it, or listing the whole prefix as if it were one object).
    if (!key) throw new Error('Пустой ключ хранилища');
    return this.prefix + key;
  }

  async putFile(key, sourcePath) {
    const { PutObjectCommand } = this.sdk;
    const body = await fs.promises.readFile(sourcePath);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.objectKey(key),
      Body: body,
    }));
    await fs.promises.rm(sourcePath, { force: true });
    return key;
  }

  async putBuffer(key, buffer) {
    const { PutObjectCommand } = this.sdk;
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.objectKey(key),
      Body: buffer,
    }));
    return key;
  }

  async stat(key) {
    const { HeadObjectCommand } = this.sdk;
    try {
      const res = await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
      }));
      return { size: Number(res.ContentLength), mtime: res.LastModified ? res.LastModified.getTime() : 0 };
    } catch {
      return null;
    }
  }

  async getBuffer(key) {
    const stream = await this.getStream(key);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  async getStream(key, range) {
    const { GetObjectCommand } = this.sdk;
    const res = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.objectKey(key),
      Range: range ? `bytes=${range.start}-${range.end}` : undefined,
    }));
    return res.Body;
  }

  async delete(key) {
    const { DeleteObjectCommand } = this.sdk;
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: this.objectKey(key),
    }));
  }

  async deletePrefix(prefix) {
    const { ListObjectsV2Command, DeleteObjectsCommand } = this.sdk;
    let token;
    do {
      const listed = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: this.objectKey(prefix),
        ContinuationToken: token,
      }));
      const objects = (listed.Contents || []).map((o) => ({ Key: o.Key }));
      if (objects.length) {
        await this.client.send(new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: objects, Quiet: true },
        }));
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
  }
}

module.exports = { S3Storage };

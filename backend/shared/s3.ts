// ============================================================================
// LAZARUS — S3 Helper
// Complete S3 operations with pagination, presigned URLs, zip support
// ============================================================================

import {
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client } from './aws-clients';
import { log } from './logger';
import { Readable } from 'stream';
import * as path from 'path';
import * as fs from 'fs';
import archiver from 'archiver';

export class S3Helper {
  /**
   * Upload string content
   */
  async uploadText(
    bucket: string,
    key: string,
    content: string,
    contentType = 'text/plain'
  ): Promise<void> {
    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: content,
          ContentType: contentType,
        })
      );
    } catch (error) {
      log('error', 'S3 uploadText failed', {
        bucket,
        key,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Upload binary buffer
   */
  async uploadBuffer(
    bucket: string,
    key: string,
    buffer: Buffer,
    contentType = 'application/octet-stream'
  ): Promise<void> {
    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        })
      );
    } catch (error) {
      log('error', 'S3 uploadBuffer failed', {
        bucket,
        key,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Download as string
   */
  async download(bucket: string, key: string): Promise<string> {
    try {
      const result = await s3Client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key })
      );
      return await this.streamToString(result.Body as Readable);
    } catch (error) {
      log('error', 'S3 download failed', {
        bucket,
        key,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Download as Buffer
   */
  async downloadBuffer(bucket: string, key: string): Promise<Buffer> {
    try {
      const result = await s3Client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key })
      );
      return await this.streamToBuffer(result.Body as Readable);
    } catch (error) {
      log('error', 'S3 downloadBuffer failed', {
        bucket,
        key,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * List all keys under a prefix (handles pagination)
   */
  async list(bucket: string, prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      try {
        const result = await s3Client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          })
        );

        for (const obj of result.Contents ?? []) {
          if (obj.Key) {
            keys.push(obj.Key);
          }
        }

        continuationToken = result.NextContinuationToken;
      } catch (error) {
        log('error', 'S3 list failed', {
          bucket,
          prefix,
          error: String(error),
        });
        throw error;
      }
    } while (continuationToken);

    return keys;
  }

  /**
   * Delete a single object
   */
  async delete(bucket: string, key: string): Promise<void> {
    try {
      await s3Client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: key })
      );
    } catch (error) {
      log('error', 'S3 delete failed', {
        bucket,
        key,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Delete all objects under a prefix
   */
  async deletePrefix(bucket: string, prefix: string): Promise<number> {
    const keys = await this.list(bucket, prefix);
    if (keys.length === 0) return 0;

    // Delete in batches of 1000 (S3 limit)
    const BATCH_SIZE = 1000;
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batch = keys.slice(i, i + BATCH_SIZE);
      try {
        await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: batch.map((k) => ({ Key: k })),
              Quiet: true,
            },
          })
        );
      } catch (error) {
        log('error', 'S3 deletePrefix batch failed', {
          bucket,
          prefix,
          batchStart: i,
          error: String(error),
        });
        throw error;
      }
    }

    return keys.length;
  }

  /**
   * Copy object between buckets
   */
  async copy(
    sourceBucket: string,
    sourceKey: string,
    destBucket: string,
    destKey: string
  ): Promise<void> {
    try {
      await s3Client.send(
        new CopyObjectCommand({
          Bucket: destBucket,
          Key: destKey,
          CopySource: `${sourceBucket}/${sourceKey}`,
        })
      );
    } catch (error) {
      log('error', 'S3 copy failed', {
        sourceBucket,
        sourceKey,
        destBucket,
        destKey,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Check if an object exists
   */
  async exists(bucket: string, key: string): Promise<boolean> {
    try {
      await s3Client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key })
      );
      return true;
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === 'NotFound' || err.name === 'NoSuchKey') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get presigned URL for GET operations
   */
  async getPresignedUrl(
    bucket: string,
    key: string,
    expiresIn = 3600
  ): Promise<string> {
    try {
      return await getSignedUrl(
        s3Client,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn }
      );
    } catch (error) {
      log('error', 'S3 getPresignedUrl failed', {
        bucket,
        key,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Sync a local directory to S3
   */
  async syncDirectory(
    localPath: string,
    bucket: string,
    prefix: string
  ): Promise<number> {
    let uploaded = 0;

    const walkDir = async (dirPath: string, s3Prefix: string): Promise<void> => {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const s3Key = `${s3Prefix}${entry.name}`;

        if (entry.isDirectory()) {
          await walkDir(fullPath, `${s3Key}/`);
        } else {
          const content = fs.readFileSync(fullPath);
          const contentType = this.getContentType(entry.name);
          await this.uploadBuffer(bucket, s3Key, content, contentType);
          uploaded++;
        }
      }
    };

    await walkDir(localPath, prefix.endsWith('/') ? prefix : `${prefix}/`);
    return uploaded;
  }

  /**
   * Get object metadata (head object)
   */
  async getMetadata(
    bucket: string,
    key: string
  ): Promise<{
    contentLength: number;
    contentType: string;
    lastModified: Date;
    metadata: Record<string, string>;
  }> {
    try {
      const result = await s3Client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key })
      );
      return {
        contentLength: result.ContentLength ?? 0,
        contentType: result.ContentType ?? 'application/octet-stream',
        lastModified: result.LastModified ?? new Date(),
        metadata: (result.Metadata as Record<string, string>) ?? {},
      };
    } catch (error) {
      log('error', 'S3 getMetadata failed', {
        bucket,
        key,
        error: String(error),
      });
      throw error;
    }
  }

  /**
   * Zip a local directory and upload to S3
   */
  async zipAndUpload(
    localDir: string,
    bucket: string,
    key: string
  ): Promise<void> {
    const zipPath = `/tmp/${Date.now()}-archive.zip`;

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 6 } });

      output.on('close', () => resolve());
      archive.on('error', (err: Error) => reject(err));

      archive.pipe(output);
      archive.directory(localDir, false);
      archive.finalize();
    });

    const zipBuffer = fs.readFileSync(zipPath);
    await this.uploadBuffer(bucket, key, zipBuffer, 'application/zip');

    // Cleanup
    try {
      fs.unlinkSync(zipPath);
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Download all files under a prefix to a local directory
   */
  async downloadToDirectory(
    bucket: string,
    prefix: string,
    localDir: string
  ): Promise<number> {
    const keys = await this.list(bucket, prefix);
    let downloaded = 0;

    for (const key of keys) {
      const relativePath = key.substring(prefix.length);
      if (!relativePath || relativePath.endsWith('/')) continue;

      const localPath = path.join(localDir, relativePath);
      const dir = path.dirname(localPath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const buffer = await this.downloadBuffer(bucket, key);
      fs.writeFileSync(localPath, buffer);
      downloaded++;
    }

    return downloaded;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async streamToString(stream: Readable): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private getContentType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const types: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.ts': 'text/typescript',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.yaml': 'text/yaml',
      '.yml': 'text/yaml',
      '.md': 'text/markdown',
      '.txt': 'text/plain',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.otf': 'font/otf',
      '.zip': 'application/zip',
      '.pdf': 'application/pdf',
    };
    return types[ext] ?? 'application/octet-stream';
  }
}

// Singleton export
export const s3 = new S3Helper();

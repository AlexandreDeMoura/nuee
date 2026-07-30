import { randomUUID } from 'node:crypto';
import { chmod, link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { documentsConfig } from '../config/configuration';
import {
  DocumentFileStorageError,
  type DocumentFileStorage,
  type StoredDocumentFile,
} from './document.types';

const FILE_REFERENCE_PATTERN =
  /^originals\/(?<bucket>[0-9a-f]{2})\/(?<key>[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;

@Injectable()
export class PrivateDocumentFileStorage implements DocumentFileStorage {
  private readonly rootPath: string;
  private readonly stagingPath: string;
  private readonly originalsPath: string;

  constructor(
    @Inject(documentsConfig.KEY)
    config: Pick<ConfigType<typeof documentsConfig>, 'privateStoragePath'>,
  ) {
    this.rootPath =
      config.privateStoragePath ??
      join(__dirname, '..', '..', 'data', 'private-documents');
    this.stagingPath = join(this.rootPath, '.staging');
    this.originalsPath = join(this.rootPath, 'originals');
  }

  async store(bytes: Uint8Array): Promise<StoredDocumentFile> {
    const key = randomUUID();
    const bucket = key.slice(0, 2);
    const fileReference = `originals/${bucket}/${key}`;
    const temporaryPath = join(this.stagingPath, `${randomUUID()}.upload`);
    const bucketPath = join(this.originalsPath, bucket);
    const destinationPath = join(bucketPath, key);
    let temporaryCreated = false;

    try {
      await this.ensurePrivateDirectory(this.rootPath);
      await this.ensurePrivateDirectory(this.stagingPath);
      await this.ensurePrivateDirectory(this.originalsPath);
      await this.ensurePrivateDirectory(bucketPath);

      const handle = await open(temporaryPath, 'wx', 0o600);
      temporaryCreated = true;

      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }

      // A hard link publishes the fully flushed file atomically and refuses to
      // replace an existing key. Both paths are under the same private root.
      await link(temporaryPath, destinationPath);
      await unlink(temporaryPath).catch(() => undefined);

      return { file_reference: fileReference };
    } catch (error) {
      if (temporaryCreated) {
        await unlink(temporaryPath).catch(() => undefined);
      }

      throw new DocumentFileStorageError('store', { cause: error });
    }
  }

  async read(fileReference: string): Promise<Buffer> {
    try {
      return await readFile(this.resolveFileReference(fileReference, 'read'));
    } catch (error) {
      if (error instanceof DocumentFileStorageError) {
        throw error;
      }

      throw new DocumentFileStorageError('read', { cause: error });
    }
  }

  async remove(fileReference: string): Promise<void> {
    try {
      await unlink(this.resolveFileReference(fileReference, 'remove'));
    } catch (error) {
      if (this.errorCode(error) === 'ENOENT') {
        return;
      }

      if (error instanceof DocumentFileStorageError) {
        throw error;
      }

      throw new DocumentFileStorageError('remove', { cause: error });
    }
  }

  private async ensurePrivateDirectory(path: string): Promise<void> {
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
  }

  private resolveFileReference(
    fileReference: string,
    operation: 'read' | 'remove',
  ): string {
    const match = FILE_REFERENCE_PATTERN.exec(fileReference);

    if (
      !match?.groups ||
      match.groups.bucket !== match.groups.key.slice(0, 2)
    ) {
      throw new DocumentFileStorageError(operation);
    }

    return join(this.originalsPath, match.groups.bucket, match.groups.key);
  }

  private errorCode(error: unknown): string | undefined {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
    ) {
      return error.code;
    }

    return undefined;
  }
}

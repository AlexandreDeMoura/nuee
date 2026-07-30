import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentFileStorageError } from './document.types';
import { PrivateDocumentFileStorage } from './private-document-file.storage';

describe('PrivateDocumentFileStorage', () => {
  let temporaryDirectory: string;
  let storage: PrivateDocumentFileStorage;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'nuee-private-documents-'));
    storage = new PrivateDocumentFileStorage({
      privateStoragePath: temporaryDirectory,
    });
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('publishes complete files atomically under opaque private references', async () => {
    const bytes = Buffer.from('private source bytes', 'utf8');
    const stored = await storage.store(bytes);
    const storedPath = join(temporaryDirectory, stored.file_reference);

    expect(stored.file_reference).toMatch(
      /^originals\/[0-9a-f]{2}\/[0-9a-f-]{36}$/u,
    );
    expect(stored.file_reference).not.toContain('private source');
    expect(readFileSync(storedPath)).toEqual(bytes);
    await expect(storage.read(stored.file_reference)).resolves.toEqual(bytes);
    expect(statSync(temporaryDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(storedPath).mode & 0o777).toBe(0o600);
    expect(statSync(join(temporaryDirectory, '.staging')).mode & 0o777).toBe(
      0o700,
    );
  });

  it('removes a stored source idempotently', async () => {
    const stored = await storage.store(Buffer.from('delete me'));

    await storage.remove(stored.file_reference);
    await storage.remove(stored.file_reference);

    await expect(storage.read(stored.file_reference)).rejects.toBeInstanceOf(
      DocumentFileStorageError,
    );
  });

  it.each([
    '../outside',
    '/absolute/path',
    'originals/aa/not-a-generated-key',
    'originals/bb/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ])('rejects non-opaque storage reference %s', async (fileReference) => {
    await expect(storage.read(fileReference)).rejects.toMatchObject({
      name: 'DocumentFileStorageError',
      operation: 'read',
    });
  });
});

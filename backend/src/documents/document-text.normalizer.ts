import { Injectable } from '@nestjs/common';
import { DocumentTextExtractionError } from './document.types';

@Injectable()
export class DocumentTextNormalizer {
  normalize(value: string, maxOutputBytes: number): string {
    if (this.hasDisallowedCharacter(value)) {
      throw new DocumentTextExtractionError('corrupted', false);
    }

    const normalized = value
      .replace(/^\ufeff/u, '')
      .normalize('NFC')
      .replace(/\r\n?|\u0085|\u2028|\u2029|\f/gu, '\n')
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .replace(/\n{3,}/gu, '\n\n')
      .trim();

    if (normalized.length === 0) {
      throw new DocumentTextExtractionError('no_text', false);
    }

    if (Buffer.byteLength(normalized, 'utf8') > maxOutputBytes) {
      throw new DocumentTextExtractionError('too_complex', false);
    }

    return normalized;
  }

  private hasDisallowedCharacter(value: string): boolean {
    return [...value].some((character) => {
      const codePoint = character.codePointAt(0);

      return (
        codePoint === 0xfffd ||
        codePoint === 0x7f ||
        (codePoint !== undefined &&
          ((codePoint >= 0x00 && codePoint <= 0x08) ||
            codePoint === 0x0b ||
            (codePoint >= 0x0e && codePoint <= 0x1f)))
      );
    });
  }
}

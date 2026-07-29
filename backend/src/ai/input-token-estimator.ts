import { Injectable } from '@nestjs/common';

const CONSERVATIVE_BYTES_PER_TOKEN = 3;

export interface InputTokenEstimator {
  estimateText(text: string): number;
}

export const INPUT_TOKEN_ESTIMATOR = Symbol('INPUT_TOKEN_ESTIMATOR');

@Injectable()
export class ConservativeInputTokenEstimator implements InputTokenEstimator {
  estimateText(text: string): number {
    return Math.ceil(
      Buffer.byteLength(text, 'utf8') / CONSERVATIVE_BYTES_PER_TOKEN,
    );
  }
}

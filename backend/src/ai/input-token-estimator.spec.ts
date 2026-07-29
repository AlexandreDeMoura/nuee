import { ConservativeInputTokenEstimator } from './input-token-estimator';

describe('ConservativeInputTokenEstimator', () => {
  const estimator = new ConservativeInputTokenEstimator();

  it('estimates from UTF-8 bytes with a conservative replaceable heuristic', () => {
    expect(estimator.estimateText('')).toBe(0);
    expect(estimator.estimateText('abc')).toBe(1);
    expect(estimator.estimateText('abcd')).toBe(2);
    expect(estimator.estimateText('éé')).toBe(2);
  });
});

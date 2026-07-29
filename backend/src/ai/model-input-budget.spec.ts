import { buildFocusedResponseInstructions } from './answer-instructions';
import type { InputTokenEstimator } from './input-token-estimator';
import { ConfiguredModelInputBudget } from './model-input-budget';

class CharacterCountingEstimator implements InputTokenEstimator {
  readonly inputs: string[] = [];

  estimateText(text: string): number {
    this.inputs.push(text);
    return text.length;
  }
}

describe('ConfiguredModelInputBudget', () => {
  it('accounts for instructions, formatted context, complete history, output, and safety margin', () => {
    const estimator = new CharacterCountingEstimator();
    const budget = new ConfiguredModelInputBudget(
      {
        focusedResponseWordBudget: 200,
        modelInputTokenLimit: 1_000,
        reservedOutputTokens: 100,
        inputSafetyMarginTokens: 50,
      },
      estimator,
    );

    const result = budget.evaluateAnswer({
      formattedContext: 'formatted frozen context',
      messages: [
        { role: 'user', content: 'Persisted question' },
        { role: 'assistant', content: 'Persisted answer' },
        { role: 'user', content: 'Next user message' },
      ],
    });

    expect(estimator.inputs).toEqual([
      buildFocusedResponseInstructions(200),
      'developer',
      'formatted frozen context',
      'user',
      'Persisted question',
      'assistant',
      'Persisted answer',
      'user',
      'Next user message',
    ]);
    expect(result).toMatchObject({
      fits: true,
      inputTokenLimit: 1_000,
      availableInputTokens: 850,
      reservedOutputTokens: 100,
      safetyMarginTokens: 50,
    });
  });

  it('rejects the complete input when estimated input plus reserves reaches the configured limit', () => {
    const estimator = new CharacterCountingEstimator();
    const roomyBudget = new ConfiguredModelInputBudget(
      {
        focusedResponseWordBudget: 200,
        modelInputTokenLimit: 10_000,
        reservedOutputTokens: 100,
        inputSafetyMarginTokens: 50,
      },
      estimator,
    );
    const input = {
      formattedContext: 'context',
      messages: [{ role: 'user' as const, content: 'question' }],
    };
    const measurement = roomyBudget.evaluateAnswer(input);
    const exactBudget = new ConfiguredModelInputBudget(
      {
        focusedResponseWordBudget: 200,
        modelInputTokenLimit: measurement.estimatedInputTokens + 150,
        reservedOutputTokens: 100,
        inputSafetyMarginTokens: 50,
      },
      new CharacterCountingEstimator(),
    );
    const tooSmallBudget = new ConfiguredModelInputBudget(
      {
        focusedResponseWordBudget: 200,
        modelInputTokenLimit: measurement.estimatedInputTokens + 149,
        reservedOutputTokens: 100,
        inputSafetyMarginTokens: 50,
      },
      new CharacterCountingEstimator(),
    );

    expect(exactBudget.evaluateAnswer(input).fits).toBe(true);
    expect(tooSmallBudget.evaluateAnswer(input).fits).toBe(false);
  });
});

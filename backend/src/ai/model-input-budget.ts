import type { AiConfig } from '../config/configuration';
import { buildFocusedResponseInstructions } from './answer-instructions';
import type { InputTokenEstimator } from './input-token-estimator';
import type { GenerateAnswerInput } from './model-client';

const REQUEST_OVERHEAD_TOKENS = 12;
const MESSAGE_OVERHEAD_TOKENS = 4;

export interface ModelInputBudgetResult {
  fits: boolean;
  estimatedInputTokens: number;
  inputTokenLimit: number;
  availableInputTokens: number;
  reservedOutputTokens: number;
  safetyMarginTokens: number;
}

export interface ModelInputBudget {
  evaluateAnswer(input: GenerateAnswerInput): ModelInputBudgetResult;
}

export const MODEL_INPUT_BUDGET = Symbol('MODEL_INPUT_BUDGET');

type ModelBudgetConfig = Pick<
  AiConfig,
  | 'focusedResponseWordBudget'
  | 'modelInputTokenLimit'
  | 'reservedOutputTokens'
  | 'inputSafetyMarginTokens'
>;

export class ConfiguredModelInputBudget implements ModelInputBudget {
  constructor(
    private readonly config: ModelBudgetConfig,
    private readonly estimator: InputTokenEstimator,
  ) {}

  evaluateAnswer(input: GenerateAnswerInput): ModelInputBudgetResult {
    const instructions = buildFocusedResponseInstructions(
      this.config.focusedResponseWordBudget,
    );
    const instructionTokens = this.estimator.estimateText(instructions);
    const contextTokens =
      MESSAGE_OVERHEAD_TOKENS +
      this.estimator.estimateText('developer') +
      this.estimator.estimateText(input.formattedContext);
    const messageTokens = input.messages.reduce(
      (total, message) =>
        total +
        MESSAGE_OVERHEAD_TOKENS +
        this.estimator.estimateText(message.role) +
        this.estimator.estimateText(message.content),
      0,
    );
    const estimatedInputTokens =
      REQUEST_OVERHEAD_TOKENS +
      instructionTokens +
      contextTokens +
      messageTokens;
    const availableInputTokens =
      this.config.modelInputTokenLimit -
      this.config.reservedOutputTokens -
      this.config.inputSafetyMarginTokens;

    return {
      fits: estimatedInputTokens <= availableInputTokens,
      estimatedInputTokens,
      inputTokenLimit: this.config.modelInputTokenLimit,
      availableInputTokens,
      reservedOutputTokens: this.config.reservedOutputTokens,
      safetyMarginTokens: this.config.inputSafetyMarginTokens,
    };
  }
}

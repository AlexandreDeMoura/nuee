import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { aiConfig, appConfig } from '../config/configuration';
import { AI_CAPABILITIES, createAiCapabilities } from './ai-capabilities';
import { FakeModelClient } from './fake-model.client';
import {
  CanonicalFrozenContextFormatter,
  FROZEN_CONTEXT_FORMATTER,
} from './frozen-context.formatter';
import {
  ConservativeInputTokenEstimator,
  INPUT_TOKEN_ESTIMATOR,
  type InputTokenEstimator,
} from './input-token-estimator';
import { MODEL_CLIENT } from './model-client';
import {
  ConfiguredModelInputBudget,
  MODEL_INPUT_BUDGET,
} from './model-input-budget';
import { OpenAiModelClient } from './openai-model.client';

@Module({
  providers: [
    {
      provide: AI_CAPABILITIES,
      inject: [aiConfig.KEY],
      useFactory: (ai: ConfigType<typeof aiConfig>) => createAiCapabilities(ai),
    },
    {
      provide: FROZEN_CONTEXT_FORMATTER,
      useClass: CanonicalFrozenContextFormatter,
    },
    {
      provide: INPUT_TOKEN_ESTIMATOR,
      useClass: ConservativeInputTokenEstimator,
    },
    {
      provide: MODEL_INPUT_BUDGET,
      inject: [aiConfig.KEY, INPUT_TOKEN_ESTIMATOR],
      useFactory: (
        ai: ConfigType<typeof aiConfig>,
        estimator: InputTokenEstimator,
      ) => new ConfiguredModelInputBudget(ai, estimator),
    },
    {
      provide: MODEL_CLIENT,
      inject: [appConfig.KEY, aiConfig.KEY],
      useFactory: (
        application: ConfigType<typeof appConfig>,
        ai: ConfigType<typeof aiConfig>,
      ) =>
        application.environment === 'test'
          ? new FakeModelClient()
          : new OpenAiModelClient(ai),
    },
  ],
  exports: [
    AI_CAPABILITIES,
    FROZEN_CONTEXT_FORMATTER,
    MODEL_INPUT_BUDGET,
    MODEL_CLIENT,
  ],
})
export class AiModule {}

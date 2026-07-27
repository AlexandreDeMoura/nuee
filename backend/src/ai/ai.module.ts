import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { aiConfig, appConfig } from '../config/configuration';
import { FakeModelClient } from './fake-model.client';
import { MODEL_CLIENT } from './model-client';
import { OpenAiModelClient } from './openai-model.client';

@Module({
  providers: [
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
  exports: [MODEL_CLIENT],
})
export class AiModule {}

import { Module } from '@nestjs/common';
import { FakeModelClient } from './fake-model.client';
import { MODEL_CLIENT } from './model-client';

@Module({
  providers: [
    FakeModelClient,
    {
      provide: MODEL_CLIENT,
      useExisting: FakeModelClient,
    },
  ],
  exports: [MODEL_CLIENT],
})
export class AiModule {}

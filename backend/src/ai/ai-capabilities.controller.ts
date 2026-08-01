import { Controller, Get, Inject } from '@nestjs/common';
import type { AiCapabilities } from '@nuee/shared-types';
import { AI_CAPABILITIES } from './ai-capabilities';

@Controller('ai-capabilities')
export class AiCapabilitiesController {
  constructor(
    @Inject(AI_CAPABILITIES)
    private readonly capabilities: AiCapabilities,
  ) {}

  @Get()
  get(): AiCapabilities {
    return this.capabilities;
  }
}

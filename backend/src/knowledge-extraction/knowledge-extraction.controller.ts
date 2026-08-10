import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import type {
  CreateKnowledgeExtractionInput,
  KnowledgeExtractionProposalResponse,
  ResolveKnowledgeExtractionInput,
} from '@nuee/shared-types';
import { KnowledgeExtractionResolutionService } from './knowledge-extraction-resolution.service';
import { KnowledgeExtractionService } from './knowledge-extraction.service';
import type { KnowledgeExtractionResolutionResponse } from './knowledge-extraction.types';

@Controller(
  'projects/:projectId/discussions/:discussionId/knowledge-extractions',
)
export class KnowledgeExtractionController {
  constructor(
    private readonly extractions: KnowledgeExtractionService,
    private readonly resolutions: KnowledgeExtractionResolutionService,
  ) {}

  @Post()
  create(
    @Param('projectId') projectId: string,
    @Param('discussionId') discussionId: string,
    @Body() input: CreateKnowledgeExtractionInput,
  ): Promise<KnowledgeExtractionProposalResponse> {
    return this.extractions.generateProposal(projectId, discussionId, input);
  }

  @Post(':extractionId/resolution')
  @HttpCode(HttpStatus.OK)
  resolve(
    @Param('projectId') projectId: string,
    @Param('discussionId') discussionId: string,
    @Param('extractionId') extractionId: string,
    @Body() input: ResolveKnowledgeExtractionInput,
  ): KnowledgeExtractionResolutionResponse {
    return this.resolutions.resolveProposal(
      projectId,
      discussionId,
      extractionId,
      input,
    );
  }

  @Delete(':extractionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  discard(
    @Param('projectId') projectId: string,
    @Param('discussionId') discussionId: string,
    @Param('extractionId') extractionId: string,
  ): void {
    this.resolutions.discardProposal(projectId, discussionId, extractionId);
  }
}

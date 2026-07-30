import { Body, Controller, Param, Post } from '@nestjs/common';
import type {
  CreateKnowledgeExtractionInput,
  KnowledgeExtractionProposalResponse,
} from '@nuee/shared-types';
import { KnowledgeExtractionService } from './knowledge-extraction.service';

@Controller(
  'projects/:projectId/discussions/:discussionId/knowledge-extractions',
)
export class KnowledgeExtractionController {
  constructor(private readonly extractions: KnowledgeExtractionService) {}

  @Post()
  create(
    @Param('projectId') projectId: string,
    @Param('discussionId') discussionId: string,
    @Body() input: CreateKnowledgeExtractionInput,
  ): Promise<KnowledgeExtractionProposalResponse> {
    return this.extractions.generateProposal(projectId, discussionId, input);
  }
}

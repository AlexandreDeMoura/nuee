import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import type {
  DiscussionDetails,
  DiscussionListResponse,
  LegacyFrozenContext,
  SendMessageInput,
} from '@nuee/shared-types';
import { DiscussionsService } from './discussions.service';

interface LegacyCreateDiscussionInput {
  project_id: string;
  frozen_context: LegacyFrozenContext;
  first_prompt: string;
}

@Controller('projects/:projectId/discussions')
export class DiscussionsController {
  constructor(private readonly discussions: DiscussionsService) {}

  @Post()
  create(
    @Param('projectId') projectId: string,
    @Body() input: LegacyCreateDiscussionInput,
  ): Promise<DiscussionDetails> {
    return this.discussions.create(projectId, input);
  }

  @Get()
  list(@Param('projectId') projectId: string): DiscussionListResponse {
    return this.discussions.list(projectId);
  }

  @Get(':discussionId')
  get(
    @Param('projectId') projectId: string,
    @Param('discussionId') discussionId: string,
  ): DiscussionDetails {
    return this.discussions.get(projectId, discussionId);
  }

  @Post(':discussionId/open')
  @HttpCode(HttpStatus.OK)
  recordOpen(
    @Param('projectId') projectId: string,
    @Param('discussionId') discussionId: string,
  ): DiscussionDetails {
    return this.discussions.recordOpen(projectId, discussionId);
  }

  @Post(':discussionId/messages')
  @HttpCode(HttpStatus.OK)
  sendMessage(
    @Param('projectId') projectId: string,
    @Param('discussionId') discussionId: string,
    @Body() input: SendMessageInput,
  ): Promise<DiscussionDetails> {
    return this.discussions.sendMessage(projectId, discussionId, input);
  }

  @Post(':discussionId/title')
  @HttpCode(HttpStatus.OK)
  generateTitle(
    @Param('projectId') projectId: string,
    @Param('discussionId') discussionId: string,
  ): Promise<DiscussionDetails> {
    return this.discussions.generateTitle(projectId, discussionId);
  }

  @Delete(':discussionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('projectId') projectId: string,
    @Param('discussionId') discussionId: string,
  ): void {
    this.discussions.delete(projectId, discussionId);
  }
}

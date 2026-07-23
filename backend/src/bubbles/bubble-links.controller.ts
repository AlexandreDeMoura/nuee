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
import type { BubbleLink, CreateBubbleLinkInput } from './bubble.types';
import { BubbleLinksService } from './bubble-links.service';

@Controller('projects/:projectId/bubble-links')
export class BubbleLinksController {
  constructor(private readonly links: BubbleLinksService) {}

  @Get()
  list(@Param('projectId') projectId: string): BubbleLink[] {
    return this.links.list(projectId);
  }

  @Post()
  create(
    @Param('projectId') projectId: string,
    @Body() input: CreateBubbleLinkInput,
  ): BubbleLink {
    return this.links.create(projectId, input);
  }

  @Delete(':firstBubbleId/:secondBubbleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('projectId') projectId: string,
    @Param('firstBubbleId') firstBubbleId: string,
    @Param('secondBubbleId') secondBubbleId: string,
  ): void {
    this.links.delete(projectId, firstBubbleId, secondBubbleId);
  }
}

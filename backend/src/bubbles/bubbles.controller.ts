import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type {
  Bubble,
  BubblePlacement,
  CreateBubbleInput,
  PlaceBubbleInput,
  RepositionBubbleInput,
  UpdateBubbleInput,
} from './bubble.types';
import { BubblePlacementService } from './bubble-placement.service';
import { BubblesService } from './bubbles.service';

@Controller('projects/:projectId/bubbles')
export class BubblesController {
  constructor(
    private readonly bubbles: BubblesService,
    private readonly placements: BubblePlacementService,
  ) {}

  @Post()
  create(
    @Param('projectId') projectId: string,
    @Body() input: CreateBubbleInput,
  ): Bubble {
    return this.bubbles.create(projectId, input);
  }

  @Get()
  list(@Param('projectId') projectId: string): Bubble[] {
    return this.bubbles.list(projectId);
  }

  @Post('placement')
  place(
    @Param('projectId') projectId: string,
    @Body() input: PlaceBubbleInput,
  ): BubblePlacement {
    return this.placements.place(projectId, input);
  }

  @Get(':bubbleId')
  get(
    @Param('projectId') projectId: string,
    @Param('bubbleId') bubbleId: string,
  ): Bubble {
    return this.bubbles.get(projectId, bubbleId);
  }

  @Patch(':bubbleId')
  update(
    @Param('projectId') projectId: string,
    @Param('bubbleId') bubbleId: string,
    @Body() input: UpdateBubbleInput,
  ): Bubble {
    return this.bubbles.update(projectId, bubbleId, input);
  }

  @Patch(':bubbleId/position')
  reposition(
    @Param('projectId') projectId: string,
    @Param('bubbleId') bubbleId: string,
    @Body() input: RepositionBubbleInput,
  ): Bubble {
    return this.bubbles.reposition(projectId, bubbleId, input);
  }

  @Delete(':bubbleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('projectId') projectId: string,
    @Param('bubbleId') bubbleId: string,
  ): void {
    this.bubbles.delete(projectId, bubbleId);
  }
}

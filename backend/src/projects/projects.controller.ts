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
  CreateProjectInput,
  Project,
  UpdateProjectDescriptionInput,
  UpdateProjectViewportInput,
} from './project.types';
import { ProjectDeletionService } from './project-deletion.service';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly projectDeletion: ProjectDeletionService,
  ) {}

  @Post()
  create(@Body() input: CreateProjectInput): Project {
    return this.projects.create(input);
  }

  @Get()
  list(): Project[] {
    return this.projects.list();
  }

  @Get(':projectId')
  get(@Param('projectId') projectId: string): Project {
    return this.projects.get(projectId);
  }

  @Patch(':projectId/description')
  updateDescription(
    @Param('projectId') projectId: string,
    @Body() input: UpdateProjectDescriptionInput,
  ): Project {
    return this.projects.updateDescription(projectId, input);
  }

  @Patch(':projectId/viewport')
  updateViewport(
    @Param('projectId') projectId: string,
    @Body() input: UpdateProjectViewportInput,
  ): Project {
    return this.projects.updateViewport(projectId, input);
  }

  @Delete(':projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('projectId') projectId: string): Promise<void> {
    await this.projectDeletion.delete(projectId);
  }
}

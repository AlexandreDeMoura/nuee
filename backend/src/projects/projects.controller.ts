import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type {
  CreateProjectInput,
  Project,
  UpdateProjectDescriptionInput,
  UpdateProjectViewportInput,
} from './project.types';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

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
}

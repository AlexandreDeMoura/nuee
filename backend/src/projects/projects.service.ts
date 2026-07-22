import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PROJECT_REPOSITORY } from './project.types';
import type {
  CreateProjectInput,
  Project,
  ProjectRepository,
  UpdateProjectDescriptionInput,
  UpdateProjectViewportInput,
} from './project.types';

const MAX_DESCRIPTION_LENGTH = 280;
const MIN_CANVAS_ZOOM = 0.25;
const MAX_CANVAS_ZOOM = 2;

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PROJECT_REPOSITORY)
    private readonly projects: ProjectRepository,
  ) {}

  create(input: CreateProjectInput): Project {
    const title = this.requiredText(input?.title, 'title');
    const description = this.validDescription(input?.description);
    const timestamp = new Date().toISOString();

    return this.projects.create({
      id: randomUUID(),
      title,
      description,
      created_at: timestamp,
      updated_at: timestamp,
      canvas_viewport_x: 0,
      canvas_viewport_y: 0,
      canvas_zoom: 1,
    });
  }

  list(): Project[] {
    return this.projects.findAll();
  }

  get(id: string): Project {
    const project = this.projects.findById(id);

    if (!project) {
      throw this.notFound(id);
    }

    return project;
  }

  updateDescription(id: string, input: UpdateProjectDescriptionInput): Project {
    const existingProject = this.projects.findById(id);

    if (!existingProject) {
      throw this.notFound(id);
    }

    const description = this.validDescription(input?.description);
    const updatedAt = this.nextTimestamp(existingProject.updated_at);
    const updatedProject = this.projects.updateDescription(
      id,
      description,
      updatedAt,
    );

    if (!updatedProject) {
      throw this.notFound(id);
    }

    return updatedProject;
  }

  updateViewport(id: string, input: UpdateProjectViewportInput): Project {
    if (!this.projects.findById(id)) {
      throw this.notFound(id);
    }

    const viewport = this.validViewport(input);
    const updatedProject = this.projects.updateViewport(id, viewport);

    if (!updatedProject) {
      throw this.notFound(id);
    }

    return updatedProject;
  }

  private requiredText(value: unknown, field: 'title'): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException({
        code: 'PROJECT_VALIDATION_FAILED',
        message: 'Project input is invalid.',
        field_errors: {
          [field]: 'Title is required.',
        },
      });
    }

    return value.trim();
  }

  private validDescription(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException({
        code: 'PROJECT_VALIDATION_FAILED',
        message: 'Project input is invalid.',
        field_errors: {
          description: 'Description is required.',
        },
      });
    }

    const description = value.trim();

    if (description.length > MAX_DESCRIPTION_LENGTH) {
      throw new BadRequestException({
        code: 'PROJECT_VALIDATION_FAILED',
        message: 'Project input is invalid.',
        field_errors: {
          description: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`,
        },
      });
    }

    return description;
  }

  private validViewport(
    input: UpdateProjectViewportInput,
  ): UpdateProjectViewportInput {
    const fieldErrors: Record<string, string> = {};

    if (!this.isFiniteNumber(input?.canvas_viewport_x)) {
      fieldErrors.canvas_viewport_x = 'Viewport X must be a finite number.';
    }

    if (!this.isFiniteNumber(input?.canvas_viewport_y)) {
      fieldErrors.canvas_viewport_y = 'Viewport Y must be a finite number.';
    }

    if (
      !this.isFiniteNumber(input?.canvas_zoom) ||
      input.canvas_zoom < MIN_CANVAS_ZOOM ||
      input.canvas_zoom > MAX_CANVAS_ZOOM
    ) {
      fieldErrors.canvas_zoom = `Zoom must be between ${MIN_CANVAS_ZOOM} and ${MAX_CANVAS_ZOOM}.`;
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw new BadRequestException({
        code: 'PROJECT_VALIDATION_FAILED',
        message: 'Project input is invalid.',
        field_errors: fieldErrors,
      });
    }

    return input;
  }

  private isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }

  private nextTimestamp(previousTimestamp: string): string {
    const currentTime = Date.now();
    const previousTime = new Date(previousTimestamp).getTime();

    return new Date(Math.max(currentTime, previousTime + 1)).toISOString();
  }

  private notFound(id: string): NotFoundException {
    return new NotFoundException({
      code: 'PROJECT_NOT_FOUND',
      message: `Project "${id}" was not found.`,
    });
  }
}

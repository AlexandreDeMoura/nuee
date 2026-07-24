import type { Project, UpdateProjectViewportInput } from '@nuee/shared-types';

export type {
  CreateProjectInput,
  Project,
  UpdateProjectDescriptionInput,
  UpdateProjectViewportInput,
} from '@nuee/shared-types';

export interface ProjectRepository {
  create(project: Project): Project;
  findAll(): Project[];
  findById(id: string): Project | undefined;
  updateDescription(
    id: string,
    description: string,
    updatedAt: string,
  ): Project | undefined;
  updateViewport(
    id: string,
    viewport: UpdateProjectViewportInput,
  ): Project | undefined;
}

export const PROJECT_REPOSITORY = Symbol('PROJECT_REPOSITORY');

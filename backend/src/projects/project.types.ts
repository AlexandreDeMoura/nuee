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
  delete(id: string): boolean;
}

/**
 * Deleting a project cascades its rows away in SQLite, but the private document
 * originals live outside the database and are addressed only by the
 * `file_reference` the cascade destroys. Projects therefore collects the
 * references before the delete and asks Documents to unlink them after it
 * commits — the narrowest capability that keeps file-storage knowledge inside
 * the feature that owns it.
 */
export interface ProjectDocumentFilePurger {
  listProjectFileReferences(projectId: string): string[];
  removeFiles(
    projectId: string,
    fileReferences: readonly string[],
  ): Promise<number>;
}

export const PROJECT_REPOSITORY = Symbol('PROJECT_REPOSITORY');
export const PROJECT_DOCUMENT_FILE_PURGER = Symbol(
  'PROJECT_DOCUMENT_FILE_PURGER',
);

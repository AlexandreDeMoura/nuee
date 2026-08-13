import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PROJECT_DOCUMENT_FILE_PURGER,
  PROJECT_REPOSITORY,
} from './project.types';
import type {
  ProjectDocumentFilePurger,
  ProjectRepository,
} from './project.types';
import { ProjectsService } from './projects.service';

@Injectable()
export class ProjectDeletionService {
  private readonly logger = new Logger('Projects');

  constructor(
    private readonly projectLifecycle: ProjectsService,
    @Inject(PROJECT_REPOSITORY)
    private readonly projects: ProjectRepository,
    @Inject(PROJECT_DOCUMENT_FILE_PURGER)
    private readonly documentFiles: ProjectDocumentFilePurger,
  ) {}

  async delete(projectId: string): Promise<void> {
    this.projectLifecycle.get(projectId);

    // Private originals are only reachable through the document rows the
    // cascade is about to destroy, so the references have to be read first.
    const fileReferences =
      this.documentFiles.listProjectFileReferences(projectId);
    // A concurrent delete leaves the same end state and has collected the same
    // references, so an unchanged row is not an error — the files still need
    // unlinking either way.
    this.projects.delete(projectId);

    if (fileReferences.length === 0) {
      return;
    }

    // Files cannot join the transaction, so they are unlinked after the delete
    // commits. A failure here strands a file rather than a project record, and
    // must not turn a completed deletion into an error response.
    const removedCount = await this.documentFiles.removeFiles(
      projectId,
      fileReferences,
    );

    if (removedCount < fileReferences.length) {
      this.logger.error(
        `Project "${projectId}" was deleted but ${
          fileReferences.length - removedCount
        } of ${fileReferences.length} document originals could not be removed.`,
      );
    }
  }
}

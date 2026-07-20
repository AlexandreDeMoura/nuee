export interface Project {
  id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
  canvas_viewport_x: number;
  canvas_viewport_y: number;
  canvas_zoom: number;
}

export interface CreateProjectInput {
  title: string;
  description: string;
}

export interface UpdateProjectDescriptionInput {
  description: string;
}

export interface ProjectRepository {
  create(project: Project): Project;
  findAll(): Project[];
  findById(id: string): Project | undefined;
  updateDescription(
    id: string,
    description: string,
    updatedAt: string,
  ): Project | undefined;
}

export const PROJECT_REPOSITORY = Symbol('PROJECT_REPOSITORY');

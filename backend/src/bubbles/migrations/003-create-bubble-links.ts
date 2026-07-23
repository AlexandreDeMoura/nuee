export const CREATE_BUBBLE_LINKS_MIGRATION = `
  CREATE UNIQUE INDEX IF NOT EXISTS bubbles_id_project_id_unique_idx
    ON bubbles (id, project_id);

  CREATE TABLE IF NOT EXISTS bubble_links (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    bubble_a_id TEXT NOT NULL,
    bubble_b_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (bubble_a_id < bubble_b_id),
    UNIQUE (project_id, bubble_a_id, bubble_b_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (bubble_a_id, project_id)
      REFERENCES bubbles(id, project_id) ON DELETE CASCADE,
    FOREIGN KEY (bubble_b_id, project_id)
      REFERENCES bubbles(id, project_id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX IF NOT EXISTS bubble_links_project_id_idx
    ON bubble_links (project_id, created_at ASC, id ASC);

  CREATE INDEX IF NOT EXISTS bubble_links_bubble_a_idx
    ON bubble_links (project_id, bubble_a_id);

  CREATE INDEX IF NOT EXISTS bubble_links_bubble_b_idx
    ON bubble_links (project_id, bubble_b_id);
`;

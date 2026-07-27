export const CREATE_DISCUSSION_MESSAGES_MIGRATION = `
  CREATE TABLE IF NOT EXISTS discussion_messages (
    id TEXT PRIMARY KEY,
    discussion_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL CHECK (length(trim(content)) > 0),
    created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
    status TEXT NOT NULL CHECK (
      status IN ('pending', 'completed', 'failed')
    ),
    request_id TEXT CHECK (
      request_id IS NULL OR length(trim(request_id)) > 0
    ),
    UNIQUE (discussion_id, request_id),
    FOREIGN KEY (discussion_id) REFERENCES discussions(id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX IF NOT EXISTS discussion_messages_discussion_created_idx
    ON discussion_messages (discussion_id, created_at ASC, id ASC);
`;

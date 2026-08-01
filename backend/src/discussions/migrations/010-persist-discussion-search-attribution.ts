export const PERSIST_DISCUSSION_SEARCH_ATTRIBUTION_MIGRATION = `
  ALTER TABLE discussion_messages
    ADD COLUMN web_search INTEGER NOT NULL DEFAULT 0 CHECK (
      web_search IN (0, 1)
    );

  ALTER TABLE discussion_messages
    ADD COLUMN web_search_used INTEGER CHECK (
      web_search_used IS NULL OR web_search_used = 1
    );

  ALTER TABLE discussion_messages
    ADD COLUMN citations TEXT CHECK (
      citations IS NULL OR (
        length(CAST(citations AS BLOB)) <= 65536
        AND json_valid(citations)
        AND json_type(citations) = 'array'
      )
    );

  CREATE TRIGGER discussion_messages_search_metadata_insert_guard
  BEFORE INSERT ON discussion_messages
  WHEN
    (
      NEW.role = 'user'
      AND (
        NEW.web_search_used IS NOT NULL
        OR NEW.citations IS NOT NULL
      )
    )
    OR (
      NEW.role = 'assistant'
      AND (
        NEW.web_search != 0
        OR (
          NEW.web_search_used IS NULL
          AND NEW.citations IS NOT NULL
        )
        OR (
          NEW.web_search_used = 1
          AND (
            NEW.status != 'completed'
            OR NEW.citations IS NULL
          )
        )
      )
    )
  BEGIN
    SELECT RAISE(
      ABORT,
      'invalid discussion message search attribution'
    );
  END;

  CREATE TRIGGER discussion_messages_search_metadata_immutable_guard
  BEFORE UPDATE OF web_search, web_search_used, citations
  ON discussion_messages
  WHEN
    NEW.web_search IS NOT OLD.web_search
    OR NEW.web_search_used IS NOT OLD.web_search_used
    OR NEW.citations IS NOT OLD.citations
  BEGIN
    SELECT RAISE(
      ABORT,
      'discussion message search attribution is immutable'
    );
  END;
`;

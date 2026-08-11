import { DatabaseSync } from 'node:sqlite';
import { PROJECT_DESCRIPTION_MAX_LENGTH } from '@nuee/shared-types';
import {
  DATABASE_MIGRATIONS,
  runDatabaseMigrations,
  type DatabaseMigration,
} from './database.migrations';

describe('runDatabaseMigrations', () => {
  it('applies registered migrations in order and records the schema version', () => {
    const database = new DatabaseSync(':memory:');

    try {
      database.exec('PRAGMA foreign_keys = ON;');
      runDatabaseMigrations(database);

      expect(
        database
          .prepare(
            `
              SELECT version, name
              FROM schema_migrations
              ORDER BY version ASC
            `,
          )
          .all(),
      ).toEqual([
        { version: 1, name: 'create-projects' },
        { version: 2, name: 'create-bubbles' },
        { version: 3, name: 'create-bubble-links' },
        { version: 4, name: 'create-discussions' },
        { version: 5, name: 'create-discussion-messages' },
        { version: 6, name: 'persist-discussion-context-items' },
        {
          version: 7,
          name: 'complete-discussion-extraction-provenance',
        },
        {
          version: 8,
          name: 'create-knowledge-extraction-attempts',
        },
        {
          version: 9,
          name: 'create-documents',
        },
        {
          version: 10,
          name: 'persist-discussion-search-attribution',
        },
        {
          version: 11,
          name: 'persist-extraction-intent',
        },
        {
          version: 12,
          name: 'widen-project-description',
        },
        {
          version: 13,
          name: 'repair-project-foreign-keys',
        },
        {
          version: 14,
          name: 'create-territories',
        },
        {
          version: 15,
          name: 'manual-territories',
        },
      ]);
      expect(database.prepare('PRAGMA user_version;').get()).toEqual({
        user_version: 15,
      });
    } finally {
      database.close();
    }
  });

  it('upgrades existing discussion messages with legacy-safe search defaults', () => {
    const database = new DatabaseSync(':memory:');

    try {
      database.exec('PRAGMA foreign_keys = ON;');
      runDatabaseMigrations(database, DATABASE_MIGRATIONS.slice(0, 9));
      database
        .prepare(
          `
            INSERT INTO projects (
              id,
              title,
              description,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(
          'project-search-upgrade',
          'Existing project',
          'Existing project description',
          '2026-07-31T08:00:00.000Z',
          '2026-07-31T08:00:00.000Z',
        );
      database
        .prepare(
          `
            INSERT INTO discussions (
              id,
              project_id,
              title,
              frozen_context,
              created_at,
              updated_at,
              last_activity_at,
              deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          'discussion-search-upgrade',
          'project-search-upgrade',
          'Existing discussion',
          '{}',
          '2026-07-31T09:00:00.000Z',
          '2026-07-31T09:00:00.000Z',
          '2026-07-31T09:00:00.000Z',
          null,
        );
      database
        .prepare(
          `
            INSERT INTO discussion_messages (
              id,
              discussion_id,
              role,
              content,
              created_at,
              status,
              request_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          'message-search-upgrade',
          'discussion-search-upgrade',
          'assistant',
          'Existing answer',
          '2026-07-31T09:00:01.000Z',
          'completed',
          null,
        );

      runDatabaseMigrations(database);

      expect(
        database
          .prepare(
            `
              SELECT web_search, web_search_used, citations
              FROM discussion_messages
              WHERE id = ?
            `,
          )
          .get('message-search-upgrade'),
      ).toEqual({
        web_search: 0,
        web_search_used: null,
        citations: null,
      });
    } finally {
      database.close();
    }
  });

  it('upgrades existing extraction attempts with immutable default intent', () => {
    const database = new DatabaseSync(':memory:');

    try {
      database.exec('PRAGMA foreign_keys = ON;');
      runDatabaseMigrations(database, DATABASE_MIGRATIONS.slice(0, 10));
      database
        .prepare(
          `
            INSERT INTO projects (
              id,
              title,
              description,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(
          'project-extraction-upgrade',
          'Existing project',
          'Existing project description',
          '2026-07-31T08:00:00.000Z',
          '2026-07-31T08:00:00.000Z',
        );
      database
        .prepare(
          `
            INSERT INTO discussions (
              id,
              project_id,
              title,
              frozen_context,
              created_at,
              updated_at,
              last_activity_at,
              deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          'discussion-extraction-upgrade',
          'project-extraction-upgrade',
          'Existing discussion',
          '{}',
          '2026-07-31T09:00:00.000Z',
          '2026-07-31T09:00:00.000Z',
          '2026-07-31T09:00:00.000Z',
          null,
        );
      database
        .prepare(
          `
            INSERT INTO knowledge_extraction_attempts (
              id,
              project_id,
              discussion_id,
              idempotency_key,
              request_fingerprint,
              source_snapshot,
              proposal,
              status,
              resolution_fingerprint,
              resolution_kind,
              resulting_bubble_id,
              retry_count,
              created_at,
              updated_at,
              expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          'extraction-upgrade',
          'project-extraction-upgrade',
          'discussion-extraction-upgrade',
          'existing-extraction',
          'a'.repeat(64),
          JSON.stringify({
            version: 1,
            project_id: 'project-extraction-upgrade',
            discussion_id: 'discussion-extraction-upgrade',
            discussion_title: 'Existing discussion',
            requested_at: '2026-07-31T10:00:00.000Z',
            message_selection_kind: 'selected',
            messages: [
              {
                source_kind: 'message',
                source_id: 'message-existing',
                role: 'assistant',
                content: 'Existing frozen source.',
                created_at: '2026-07-31T09:00:01.000Z',
                discussion_order: 0,
              },
            ],
            frozen_context_items: [],
          }),
          null,
          'failed',
          null,
          null,
          null,
          0,
          '2026-07-31T10:00:00.000Z',
          '2026-07-31T10:01:00.000Z',
          '2026-08-01T10:00:00.000Z',
        );

      runDatabaseMigrations(database);

      expect(
        database
          .prepare(
            `
              SELECT instructions, detail_level
              FROM knowledge_extraction_attempts
              WHERE id = ?
            `,
          )
          .get('extraction-upgrade'),
      ).toEqual({ instructions: null, detail_level: 'standard' });
      expect(() =>
        database
          .prepare(
            `
              UPDATE knowledge_extraction_attempts
              SET instructions = 'Change the original request.'
              WHERE id = ?
            `,
          )
          .run('extraction-upgrade'),
      ).toThrow(/knowledge extraction source snapshot is immutable/);
    } finally {
      database.close();
    }
  });

  it('does not reapply migrations already recorded in the ledger', () => {
    const database = new DatabaseSync(':memory:');

    try {
      runDatabaseMigrations(database);
      runDatabaseMigrations(database);

      expect(
        database
          .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
          .get(),
      ).toEqual({ count: DATABASE_MIGRATIONS.length });
    } finally {
      database.close();
    }
  });

  it('upgrades legacy discussions without reinterpreting their frozen JSON', () => {
    const database = new DatabaseSync(':memory:');

    try {
      database.exec('PRAGMA foreign_keys = ON;');
      runDatabaseMigrations(database, DATABASE_MIGRATIONS.slice(0, 5));
      database
        .prepare(
          `
            INSERT INTO projects (
              id,
              title,
              description,
              created_at,
              updated_at,
              canvas_viewport_x,
              canvas_viewport_y,
              canvas_zoom
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          'project-a',
          'Legacy project',
          'Legacy description',
          '2026-07-27T09:00:00.000Z',
          '2026-07-27T09:00:00.000Z',
          0,
          0,
          1,
        );
      database
        .prepare(
          `
            INSERT INTO discussions (
              id,
              project_id,
              title,
              frozen_context,
              created_at,
              updated_at,
              last_activity_at,
              deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          'discussion-a',
          'project-a',
          null,
          '{"historical_shape":{"content":"Keep exactly this"}}',
          '2026-07-27T10:00:00.000Z',
          '2026-07-27T10:00:00.000Z',
          '2026-07-27T10:00:00.000Z',
          null,
        );

      runDatabaseMigrations(database);

      expect(
        database
          .prepare(
            `
              SELECT
                frozen_context,
                context_version,
                expected_context_item_count,
                creation_idempotency_key,
                creation_request_fingerprint
              FROM discussions
              WHERE id = ?
            `,
          )
          .get('discussion-a'),
      ).toEqual({
        frozen_context: '{"historical_shape":{"content":"Keep exactly this"}}',
        context_version: null,
        expected_context_item_count: null,
        creation_idempotency_key: null,
        creation_request_fingerprint: null,
      });
    } finally {
      database.close();
    }
  });

  it('upgrades existing bubbles with complete provenance defaults and frozen discussion metadata', () => {
    const database = new DatabaseSync(':memory:');

    try {
      database.exec('PRAGMA foreign_keys = ON;');
      runDatabaseMigrations(database, DATABASE_MIGRATIONS.slice(0, 6));
      database
        .prepare(
          `
            INSERT INTO projects (
              id,
              title,
              description,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(
          'project-a',
          'Existing project',
          'Existing project description',
          '2026-07-29T08:00:00.000Z',
          '2026-07-29T08:00:00.000Z',
        );
      database
        .prepare(
          `
            INSERT INTO discussions (
              id,
              project_id,
              title,
              frozen_context,
              created_at,
              updated_at,
              last_activity_at,
              deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          'discussion-a',
          'project-a',
          'Frozen source title',
          '{}',
          '2026-07-29T09:00:00.000Z',
          '2026-07-29T09:00:00.000Z',
          '2026-07-29T09:00:00.000Z',
          '2026-07-29T10:00:00.000Z',
        );
      const insertBubble = database.prepare(
        `
          INSERT INTO bubbles (
            id,
            project_id,
            title,
            content,
            created_at,
            updated_at,
            source_kind,
            source_discussion_id,
            source_message_ids
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );
      insertBubble.run(
        'manual-bubble',
        'project-a',
        'Manual bubble',
        'Manual content',
        '2026-07-29T08:30:00.000Z',
        '2026-07-29T08:30:00.000Z',
        'manual',
        null,
        '[]',
      );
      insertBubble.run(
        'discussion-bubble',
        'project-a',
        'Extracted bubble',
        'Extracted content',
        '2026-07-29T09:30:00.000Z',
        '2026-07-29T09:30:00.000Z',
        'discussion',
        'discussion-a',
        '["message-a"]',
      );
      insertBubble.run(
        'orphaned-discussion-bubble',
        'project-a',
        'Orphaned extracted bubble',
        'Orphaned extracted content',
        '2026-07-29T09:45:00.000Z',
        '2026-07-29T09:45:00.000Z',
        'discussion',
        'missing-discussion',
        '["message-b"]',
      );

      runDatabaseMigrations(database);

      expect(
        database
          .prepare(
            `
              SELECT
                id,
                source_discussion_title,
                source_discussion_deleted_at,
                source_context_item_ids,
                latest_extraction_id
              FROM bubbles
              ORDER BY id ASC
            `,
          )
          .all(),
      ).toEqual([
        {
          id: 'discussion-bubble',
          source_discussion_title: 'Frozen source title',
          source_discussion_deleted_at: '2026-07-29T10:00:00.000Z',
          source_context_item_ids: '[]',
          latest_extraction_id: 'legacy:discussion-bubble',
        },
        {
          id: 'manual-bubble',
          source_discussion_title: null,
          source_discussion_deleted_at: null,
          source_context_item_ids: '[]',
          latest_extraction_id: null,
        },
        {
          id: 'orphaned-discussion-bubble',
          source_discussion_title: 'Unavailable discussion',
          source_discussion_deleted_at: '2026-07-29T09:45:00.000Z',
          source_context_item_ids: '[]',
          latest_extraction_id: 'legacy:orphaned-discussion-bubble',
        },
      ]);
    } finally {
      database.close();
    }
  });

  it('moves existing bubbles into one anchored ungrouped territory per populated project', () => {
    const database = new DatabaseSync(':memory:');

    try {
      database.exec('PRAGMA foreign_keys = ON;');
      runDatabaseMigrations(database, DATABASE_MIGRATIONS.slice(0, 13));
      const insertProject = database.prepare(
        `
          INSERT INTO projects (
            id, title, description, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)
        `,
      );
      insertProject.run(
        'project-with-bubbles',
        'Populated project',
        'Migrates into an ungrouped territory.',
        '2026-08-09T08:00:00.000Z',
        '2026-08-09T08:00:00.000Z',
      );
      insertProject.run(
        'project-without-bubbles',
        'Empty project',
        'Must not receive an empty territory.',
        '2026-08-09T08:00:00.000Z',
        '2026-08-09T08:00:00.000Z',
      );
      const insertBubble = database.prepare(
        `
          INSERT INTO bubbles (
            id, project_id, title, content, position_x, position_y,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );
      insertBubble.run(
        'bubble-lower-x',
        'project-with-bubbles',
        'Left bubble',
        'Its horizontal position anchors the territory.',
        -240,
        100,
        '2026-08-09T09:00:00.000Z',
        '2026-08-09T09:00:00.000Z',
      );
      insertBubble.run(
        'bubble-lower-y',
        'project-with-bubbles',
        'Upper bubble',
        'Its vertical position anchors the territory.',
        80,
        -120,
        '2026-08-09T10:00:00.000Z',
        '2026-08-09T10:00:00.000Z',
      );
      database
        .prepare(
          `
            INSERT INTO bubble_links (
              id, project_id, bubble_a_id, bubble_b_id, created_at
            ) VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(
          'legacy-link',
          'project-with-bubbles',
          'bubble-lower-x',
          'bubble-lower-y',
          '2026-08-09T10:30:00.000Z',
        );

      runDatabaseMigrations(database);

      expect(
        database
          .prepare(
            `
              SELECT project_id, kind, title, position_x, position_y,
                visible_count
              FROM territories
            `,
          )
          .all(),
      ).toEqual([
        {
          project_id: 'project-with-bubbles',
          kind: 'ungrouped',
          title: 'Ungrouped',
          position_x: -240,
          position_y: -120,
          visible_count: 2,
        },
      ]);
      expect(
        database
          .prepare(
            `
              SELECT b.id, b.territory_id, t.project_id
              FROM bubbles AS b
              JOIN territories AS t ON t.id = b.territory_id
              ORDER BY b.id ASC
            `,
          )
          .all(),
      ).toEqual([
        {
          id: 'bubble-lower-x',
          territory_id: 'territory:ungrouped:project-with-bubbles',
          project_id: 'project-with-bubbles',
        },
        {
          id: 'bubble-lower-y',
          territory_id: 'territory:ungrouped:project-with-bubbles',
          project_id: 'project-with-bubbles',
        },
      ]);
      expect(
        database
          .prepare('PRAGMA table_info(bubbles)')
          .all()
          .map((column) => (column as { name: string }).name),
      ).not.toEqual(expect.arrayContaining(['position_x', 'position_y']));
      expect(
        database
          .prepare(
            `
              SELECT id, bubble_a_id, bubble_b_id
              FROM bubble_links
            `,
          )
          .all(),
      ).toEqual([
        {
          id: 'legacy-link',
          bubble_a_id: 'bubble-lower-x',
          bubble_b_id: 'bubble-lower-y',
        },
      ]);
      expect(database.prepare('PRAGMA foreign_key_check;').all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('migrates PRD 10 composed territories to manual without changing membership or layout', () => {
    const database = new DatabaseSync(':memory:');

    try {
      database.exec('PRAGMA foreign_keys = ON;');
      runDatabaseMigrations(database, DATABASE_MIGRATIONS.slice(0, 14));
      database
        .prepare(
          `
            INSERT INTO projects (
              id, title, description, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(
          'prd-10-project',
          'Existing territory map',
          'Keeps the prior composed map intact.',
          '2026-08-09T08:00:00.000Z',
          '2026-08-09T08:00:00.000Z',
        );
      const insertTerritory = database.prepare(
        `
          INSERT INTO territories (
            id, project_id, kind, title, position_x, position_y,
            visible_count, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );
      insertTerritory.run(
        'composed-populated',
        'prd-10-project',
        'composed',
        'Research',
        -80,
        140,
        3,
        '2026-08-09T09:00:00.000Z',
        '2026-08-09T10:00:00.000Z',
      );
      insertTerritory.run(
        'composed-empty',
        'prd-10-project',
        'composed',
        'Decisions',
        320,
        -40,
        4,
        '2026-08-09T09:30:00.000Z',
        '2026-08-09T09:30:00.000Z',
      );
      database
        .prepare(
          `
            INSERT INTO bubbles (
              id, project_id, territory_id, title, content,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          'existing-member',
          'prd-10-project',
          'composed-populated',
          'Existing bubble',
          'Membership must survive the kind migration.',
          '2026-08-09T10:00:00.000Z',
          '2026-08-09T10:00:00.000Z',
        );

      runDatabaseMigrations(database);

      expect(
        database
          .prepare(
            `
              SELECT id, kind, title, position_x, position_y, visible_count,
                created_at, updated_at
              FROM territories
              ORDER BY id ASC
            `,
          )
          .all(),
      ).toEqual([
        {
          id: 'composed-empty',
          kind: 'manual',
          title: 'Decisions',
          position_x: 320,
          position_y: -40,
          visible_count: 4,
          created_at: '2026-08-09T09:30:00.000Z',
          updated_at: '2026-08-09T09:30:00.000Z',
        },
        {
          id: 'composed-populated',
          kind: 'manual',
          title: 'Research',
          position_x: -80,
          position_y: 140,
          visible_count: 3,
          created_at: '2026-08-09T09:00:00.000Z',
          updated_at: '2026-08-09T10:00:00.000Z',
        },
      ]);
      expect(
        database
          .prepare(
            `
              SELECT id, territory_id
              FROM bubbles
              WHERE id = 'existing-member'
            `,
          )
          .get(),
      ).toEqual({
        id: 'existing-member',
        territory_id: 'composed-populated',
      });
      expect(() =>
        insertTerritory.run(
          'new-composed',
          'prd-10-project',
          'composed',
          'Invalid old kind',
          0,
          0,
          1,
          '2026-08-09T11:00:00.000Z',
          '2026-08-09T11:00:00.000Z',
        ),
      ).toThrow();
      expect(database.prepare('PRAGMA foreign_key_check;').all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('rejects malformed JSON and inconsistent extraction provenance', () => {
    const database = new DatabaseSync(':memory:');

    try {
      database.exec('PRAGMA foreign_keys = ON;');
      runDatabaseMigrations(database);
      database
        .prepare(
          `
            INSERT INTO projects (
              id,
              title,
              description,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(
          'project-a',
          'Guarded project',
          'Guarded project description',
          '2026-07-29T08:00:00.000Z',
          '2026-07-29T08:00:00.000Z',
        );
      const insertBubble = database.prepare(
        `
          INSERT INTO bubbles (
            id,
            project_id,
            title,
            content,
            created_at,
            updated_at,
            source_kind,
            source_discussion_id,
            source_discussion_title,
            source_message_ids,
            source_context_item_ids,
            latest_extraction_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );
      const common = [
        'project-a',
        'Bubble title',
        'Bubble content',
        '2026-07-29T08:00:00.000Z',
        '2026-07-29T08:00:00.000Z',
      ] as const;

      expect(() =>
        insertBubble.run(
          'bad-json',
          ...common,
          'discussion',
          'discussion-a',
          'Discussion title',
          '["message-a"]',
          '{not-json}',
          'extraction-a',
        ),
      ).toThrow();
      expect(() =>
        insertBubble.run(
          'manual-with-source',
          ...common,
          'manual',
          'discussion-a',
          'Discussion title',
          '[]',
          '[]',
          null,
        ),
      ).toThrow(/invalid bubble discussion extraction provenance/);
      expect(() =>
        insertBubble.run(
          'source-less-extraction',
          ...common,
          'discussion',
          'discussion-a',
          'Discussion title',
          '[]',
          '[]',
          'extraction-b',
        ),
      ).toThrow(/invalid bubble discussion extraction provenance/);
      expect(() =>
        insertBubble.run(
          'missing-discussion',
          ...common,
          'discussion',
          null,
          'Discussion title',
          '["message-a"]',
          '[]',
          'extraction-missing-discussion',
        ),
      ).toThrow(/invalid bubble discussion extraction provenance/);
      expect(() =>
        insertBubble.run(
          'duplicate-sources',
          ...common,
          'discussion',
          'discussion-a',
          'Discussion title',
          '["message-a","message-a"]',
          '[]',
          'extraction-c',
        ),
      ).toThrow(/invalid bubble discussion extraction provenance/);
    } finally {
      database.close();
    }
  });

  it('rolls back the complete schema update when a migration fails', () => {
    const database = new DatabaseSync(':memory:');
    const migrations: readonly DatabaseMigration[] = [
      {
        version: 1,
        name: 'create-first-table',
        sql: 'CREATE TABLE first_table (id INTEGER PRIMARY KEY) STRICT;',
      },
      {
        version: 2,
        name: 'fail-after-partial-ddl',
        sql: `
          CREATE TABLE partial_table (id INTEGER PRIMARY KEY) STRICT;
          THIS IS NOT VALID SQL;
        `,
      },
    ];

    try {
      expect(() => runDatabaseMigrations(database, migrations)).toThrow();
      expect(
        database
          .prepare(
            `
              SELECT name
              FROM sqlite_schema
              WHERE type = 'table'
              ORDER BY name ASC
            `,
          )
          .all(),
      ).toEqual([]);
      expect(database.prepare('PRAGMA user_version;').get()).toEqual({
        user_version: 0,
      });
    } finally {
      database.close();
    }
  });

  it('widens the project description limit without cascading to related rows', () => {
    const database = new DatabaseSync(':memory:');
    const legacyDescriptionLimit = 280;

    try {
      database.exec('PRAGMA foreign_keys = ON;');
      runDatabaseMigrations(database, DATABASE_MIGRATIONS.slice(0, 11));
      database
        .prepare(
          `
            INSERT INTO projects (
              id,
              title,
              description,
              created_at,
              updated_at,
              canvas_viewport_x,
              canvas_viewport_y,
              canvas_zoom
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          'project-widening',
          'Existing project',
          'a'.repeat(legacyDescriptionLimit),
          '2026-08-04T08:00:00.000Z',
          '2026-08-04T08:00:00.000Z',
          42.5,
          -17,
          1.5,
        );
      database
        .prepare(
          `
            INSERT INTO bubbles (
              id,
              project_id,
              title,
              content,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          'bubble-widening',
          'project-widening',
          'Existing bubble',
          'Must survive the table rebuild',
          '2026-08-04T09:00:00.000Z',
          '2026-08-04T09:00:00.000Z',
        );
      database
        .prepare(
          `
            INSERT INTO discussions (
              id,
              project_id,
              title,
              frozen_context,
              created_at,
              updated_at,
              last_activity_at,
              deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          'discussion-widening',
          'project-widening',
          'Existing discussion',
          '{}',
          '2026-08-04T09:00:00.000Z',
          '2026-08-04T09:00:00.000Z',
          '2026-08-04T09:00:00.000Z',
          null,
        );

      expect(() =>
        database
          .prepare('UPDATE projects SET description = ? WHERE id = ?')
          .run('a'.repeat(legacyDescriptionLimit + 1), 'project-widening'),
      ).toThrow();

      runDatabaseMigrations(database);

      // The cascade hazard: dropping the parent with foreign keys enabled would
      // have deleted these rows rather than the emptied placeholder table.
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM bubbles').get(),
      ).toEqual({ count: 1 });
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM discussions').get(),
      ).toEqual({ count: 1 });
      expect(
        database
          .prepare(
            `
              SELECT description, canvas_viewport_x, canvas_viewport_y, canvas_zoom
              FROM projects
              WHERE id = ?
            `,
          )
          .get('project-widening'),
      ).toEqual({
        description: 'a'.repeat(legacyDescriptionLimit),
        canvas_viewport_x: 42.5,
        canvas_viewport_y: -17,
        canvas_zoom: 1.5,
      });
      expect(
        database
          .prepare(
            `
              SELECT b.id
              FROM bubbles AS b
              JOIN projects AS p ON p.id = b.project_id
            `,
          )
          .all(),
      ).toEqual([{ id: 'bubble-widening' }]);
      expect(database.prepare('PRAGMA foreign_key_check;').all()).toEqual([]);

      database
        .prepare('UPDATE projects SET description = ? WHERE id = ?')
        .run('a'.repeat(PROJECT_DESCRIPTION_MAX_LENGTH), 'project-widening');

      expect(() =>
        database
          .prepare('UPDATE projects SET description = ? WHERE id = ?')
          .run(
            'a'.repeat(PROJECT_DESCRIPTION_MAX_LENGTH + 1),
            'project-widening',
          ),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it('repairs project foreign keys left by the originally deployed widening migration', () => {
    const database = new DatabaseSync(':memory:');
    const brokenWideningMigration: DatabaseMigration = {
      version: 12,
      name: 'widen-project-description',
      sql: `
        ALTER TABLE projects
          RENAME TO projects_pre_description_widening;

        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL CHECK (length(title) > 0),
          description TEXT NOT NULL CHECK (
            length(description) > 0 AND length(description) <= 800
          ),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          canvas_viewport_x REAL NOT NULL DEFAULT 0,
          canvas_viewport_y REAL NOT NULL DEFAULT 0,
          canvas_zoom REAL NOT NULL DEFAULT 1
        ) STRICT;

        INSERT INTO projects SELECT * FROM projects_pre_description_widening;

        DROP TABLE projects_pre_description_widening;

        CREATE INDEX projects_updated_at_idx
          ON projects (updated_at DESC, created_at DESC, id ASC);
      `,
    };

    try {
      database.exec('PRAGMA foreign_keys = ON;');
      runDatabaseMigrations(database, [
        ...DATABASE_MIGRATIONS.slice(0, 11),
        brokenWideningMigration,
      ]);
      database
        .prepare(
          `
            INSERT INTO projects (
              id,
              title,
              description,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(
          'project-fk-repair',
          'Project needing FK repair',
          'The project row remains valid throughout the repair.',
          '2026-08-06T08:00:00.000Z',
          '2026-08-06T08:00:00.000Z',
        );

      expect(
        database
          .prepare(
            `
              SELECT DISTINCT fk.[table] AS parent_table
              FROM sqlite_schema AS tables
              JOIN pragma_foreign_key_list(tables.name) AS fk
              WHERE
                tables.type = 'table'
                AND fk.[from] = 'project_id'
              ORDER BY parent_table ASC
            `,
          )
          .all(),
      ).toEqual([
        { parent_table: 'bubbles' },
        { parent_table: 'projects_pre_description_widening' },
      ]);
      expect(() =>
        database
          .prepare(
            `
              INSERT INTO documents (
                id,
                project_id,
                title,
                original_filename,
                file_reference,
                format,
                mime_type,
                size_bytes,
                source_hash,
                upload_idempotency_key,
                upload_request_fingerprint,
                created_at,
                updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            'document-before-fk-repair',
            'project-fk-repair',
            'Blocked document',
            'blocked.txt',
            'originals/aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'plain_text',
            'text/plain',
            12,
            'a'.repeat(64),
            'blocked-upload',
            'b'.repeat(64),
            '2026-08-06T08:01:00.000Z',
            '2026-08-06T08:01:00.000Z',
          ),
      ).toThrow(/projects_pre_description_widening/);

      runDatabaseMigrations(database);

      expect(
        database
          .prepare(
            `
              SELECT DISTINCT fk.[table] AS parent_table
              FROM sqlite_schema AS tables
              JOIN pragma_foreign_key_list(tables.name) AS fk
              WHERE
                tables.type = 'table'
                AND fk.[from] = 'project_id'
              ORDER BY parent_table ASC
            `,
          )
          .all(),
      ).toEqual([
        { parent_table: 'bubbles' },
        { parent_table: 'projects' },
        { parent_table: 'territories' },
      ]);
      expect(database.prepare('PRAGMA foreign_key_check;').all()).toEqual([]);
      expect(() =>
        database
          .prepare(
            `
              INSERT INTO documents (
                id,
                project_id,
                title,
                original_filename,
                file_reference,
                format,
                mime_type,
                size_bytes,
                source_hash,
                upload_idempotency_key,
                upload_request_fingerprint,
                created_at,
                updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            'document-after-fk-repair',
            'project-fk-repair',
            'Accepted document',
            'accepted.txt',
            'originals/bb/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'plain_text',
            'text/plain',
            12,
            'c'.repeat(64),
            'accepted-upload',
            'd'.repeat(64),
            '2026-08-06T08:02:00.000Z',
            '2026-08-06T08:02:00.000Z',
          ),
      ).not.toThrow();
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM documents').get(),
      ).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  // Migration SQL is literal, so the schema only tracks
  // PROJECT_DESCRIPTION_MAX_LENGTH if someone adds a migration when the
  // constant moves. Without this guard the server accepts a description the
  // database then rejects with a raw CHECK failure.
  it('enforces exactly the shared project description limit after migrating', () => {
    const database = new DatabaseSync(':memory:');

    try {
      database.exec('PRAGMA foreign_keys = ON;');
      runDatabaseMigrations(database);

      const insertProject = database.prepare(
        `
          INSERT INTO projects (
            id,
            title,
            description,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?)
        `,
      );
      const insertWithDescriptionLength = (id: string, length: number) =>
        insertProject.run(
          id,
          'Limit probe',
          'a'.repeat(length),
          '2026-08-06T10:00:00.000Z',
          '2026-08-06T10:00:00.000Z',
        );

      expect(() =>
        insertWithDescriptionLength(
          'project-at-limit',
          PROJECT_DESCRIPTION_MAX_LENGTH,
        ),
      ).not.toThrow();
      expect(() =>
        insertWithDescriptionLength(
          'project-over-limit',
          PROJECT_DESCRIPTION_MAX_LENGTH + 1,
        ),
      ).toThrow(/CHECK constraint failed/);
    } finally {
      database.close();
    }
  });
});

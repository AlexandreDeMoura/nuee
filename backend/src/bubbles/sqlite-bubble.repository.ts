import type { DatabaseSync } from 'node:sqlite';
import { Injectable } from '@nestjs/common';
import { DatabaseProvider } from '../database/database.provider';
import { BubbleProvenanceIntegrityError } from './bubble.types';
import type {
  Bubble,
  BubbleDiscussionProvenanceWriter,
  BubbleLink,
  BubbleLinkRepository,
  BubblePositionUpdate,
  BubbleRepository,
  PersistedBubble,
} from './bubble.types';

interface BubbleRow {
  id: string;
  project_id: string;
  title: string;
  summary: string | null;
  content: string;
  position_x: number;
  position_y: number;
  created_at: string;
  updated_at: string;
  source_kind: unknown;
  source_discussion_id: unknown;
  source_discussion_title: unknown;
  source_discussion_deleted_at: unknown;
  source_message_ids: unknown;
  source_context_item_ids: unknown;
  latest_extraction_id: unknown;
}

interface BubbleLinkRow {
  id: string;
  project_id: string;
  bubble_a_id: string;
  bubble_b_id: string;
  created_at: string;
}

@Injectable()
export class SqliteBubbleRepository
  implements
    BubbleRepository,
    BubbleLinkRepository,
    BubbleDiscussionProvenanceWriter
{
  private readonly database: DatabaseSync;

  constructor(databaseProvider: DatabaseProvider) {
    this.database = databaseProvider.connection;
  }

  create(bubble: PersistedBubble): Bubble {
    this.database
      .prepare(
        `
          INSERT INTO bubbles (
            id,
            project_id,
            title,
            summary,
            content,
            position_x,
            position_y,
            created_at,
            updated_at,
            source_kind,
            source_discussion_id,
            source_discussion_title,
            source_discussion_deleted_at,
            source_message_ids,
            source_context_item_ids,
            latest_extraction_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        bubble.id,
        bubble.project_id,
        bubble.title,
        bubble.summary,
        bubble.content,
        bubble.position_x,
        bubble.position_y,
        bubble.created_at,
        bubble.updated_at,
        bubble.source_kind,
        bubble.source_discussion_id,
        bubble.source_discussion_title,
        bubble.source_discussion_deleted_at,
        JSON.stringify(bubble.source_message_ids),
        JSON.stringify(bubble.source_context_item_ids),
        bubble.latest_extraction_id,
      );

    return this.toPublicBubble(bubble);
  }

  findAllByProjectId(projectId: string): Bubble[] {
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM bubbles
          WHERE project_id = ?
          ORDER BY created_at ASC, id ASC
        `,
      )
      .all(projectId) as unknown as BubbleRow[];

    return rows.map((row) => this.toBubble(row));
  }

  findProjectIdById(id: string): string | undefined {
    const row = this.database
      .prepare('SELECT project_id FROM bubbles WHERE id = ?')
      .get(id) as unknown as Pick<BubbleRow, 'project_id'> | undefined;

    return row?.project_id;
  }

  findByProjectAndId(projectId: string, id: string): Bubble | undefined {
    const row = this.database
      .prepare(
        `
          SELECT *
          FROM bubbles
          WHERE project_id = ? AND id = ?
        `,
      )
      .get(projectId, id) as unknown as BubbleRow | undefined;

    return row ? this.toBubble(row) : undefined;
  }

  findByLatestExtractionId(extractionId: string): Bubble | undefined {
    const row = this.database
      .prepare(
        `
          SELECT *
          FROM bubbles
          WHERE latest_extraction_id = ?
        `,
      )
      .get(extractionId) as unknown as BubbleRow | undefined;

    return row ? this.toBubble(row) : undefined;
  }

  updateContent(
    projectId: string,
    id: string,
    input: Pick<Bubble, 'title' | 'summary' | 'content' | 'updated_at'>,
  ): Bubble | undefined {
    const result = this.database
      .prepare(
        `
          UPDATE bubbles
          SET title = ?, summary = ?, content = ?, updated_at = ?
          WHERE project_id = ? AND id = ?
        `,
      )
      .run(
        input.title,
        input.summary,
        input.content,
        input.updated_at,
        projectId,
        id,
      );

    return result.changes === 0
      ? undefined
      : this.findByProjectAndId(projectId, id);
  }

  updatePosition(
    projectId: string,
    id: string,
    positionX: number,
    positionY: number,
  ): Bubble | undefined {
    const result = this.database
      .prepare(
        `
          UPDATE bubbles
          SET position_x = ?, position_y = ?
          WHERE project_id = ? AND id = ?
        `,
      )
      .run(positionX, positionY, projectId, id);

    return result.changes === 0
      ? undefined
      : this.findByProjectAndId(projectId, id);
  }

  updateFromDiscussionExtraction(
    projectId: string,
    id: string,
    expectedUpdatedAt: string,
    bubble: Pick<
      PersistedBubble,
      | 'title'
      | 'summary'
      | 'content'
      | 'updated_at'
      | 'source_kind'
      | 'source_discussion_id'
      | 'source_discussion_title'
      | 'source_discussion_deleted_at'
      | 'source_message_ids'
      | 'source_context_item_ids'
      | 'latest_extraction_id'
    >,
  ): Bubble | undefined {
    const result = this.database
      .prepare(
        `
          UPDATE bubbles
          SET
            title = ?,
            summary = ?,
            content = ?,
            updated_at = ?,
            source_kind = ?,
            source_discussion_id = ?,
            source_discussion_title = ?,
            source_discussion_deleted_at = ?,
            source_message_ids = ?,
            source_context_item_ids = ?,
            latest_extraction_id = ?
          WHERE project_id = ? AND id = ? AND updated_at = ?
        `,
      )
      .run(
        bubble.title,
        bubble.summary,
        bubble.content,
        bubble.updated_at,
        bubble.source_kind,
        bubble.source_discussion_id,
        bubble.source_discussion_title,
        bubble.source_discussion_deleted_at,
        JSON.stringify(bubble.source_message_ids),
        JSON.stringify(bubble.source_context_item_ids),
        bubble.latest_extraction_id,
        projectId,
        id,
        expectedUpdatedAt,
      );

    return result.changes === 0
      ? undefined
      : this.findByProjectAndId(projectId, id);
  }

  updatePositions(
    projectId: string,
    positions: BubblePositionUpdate[],
  ): Bubble[] {
    const statement = this.database.prepare(
      `
        UPDATE bubbles
        SET position_x = ?, position_y = ?
        WHERE project_id = ? AND id = ?
      `,
    );

    this.database.exec('BEGIN IMMEDIATE;');

    try {
      for (const position of positions) {
        const result = statement.run(
          position.position_x,
          position.position_y,
          projectId,
          position.bubble_id,
        );

        if (result.changes === 0) {
          throw new Error(
            `Bubble "${position.bubble_id}" was not available for batch positioning.`,
          );
        }
      }

      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }

    return positions.map((position) => {
      const bubble = this.findByProjectAndId(projectId, position.bubble_id);

      if (!bubble) {
        throw new Error(
          `Bubble "${position.bubble_id}" was not available after batch positioning.`,
        );
      }

      return bubble;
    });
  }

  markSourceDiscussionDeleted(
    projectId: string,
    discussionId: string,
    deletedAt: string,
  ): number {
    const result = this.database
      .prepare(
        `
          UPDATE bubbles
          SET source_discussion_deleted_at = ?
          WHERE
            project_id = ?
            AND source_kind = 'discussion'
            AND source_discussion_id = ?
            AND source_discussion_deleted_at IS NULL
        `,
      )
      .run(deletedAt, projectId, discussionId);

    return Number(result.changes);
  }

  delete(projectId: string, id: string): boolean {
    const result = this.database
      .prepare('DELETE FROM bubbles WHERE project_id = ? AND id = ?')
      .run(projectId, id);

    return result.changes > 0;
  }

  createLink(link: BubbleLink): BubbleLink {
    this.database
      .prepare(
        `
          INSERT INTO bubble_links (
            id,
            project_id,
            bubble_a_id,
            bubble_b_id,
            created_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (project_id, bubble_a_id, bubble_b_id) DO NOTHING
        `,
      )
      .run(
        link.id,
        link.project_id,
        link.bubble_a_id,
        link.bubble_b_id,
        link.created_at,
      );

    return (
      this.findLink(link.project_id, link.bubble_a_id, link.bubble_b_id) ?? link
    );
  }

  findAllLinksByProjectId(projectId: string): BubbleLink[] {
    return this.database
      .prepare(
        `
          SELECT *
          FROM bubble_links
          WHERE project_id = ?
          ORDER BY created_at ASC, id ASC
        `,
      )
      .all(projectId) as unknown as BubbleLinkRow[];
  }

  findLink(
    projectId: string,
    bubbleAId: string,
    bubbleBId: string,
  ): BubbleLink | undefined {
    return this.database
      .prepare(
        `
          SELECT *
          FROM bubble_links
          WHERE project_id = ? AND bubble_a_id = ? AND bubble_b_id = ?
        `,
      )
      .get(projectId, bubbleAId, bubbleBId) as unknown as
      BubbleLinkRow | undefined;
  }

  deleteLink(projectId: string, bubbleAId: string, bubbleBId: string): boolean {
    const result = this.database
      .prepare(
        `
          DELETE FROM bubble_links
          WHERE project_id = ? AND bubble_a_id = ? AND bubble_b_id = ?
        `,
      )
      .run(projectId, bubbleAId, bubbleBId);

    return result.changes > 0;
  }

  private toBubble(row: BubbleRow): Bubble {
    const sourceMessageIds = this.parseIdentifierArray(
      row.source_message_ids,
      row.id,
    );
    const sourceContextItemIds = this.parseIdentifierArray(
      row.source_context_item_ids,
      row.id,
    );
    const isManualProvenance =
      row.source_kind === 'manual' &&
      row.source_discussion_id === null &&
      row.source_discussion_title === null &&
      row.source_discussion_deleted_at === null &&
      row.latest_extraction_id === null &&
      sourceMessageIds.length === 0 &&
      sourceContextItemIds.length === 0;
    const isDiscussionProvenance =
      row.source_kind === 'discussion' &&
      this.isNonEmptyString(row.source_discussion_id) &&
      this.isNonEmptyString(row.source_discussion_title) &&
      (row.source_discussion_deleted_at === null ||
        this.isIsoTimestamp(row.source_discussion_deleted_at)) &&
      this.isNonEmptyString(row.latest_extraction_id) &&
      sourceMessageIds.length + sourceContextItemIds.length > 0;

    if (!isManualProvenance && !isDiscussionProvenance) {
      throw new BubbleProvenanceIntegrityError(row.id);
    }

    return {
      id: row.id,
      project_id: row.project_id,
      title: row.title,
      summary: row.summary,
      content: row.content,
      position_x: row.position_x,
      position_y: row.position_y,
      created_at: row.created_at,
      updated_at: row.updated_at,
      source_kind: row.source_kind as Bubble['source_kind'],
      source_discussion_id:
        row.source_discussion_id as Bubble['source_discussion_id'],
      source_discussion_title:
        row.source_discussion_title as Bubble['source_discussion_title'],
      source_discussion_deleted_at:
        row.source_discussion_deleted_at as Bubble['source_discussion_deleted_at'],
      source_message_ids: sourceMessageIds,
      source_context_item_ids: sourceContextItemIds,
    };
  }

  private parseIdentifierArray(value: unknown, bubbleId: string): string[] {
    if (typeof value !== 'string') {
      throw new BubbleProvenanceIntegrityError(bubbleId);
    }

    try {
      const parsed = JSON.parse(value) as unknown;

      if (
        !Array.isArray(parsed) ||
        parsed.some((identifier) => !this.isNonEmptyString(identifier)) ||
        new Set(parsed).size !== parsed.length
      ) {
        throw new BubbleProvenanceIntegrityError(bubbleId);
      }

      return parsed as string[];
    } catch (error) {
      if (error instanceof BubbleProvenanceIntegrityError) {
        throw error;
      }

      throw new BubbleProvenanceIntegrityError(bubbleId);
    }
  }

  private toPublicBubble(bubble: PersistedBubble): Bubble {
    const { latest_extraction_id: _latestExtractionId, ...publicBubble } =
      bubble;
    void _latestExtractionId;

    return publicBubble;
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private isIsoTimestamp(value: unknown): value is string {
    if (typeof value !== 'string') {
      return false;
    }

    const milliseconds = Date.parse(value);

    return (
      Number.isFinite(milliseconds) &&
      new Date(milliseconds).toISOString() === value
    );
  }
}

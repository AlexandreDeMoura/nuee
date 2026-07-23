import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type {
  Bubble,
  BubbleLink,
  BubbleLinkRepository,
  BubbleRepository,
  BubbleSourceKind,
} from './bubble.types';
import { CREATE_BUBBLES_MIGRATION } from './migrations/002-create-bubbles';
import { CREATE_BUBBLE_LINKS_MIGRATION } from './migrations/003-create-bubble-links';

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
  source_kind: BubbleSourceKind;
  source_discussion_id: string | null;
  source_message_ids: string;
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
  implements BubbleRepository, BubbleLinkRepository, OnModuleDestroy
{
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA foreign_keys = ON;');
    this.database.exec(CREATE_BUBBLES_MIGRATION);
    this.database.exec(CREATE_BUBBLE_LINKS_MIGRATION);
  }

  create(bubble: Bubble): Bubble {
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
            source_message_ids
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        JSON.stringify(bubble.source_message_ids),
      );

    return bubble;
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

  onModuleDestroy(): void {
    this.database.close();
  }

  private toBubble(row: BubbleRow): Bubble {
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
      source_kind: row.source_kind,
      source_discussion_id: row.source_discussion_id,
      source_message_ids: JSON.parse(row.source_message_ids) as string[],
    };
  }
}

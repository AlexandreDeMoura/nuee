import type { DatabaseSync } from 'node:sqlite';
import { Injectable } from '@nestjs/common';
import { DatabaseProvider } from '../database/database.provider';
import type {
  DiscussionMessageRepository,
  DiscussionMessageStatus,
  DiscussionRepository,
  PersistedDiscussion,
  PersistedDiscussionMessage,
} from './discussion.types';

interface DiscussionRow {
  id: string;
  project_id: string;
  title: string | null;
  frozen_context: string;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  deleted_at: string | null;
}

interface DiscussionMessageRow {
  id: string;
  discussion_id: string;
  role: PersistedDiscussionMessage['role'];
  content: string;
  created_at: string;
  status: DiscussionMessageStatus;
  request_id: string | null;
}

@Injectable()
export class SqliteDiscussionRepository
  implements DiscussionRepository, DiscussionMessageRepository
{
  private readonly database: DatabaseSync;

  constructor(databaseProvider: DatabaseProvider) {
    this.database = databaseProvider.connection;
  }

  createWithFirstMessage(
    discussion: PersistedDiscussion,
    message: PersistedDiscussionMessage,
  ): PersistedDiscussion {
    if (
      message.discussion_id !== discussion.id ||
      message.role !== 'user' ||
      message.status !== 'pending' ||
      message.request_id === null
    ) {
      throw new Error(
        'A discussion must be created with its pending, idempotent first user message.',
      );
    }

    this.database.exec('BEGIN IMMEDIATE;');

    try {
      this.insertDiscussion(discussion);
      this.insertMessage(message);
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }

    return discussion;
  }

  findAllByProjectId(projectId: string): PersistedDiscussion[] {
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM discussions
          WHERE project_id = ? AND deleted_at IS NULL
          ORDER BY last_activity_at DESC, created_at DESC, id ASC
        `,
      )
      .all(projectId) as unknown as DiscussionRow[];

    return rows.map((row) => this.toDiscussion(row));
  }

  findByProjectAndId(
    projectId: string,
    discussionId: string,
  ): PersistedDiscussion | undefined {
    const row = this.database
      .prepare(
        `
          SELECT *
          FROM discussions
          WHERE project_id = ? AND id = ? AND deleted_at IS NULL
        `,
      )
      .get(projectId, discussionId) as unknown as DiscussionRow | undefined;

    return row ? this.toDiscussion(row) : undefined;
  }

  updateTitle(
    projectId: string,
    discussionId: string,
    title: string,
    updatedAt: string,
  ): PersistedDiscussion | undefined {
    const result = this.database
      .prepare(
        `
          UPDATE discussions
          SET title = ?, updated_at = ?
          WHERE project_id = ? AND id = ? AND deleted_at IS NULL
        `,
      )
      .run(title, updatedAt, projectId, discussionId);

    return result.changes === 0
      ? undefined
      : this.findByProjectAndId(projectId, discussionId);
  }

  updateActivity(
    projectId: string,
    discussionId: string,
    lastActivityAt: string,
  ): PersistedDiscussion | undefined {
    const result = this.database
      .prepare(
        `
          UPDATE discussions
          SET last_activity_at = ?
          WHERE project_id = ? AND id = ? AND deleted_at IS NULL
        `,
      )
      .run(lastActivityAt, projectId, discussionId);

    return result.changes === 0
      ? undefined
      : this.findByProjectAndId(projectId, discussionId);
  }

  softDelete(
    projectId: string,
    discussionId: string,
    deletedAt: string,
  ): boolean {
    const result = this.database
      .prepare(
        `
          UPDATE discussions
          SET deleted_at = ?, updated_at = ?
          WHERE project_id = ? AND id = ? AND deleted_at IS NULL
        `,
      )
      .run(deletedAt, deletedAt, projectId, discussionId);

    return result.changes > 0;
  }

  appendMessage(
    projectId: string,
    message: PersistedDiscussionMessage,
    activityAt: string,
  ): PersistedDiscussionMessage | undefined {
    this.database.exec('BEGIN IMMEDIATE;');

    try {
      const discussion = this.database
        .prepare(
          `
            SELECT id
            FROM discussions
            WHERE project_id = ? AND id = ? AND deleted_at IS NULL
          `,
        )
        .get(projectId, message.discussion_id);

      if (!discussion) {
        this.database.exec('ROLLBACK;');
        return undefined;
      }

      this.insertMessage(message);
      this.database
        .prepare(
          `
            UPDATE discussions
            SET updated_at = ?, last_activity_at = ?
            WHERE id = ?
          `,
        )
        .run(activityAt, activityAt, message.discussion_id);
      this.database.exec('COMMIT;');
      return message;
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  findAllMessages(
    projectId: string,
    discussionId: string,
  ): PersistedDiscussionMessage[] {
    const rows = this.database
      .prepare(
        `
          SELECT message.*
          FROM discussion_messages AS message
          INNER JOIN discussions AS discussion
            ON discussion.id = message.discussion_id
          WHERE
            discussion.project_id = ?
            AND discussion.id = ?
            AND discussion.deleted_at IS NULL
          ORDER BY message.created_at ASC, message.id ASC
        `,
      )
      .all(projectId, discussionId) as unknown as DiscussionMessageRow[];

    return rows.map((row) => this.toMessage(row));
  }

  findMessageByRequestId(
    projectId: string,
    discussionId: string,
    requestId: string,
  ): PersistedDiscussionMessage | undefined {
    const row = this.database
      .prepare(
        `
          SELECT message.*
          FROM discussion_messages AS message
          INNER JOIN discussions AS discussion
            ON discussion.id = message.discussion_id
          WHERE
            discussion.project_id = ?
            AND discussion.id = ?
            AND discussion.deleted_at IS NULL
            AND message.request_id = ?
        `,
      )
      .get(projectId, discussionId, requestId) as unknown as
      DiscussionMessageRow | undefined;

    return row ? this.toMessage(row) : undefined;
  }

  completeMessageGeneration(
    projectId: string,
    discussionId: string,
    userMessageId: string,
    assistantMessage: PersistedDiscussionMessage,
    completedAt: string,
  ): PersistedDiscussionMessage | undefined {
    if (
      assistantMessage.discussion_id !== discussionId ||
      assistantMessage.role !== 'assistant' ||
      assistantMessage.status !== 'completed'
    ) {
      throw new Error(
        'A completed generation must append an assistant message to the requested discussion.',
      );
    }

    this.database.exec('BEGIN IMMEDIATE;');

    try {
      const pendingUserMessage = this.database
        .prepare(
          `
            UPDATE discussion_messages
            SET status = 'completed'
            WHERE
              id = ?
              AND discussion_id = ?
              AND role = 'user'
              AND status IN ('pending', 'failed')
              AND EXISTS (
                SELECT 1
                FROM discussions
                WHERE
                  id = discussion_messages.discussion_id
                  AND project_id = ?
                  AND deleted_at IS NULL
              )
          `,
        )
        .run(userMessageId, discussionId, projectId);

      if (pendingUserMessage.changes === 0) {
        this.database.exec('ROLLBACK;');
        return undefined;
      }

      this.insertMessage(assistantMessage);
      this.database
        .prepare(
          `
            UPDATE discussions
            SET updated_at = ?, last_activity_at = ?
            WHERE id = ?
          `,
        )
        .run(completedAt, completedAt, discussionId);
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }

    return assistantMessage;
  }

  updateMessageStatus(
    projectId: string,
    discussionId: string,
    messageId: string,
    status: DiscussionMessageStatus,
    updatedAt: string,
  ): PersistedDiscussionMessage | undefined {
    this.database.exec('BEGIN IMMEDIATE;');

    try {
      const result = this.database
        .prepare(
          `
            UPDATE discussion_messages
            SET status = ?
            WHERE
              id = ?
              AND discussion_id = ?
              AND EXISTS (
                SELECT 1
                FROM discussions
                WHERE
                  id = discussion_messages.discussion_id
                  AND project_id = ?
                  AND deleted_at IS NULL
              )
          `,
        )
        .run(status, messageId, discussionId, projectId);

      if (result.changes === 0) {
        this.database.exec('ROLLBACK;');
        return undefined;
      }

      this.database
        .prepare(
          `
            UPDATE discussions
            SET updated_at = ?
            WHERE id = ?
          `,
        )
        .run(updatedAt, discussionId);
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }

    return this.findMessageById(projectId, discussionId, messageId);
  }

  private insertDiscussion(discussion: PersistedDiscussion): void {
    this.database
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
        discussion.id,
        discussion.project_id,
        discussion.title,
        JSON.stringify(discussion.frozen_context),
        discussion.created_at,
        discussion.updated_at,
        discussion.last_activity_at,
        discussion.deleted_at,
      );
  }

  private insertMessage(message: PersistedDiscussionMessage): void {
    this.database
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
        message.id,
        message.discussion_id,
        message.role,
        message.content,
        message.created_at,
        message.status,
        message.request_id,
      );
  }

  private findMessageById(
    projectId: string,
    discussionId: string,
    messageId: string,
  ): PersistedDiscussionMessage | undefined {
    const row = this.database
      .prepare(
        `
          SELECT message.*
          FROM discussion_messages AS message
          INNER JOIN discussions AS discussion
            ON discussion.id = message.discussion_id
          WHERE
            discussion.project_id = ?
            AND discussion.id = ?
            AND discussion.deleted_at IS NULL
            AND message.id = ?
        `,
      )
      .get(projectId, discussionId, messageId) as unknown as
      DiscussionMessageRow | undefined;

    return row ? this.toMessage(row) : undefined;
  }

  private toDiscussion(row: DiscussionRow): PersistedDiscussion {
    return {
      id: row.id,
      project_id: row.project_id,
      title: row.title,
      frozen_context: JSON.parse(row.frozen_context) as Record<string, unknown>,
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_activity_at: row.last_activity_at,
      deleted_at: row.deleted_at,
    };
  }

  private toMessage(row: DiscussionMessageRow): PersistedDiscussionMessage {
    return {
      id: row.id,
      discussion_id: row.discussion_id,
      role: row.role,
      content: row.content,
      created_at: row.created_at,
      status: row.status,
      request_id: row.request_id,
    };
  }
}

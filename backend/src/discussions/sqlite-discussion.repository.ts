import type { DatabaseSync } from 'node:sqlite';
import { Injectable } from '@nestjs/common';
import type { FrozenContextItem } from '@nuee/shared-types';
import { DatabaseProvider } from '../database/database.provider';
import { DiscussionContextIntegrityError } from './discussion.types';
import type {
  DiscussionMessageRepository,
  DiscussionMessageStatus,
  DiscussionRepository,
  PersistedDiscussion,
  PersistedDiscussionMessage,
  VersionedPersistedDiscussion,
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
  context_version: unknown;
  expected_context_item_count: unknown;
  creation_idempotency_key: unknown;
  creation_request_fingerprint: unknown;
}

interface DiscussionContextItemRow {
  id: unknown;
  discussion_id: unknown;
  source_kind: unknown;
  source_id: unknown;
  source_title: unknown;
  frozen_content: unknown;
  created_at: unknown;
  display_order: unknown;
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

      if (discussion.context_version !== null) {
        if (
          discussion.frozen_context.version !== discussion.context_version ||
          !this.isNonEmptyString(discussion.creation_idempotency_key) ||
          discussion.creation_idempotency_key.length > 200 ||
          !this.isRequestFingerprint(discussion.creation_request_fingerprint)
        ) {
          throw new DiscussionContextIntegrityError(discussion.id);
        }

        const contextItems = this.validateContextItems(
          discussion.frozen_context.items,
          discussion.id,
          discussion.project_id,
          discussion.expected_context_item_count,
        );
        this.insertContextItems(discussion.id, contextItems);
        this.finalizeContextMetadata(discussion);
      }

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

  findByProjectAndCreationIdempotencyKey(
    projectId: string,
    idempotencyKey: string,
  ): PersistedDiscussion | undefined {
    const row = this.database
      .prepare(
        `
          SELECT *
          FROM discussions
          WHERE
            project_id = ?
            AND creation_idempotency_key = ?
            AND deleted_at IS NULL
        `,
      )
      .get(projectId, idempotencyKey) as unknown as DiscussionRow | undefined;

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
          WHERE project_id = ?
            AND id = ?
            AND title IS NULL
            AND deleted_at IS NULL
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
            deleted_at,
            context_version,
            expected_context_item_count,
            creation_idempotency_key,
            creation_request_fingerprint
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        null,
        null,
        null,
        null,
      );
  }

  private insertContextItems(
    discussionId: string,
    items: readonly FrozenContextItem[],
  ): void {
    const insert = this.database.prepare(
      `
        INSERT INTO discussion_context_items (
          id,
          discussion_id,
          source_kind,
          source_id,
          source_title,
          frozen_content,
          created_at,
          display_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    for (const item of items) {
      insert.run(
        item.id,
        discussionId,
        item.source_kind,
        item.source_id,
        item.source_title,
        item.frozen_content,
        item.created_at,
        item.display_order,
      );
    }
  }

  private finalizeContextMetadata(
    discussion: VersionedPersistedDiscussion,
  ): void {
    const result = this.database
      .prepare(
        `
          UPDATE discussions
          SET
            context_version = ?,
            expected_context_item_count = ?,
            creation_idempotency_key = ?,
            creation_request_fingerprint = ?
          WHERE id = ? AND context_version IS NULL
        `,
      )
      .run(
        discussion.context_version,
        discussion.expected_context_item_count,
        discussion.creation_idempotency_key,
        discussion.creation_request_fingerprint,
        discussion.id,
      );

    if (result.changes !== 1) {
      throw new DiscussionContextIntegrityError(discussion.id);
    }
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
    if (row.context_version === null) {
      if (
        row.expected_context_item_count !== null ||
        row.creation_idempotency_key !== null ||
        row.creation_request_fingerprint !== null
      ) {
        throw new DiscussionContextIntegrityError(row.id);
      }

      return {
        ...this.toDiscussionBase(row),
        frozen_context: this.parseLegacyFrozenContext(
          row.frozen_context,
          row.id,
        ),
        context_version: null,
        expected_context_item_count: null,
        creation_idempotency_key: null,
        creation_request_fingerprint: null,
      };
    }

    if (
      row.context_version !== 1 ||
      !this.isPositiveInteger(row.expected_context_item_count) ||
      !this.isNonEmptyString(row.creation_idempotency_key) ||
      row.creation_idempotency_key.length > 200 ||
      !this.isRequestFingerprint(row.creation_request_fingerprint)
    ) {
      throw new DiscussionContextIntegrityError(row.id);
    }

    const expectedItemCount = row.expected_context_item_count;
    const items = this.loadContextItems(
      row.id,
      row.project_id,
      expectedItemCount,
    );

    return {
      ...this.toDiscussionBase(row),
      frozen_context: {
        version: 1,
        items,
      },
      context_version: 1,
      expected_context_item_count: expectedItemCount,
      creation_idempotency_key: row.creation_idempotency_key,
      creation_request_fingerprint: row.creation_request_fingerprint,
    };
  }

  private toDiscussionBase(row: DiscussionRow) {
    return {
      id: row.id,
      project_id: row.project_id,
      title: row.title,
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_activity_at: row.last_activity_at,
      deleted_at: row.deleted_at,
    };
  }

  private parseLegacyFrozenContext(
    serialized: string,
    discussionId: string,
  ): Record<string, unknown> {
    try {
      const value = JSON.parse(serialized) as unknown;

      if (!this.isRecord(value)) {
        throw new DiscussionContextIntegrityError(discussionId);
      }

      return value;
    } catch (error) {
      if (error instanceof DiscussionContextIntegrityError) {
        throw error;
      }

      throw new DiscussionContextIntegrityError(discussionId);
    }
  }

  private loadContextItems(
    discussionId: string,
    projectId: string,
    expectedItemCount: number,
  ): FrozenContextItem[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            id,
            discussion_id,
            source_kind,
            source_id,
            source_title,
            frozen_content,
            created_at,
            display_order
          FROM discussion_context_items
          WHERE discussion_id = ?
          ORDER BY display_order ASC
        `,
      )
      .all(discussionId) as unknown as DiscussionContextItemRow[];

    return this.validateContextItems(
      rows,
      discussionId,
      projectId,
      expectedItemCount,
    );
  }

  private validateContextItems(
    values: readonly unknown[],
    discussionId: string,
    projectId: string,
    expectedItemCount: number,
  ): FrozenContextItem[] {
    if (values.length !== expectedItemCount || expectedItemCount <= 0) {
      throw new DiscussionContextIntegrityError(discussionId);
    }

    const itemIds = new Set<string>();
    const sources = new Set<string>();
    const items: FrozenContextItem[] = [];
    let projectDescriptionCount = 0;

    values.forEach((value, index) => {
      if (!this.isRecord(value)) {
        throw new DiscussionContextIntegrityError(discussionId);
      }

      const {
        id,
        source_kind: sourceKind,
        source_id: sourceId,
        source_title: sourceTitle,
        frozen_content: frozenContent,
        created_at: createdAt,
        display_order: displayOrder,
      } = value;
      const storedDiscussionId = value.discussion_id;
      const isSupportedKind =
        sourceKind === 'project_description' ||
        sourceKind === 'bubble' ||
        sourceKind === 'document';
      const sourceKey = `${String(sourceKind)}:${String(sourceId)}`;

      if (
        !this.isNonEmptyString(id) ||
        itemIds.has(id) ||
        (storedDiscussionId !== undefined &&
          storedDiscussionId !== discussionId) ||
        !isSupportedKind ||
        !this.isNonEmptyString(sourceId) ||
        !this.isNonEmptyString(sourceTitle) ||
        typeof frozenContent !== 'string' ||
        (sourceKind !== 'project_description' &&
          frozenContent.trim().length === 0) ||
        !this.isIsoTimestamp(createdAt) ||
        !Number.isInteger(displayOrder) ||
        displayOrder !== index ||
        sources.has(sourceKey)
      ) {
        throw new DiscussionContextIntegrityError(discussionId);
      }

      if (sourceKind === 'project_description') {
        projectDescriptionCount += 1;

        if (index !== 0 || sourceId !== projectId) {
          throw new DiscussionContextIntegrityError(discussionId);
        }
      }

      itemIds.add(id);
      sources.add(sourceKey);
      items.push({
        id,
        source_kind: sourceKind,
        source_id: sourceId,
        source_title: sourceTitle,
        frozen_content: frozenContent,
        created_at: createdAt,
        display_order: displayOrder,
      });
    });

    if (projectDescriptionCount !== 1) {
      throw new DiscussionContextIntegrityError(discussionId);
    }

    return items;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
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

  private isRequestFingerprint(value: unknown): value is string {
    return this.isNonEmptyString(value) && value.length <= 200;
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

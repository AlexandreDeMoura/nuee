import type { DatabaseSync } from 'node:sqlite';
import { Injectable } from '@nestjs/common';
import type { FrozenContextItem, MessageCitation } from '@nuee/shared-types';
import { DatabaseProvider } from '../database/database.provider';
import {
  DiscussionContextIntegrityError,
  DiscussionMessageIntegrityError,
} from './discussion.types';
import type {
  DiscussionExtractionFrozenContextSource,
  DiscussionExtractionMessageSource,
  DiscussionExtractionSourceReader,
  DiscussionExtractionSourceReadResult,
  DiscussionExtractionSourceSelection,
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
  web_search: unknown;
  web_search_used: unknown;
  citations: unknown;
}

interface ExtractionDiscussionRow {
  id: unknown;
  project_id: unknown;
  title: unknown;
}

interface ExtractionMessageRow extends DiscussionMessageRow {
  project_id: unknown;
  discussion_deleted_at: unknown;
}

interface ExtractionContextItemRow extends DiscussionContextItemRow {
  project_id: unknown;
  discussion_deleted_at: unknown;
}

const MAX_CITATIONS_SERIALIZED_BYTES = 64 * 1024;

@Injectable()
export class SqliteDiscussionRepository
  implements
    DiscussionRepository,
    DiscussionMessageRepository,
    DiscussionExtractionSourceReader
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

  readExtractionSources(
    projectId: string,
    discussionId: string,
    selection: DiscussionExtractionSourceSelection,
  ): DiscussionExtractionSourceReadResult {
    const discussion = this.database
      .prepare(
        `
          SELECT id, project_id, title
          FROM discussions
          WHERE
            id = ?
            AND project_id = ?
            AND deleted_at IS NULL
        `,
      )
      .get(discussionId, projectId) as unknown as
      ExtractionDiscussionRow | undefined;

    if (!discussion) {
      return { status: 'discussion_not_found' };
    }

    const issues: Extract<
      DiscussionExtractionSourceReadResult,
      { status: 'invalid_sources' }
    >['issues'] = [];
    const messages = this.readSelectedExtractionMessages(
      projectId,
      discussionId,
      selection.message_ids,
      issues,
    );
    const frozenContextItems = this.readSelectedExtractionContextItems(
      projectId,
      discussionId,
      selection.frozen_context_item_ids,
      issues,
    );

    if (issues.length > 0) {
      return { status: 'invalid_sources', issues };
    }

    return {
      status: 'available',
      discussion_title:
        typeof discussion.title === 'string' &&
        discussion.title.trim().length > 0
          ? discussion.title
          : 'New discussion',
      messages,
      frozen_context_items: frozenContextItems,
    };
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
            request_id,
            web_search,
            web_search_used,
            citations
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        message.role === 'user' && message.web_search === true ? 1 : 0,
        message.role === 'assistant' && message.web_search_used === true
          ? 1
          : null,
        this.serializeCitations(message),
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

  private readSelectedExtractionMessages(
    projectId: string,
    discussionId: string,
    messageIds: readonly string[],
    issues: Extract<
      DiscussionExtractionSourceReadResult,
      { status: 'invalid_sources' }
    >['issues'],
  ): DiscussionExtractionMessageSource[] {
    const findMessage = this.database.prepare(
      `
        SELECT
          message.*,
          discussion.project_id,
          discussion.deleted_at AS discussion_deleted_at
        FROM discussion_messages AS message
        INNER JOIN discussions AS discussion
          ON discussion.id = message.discussion_id
        WHERE message.id = ?
      `,
    );
    const messages: DiscussionExtractionMessageSource[] = [];

    for (const messageId of messageIds) {
      const row = findMessage.get(messageId) as unknown as
        ExtractionMessageRow | undefined;

      if (!row) {
        issues.push({
          source_kind: 'message',
          source_id: messageId,
          reason: 'missing',
        });
        continue;
      }

      const reason =
        row.project_id !== projectId
          ? 'cross_project'
          : row.discussion_id !== discussionId
            ? 'cross_discussion'
            : row.discussion_deleted_at !== null || row.status !== 'completed'
              ? 'inaccessible'
              : undefined;

      if (reason) {
        issues.push({
          source_kind: 'message',
          source_id: messageId,
          reason,
        });
        continue;
      }

      messages.push({
        id: row.id,
        role: row.role,
        content: row.content,
        created_at: row.created_at,
      });
    }

    return messages.sort(
      (first, second) =>
        first.created_at.localeCompare(second.created_at) ||
        first.id.localeCompare(second.id),
    );
  }

  private readSelectedExtractionContextItems(
    projectId: string,
    discussionId: string,
    contextItemIds: readonly string[],
    issues: Extract<
      DiscussionExtractionSourceReadResult,
      { status: 'invalid_sources' }
    >['issues'],
  ): DiscussionExtractionFrozenContextSource[] {
    const findContextItem = this.database.prepare(
      `
        SELECT
          item.*,
          discussion.project_id,
          discussion.deleted_at AS discussion_deleted_at
        FROM discussion_context_items AS item
        INNER JOIN discussions AS discussion
          ON discussion.id = item.discussion_id
        WHERE item.id = ?
      `,
    );
    const contextItems: DiscussionExtractionFrozenContextSource[] = [];

    for (const contextItemId of contextItemIds) {
      const row = findContextItem.get(contextItemId) as unknown as
        ExtractionContextItemRow | undefined;

      if (!row) {
        issues.push({
          source_kind: 'frozen_context',
          source_id: contextItemId,
          reason: 'missing',
        });
        continue;
      }

      const reason =
        row.project_id !== projectId
          ? 'cross_project'
          : row.discussion_id !== discussionId
            ? 'cross_discussion'
            : row.discussion_deleted_at !== null
              ? 'inaccessible'
              : undefined;

      if (reason) {
        issues.push({
          source_kind: 'frozen_context',
          source_id: contextItemId,
          reason,
        });
        continue;
      }

      contextItems.push(this.validateExtractionContextItem(row, discussionId));
    }

    return contextItems.sort(
      (first, second) =>
        first.display_order - second.display_order ||
        first.id.localeCompare(second.id),
    );
  }

  private validateExtractionContextItem(
    row: ExtractionContextItemRow,
    discussionId: string,
  ): DiscussionExtractionFrozenContextSource {
    const {
      id,
      source_kind: sourceKind,
      source_title: sourceTitle,
      frozen_content: frozenContent,
      created_at: createdAt,
      display_order: displayOrder,
    } = row;

    if (
      !this.isNonEmptyString(id) ||
      (sourceKind !== 'project_description' &&
        sourceKind !== 'bubble' &&
        sourceKind !== 'document') ||
      !this.isNonEmptyString(sourceTitle) ||
      typeof frozenContent !== 'string' ||
      !this.isIsoTimestamp(createdAt) ||
      !Number.isInteger(displayOrder) ||
      (displayOrder as number) < 0
    ) {
      throw new DiscussionContextIntegrityError(discussionId);
    }

    return {
      id,
      source_kind: sourceKind,
      source_title: sourceTitle,
      frozen_content: frozenContent,
      created_at: createdAt,
      display_order: displayOrder as number,
    };
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
    const baseMessage: PersistedDiscussionMessage = {
      id: row.id,
      discussion_id: row.discussion_id,
      role: row.role,
      content: row.content,
      created_at: row.created_at,
      status: row.status,
      request_id: row.request_id,
    };

    if (
      (row.web_search !== 0 && row.web_search !== 1) ||
      (row.web_search_used !== null && row.web_search_used !== 1)
    ) {
      throw new DiscussionMessageIntegrityError(row.id);
    }

    if (row.role === 'user') {
      if (row.web_search_used !== null || row.citations !== null) {
        throw new DiscussionMessageIntegrityError(row.id);
      }

      return row.web_search === 1
        ? { ...baseMessage, web_search: true }
        : baseMessage;
    }

    if (
      row.web_search !== 0 ||
      (row.web_search_used === null) !== (row.citations === null)
    ) {
      throw new DiscussionMessageIntegrityError(row.id);
    }

    if (row.web_search_used === null) {
      return baseMessage;
    }

    return {
      ...baseMessage,
      web_search_used: true,
      citations: this.parseCitations(row.citations, row.id),
    };
  }

  private serializeCitations(
    message: PersistedDiscussionMessage,
  ): string | null {
    if (message.citations !== undefined) {
      return JSON.stringify(message.citations);
    }

    return message.role === 'assistant' && message.web_search_used === true
      ? '[]'
      : null;
  }

  private parseCitations(
    serialized: unknown,
    messageId: string,
  ): MessageCitation[] {
    if (
      typeof serialized !== 'string' ||
      Buffer.byteLength(serialized, 'utf8') > MAX_CITATIONS_SERIALIZED_BYTES
    ) {
      throw new DiscussionMessageIntegrityError(messageId);
    }

    try {
      const values = JSON.parse(serialized) as unknown;

      if (!Array.isArray(values)) {
        throw new DiscussionMessageIntegrityError(messageId);
      }

      return values.map((value) => {
        if (!this.isRecord(value)) {
          throw new DiscussionMessageIntegrityError(messageId);
        }

        const { url, title, snippet } = value;
        const hasOnlyKnownFields = Object.keys(value).every((key) =>
          ['url', 'title', 'snippet'].includes(key),
        );

        if (
          !hasOnlyKnownFields ||
          !this.isNonEmptyString(url) ||
          !this.isNonEmptyString(title) ||
          (snippet !== undefined && typeof snippet !== 'string')
        ) {
          throw new DiscussionMessageIntegrityError(messageId);
        }

        return {
          url,
          title,
          ...(snippet === undefined ? {} : { snippet }),
        };
      });
    } catch (error) {
      if (error instanceof DiscussionMessageIntegrityError) {
        throw error;
      }

      throw new DiscussionMessageIntegrityError(messageId);
    }
  }
}

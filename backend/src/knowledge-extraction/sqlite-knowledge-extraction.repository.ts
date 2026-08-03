import type { DatabaseSync } from 'node:sqlite';
import { Injectable } from '@nestjs/common';
import type {
  KnowledgeExtractionDetailLevel,
  KnowledgeExtractionProposal,
} from '@nuee/shared-types';
import { DatabaseProvider } from '../database/database.provider';
import {
  KNOWLEDGE_PROPOSAL_CONTENT_MAX_LENGTH,
  KNOWLEDGE_PROPOSAL_SUMMARY_MAX_LENGTH,
  KNOWLEDGE_PROPOSAL_TITLE_MAX_LENGTH,
} from './knowledge-extraction.prompt';
import {
  KNOWLEDGE_EXTRACTION_INSTRUCTIONS_MAX_LENGTH,
  KnowledgeExtractionIntegrityError,
  type KnowledgeExtractionAttempt,
  type KnowledgeExtractionAttemptStatus,
  type KnowledgeExtractionFrozenContextSnapshot,
  type KnowledgeExtractionMessageSnapshot,
  type KnowledgeExtractionRepository,
  type KnowledgeExtractionResolutionKind,
  type KnowledgeExtractionSourceSnapshotV1,
} from './knowledge-extraction.types';

interface KnowledgeExtractionAttemptRow {
  id: unknown;
  project_id: unknown;
  discussion_id: unknown;
  idempotency_key: unknown;
  request_fingerprint: unknown;
  source_snapshot: unknown;
  instructions: unknown;
  detail_level: unknown;
  proposal: unknown;
  status: unknown;
  resolution_fingerprint: unknown;
  resolution_kind: unknown;
  resulting_bubble_id: unknown;
  retry_count: unknown;
  created_at: unknown;
  updated_at: unknown;
  expires_at: unknown;
}

@Injectable()
export class SqliteKnowledgeExtractionRepository implements KnowledgeExtractionRepository {
  private readonly database: DatabaseSync;

  constructor(databaseProvider: DatabaseProvider) {
    this.database = databaseProvider.connection;
  }

  create(attempt: KnowledgeExtractionAttempt): KnowledgeExtractionAttempt {
    const sourceSnapshot = JSON.stringify(attempt.source_snapshot);
    const proposal =
      attempt.proposal === null ? null : JSON.stringify(attempt.proposal);
    const validated = this.toAttempt({
      ...attempt,
      source_snapshot: sourceSnapshot,
      proposal,
    });

    this.database
      .prepare(
        `
          INSERT INTO knowledge_extraction_attempts (
            id,
            project_id,
            discussion_id,
            idempotency_key,
            request_fingerprint,
            source_snapshot,
            instructions,
            detail_level,
            proposal,
            status,
            resolution_fingerprint,
            resolution_kind,
            resulting_bubble_id,
            retry_count,
            created_at,
            updated_at,
            expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        validated.id,
        validated.project_id,
        validated.discussion_id,
        validated.idempotency_key,
        validated.request_fingerprint,
        sourceSnapshot,
        validated.instructions,
        validated.detail_level,
        proposal,
        validated.status,
        validated.resolution_fingerprint,
        validated.resolution_kind,
        validated.resulting_bubble_id,
        validated.retry_count,
        validated.created_at,
        validated.updated_at,
        validated.expires_at,
      );

    return validated;
  }

  findByProjectDiscussionAndId(
    projectId: string,
    discussionId: string,
    extractionId: string,
  ): KnowledgeExtractionAttempt | undefined {
    const row = this.database
      .prepare(
        `
          SELECT *
          FROM knowledge_extraction_attempts
          WHERE project_id = ? AND discussion_id = ? AND id = ?
        `,
      )
      .get(projectId, discussionId, extractionId) as unknown as
      KnowledgeExtractionAttemptRow | undefined;

    return row ? this.toAttempt(row) : undefined;
  }

  findByProjectDiscussionAndIdempotencyKey(
    projectId: string,
    discussionId: string,
    idempotencyKey: string,
  ): KnowledgeExtractionAttempt | undefined {
    const row = this.database
      .prepare(
        `
          SELECT *
          FROM knowledge_extraction_attempts
          WHERE
            project_id = ?
            AND discussion_id = ?
            AND idempotency_key = ?
        `,
      )
      .get(projectId, discussionId, idempotencyKey) as unknown as
      KnowledgeExtractionAttemptRow | undefined;

    return row ? this.toAttempt(row) : undefined;
  }

  markGeneratingForRetry(
    projectId: string,
    discussionId: string,
    extractionId: string,
    updatedAt: string,
  ): KnowledgeExtractionAttempt | undefined {
    const result = this.database
      .prepare(
        `
          UPDATE knowledge_extraction_attempts
          SET
            status = 'generating',
            retry_count = retry_count + 1,
            updated_at = ?
          WHERE
            project_id = ?
            AND discussion_id = ?
            AND id = ?
            AND status IN ('generating', 'failed')
            AND proposal IS NULL
        `,
      )
      .run(updatedAt, projectId, discussionId, extractionId);

    return result.changes === 0
      ? undefined
      : this.findByProjectDiscussionAndId(
          projectId,
          discussionId,
          extractionId,
        );
  }

  saveProposal(
    projectId: string,
    discussionId: string,
    extractionId: string,
    proposal: KnowledgeExtractionProposal,
    updatedAt: string,
  ): KnowledgeExtractionAttempt | undefined {
    const serializedProposal = JSON.stringify(proposal);
    const result = this.database
      .prepare(
        `
          UPDATE knowledge_extraction_attempts
          SET
            proposal = ?,
            status = 'ready',
            updated_at = ?
          WHERE
            project_id = ?
            AND discussion_id = ?
            AND id = ?
            AND status = 'generating'
            AND proposal IS NULL
        `,
      )
      .run(
        serializedProposal,
        updatedAt,
        projectId,
        discussionId,
        extractionId,
      );

    return result.changes === 0
      ? undefined
      : this.findByProjectDiscussionAndId(
          projectId,
          discussionId,
          extractionId,
        );
  }

  markGenerationFailed(
    projectId: string,
    discussionId: string,
    extractionId: string,
    updatedAt: string,
  ): KnowledgeExtractionAttempt | undefined {
    const result = this.database
      .prepare(
        `
          UPDATE knowledge_extraction_attempts
          SET
            status = 'failed',
            updated_at = ?
          WHERE
            project_id = ?
            AND discussion_id = ?
            AND id = ?
            AND status = 'generating'
            AND proposal IS NULL
        `,
      )
      .run(updatedAt, projectId, discussionId, extractionId);

    return result.changes === 0
      ? undefined
      : this.findByProjectDiscussionAndId(
          projectId,
          discussionId,
          extractionId,
        );
  }

  markResolved(
    projectId: string,
    discussionId: string,
    extractionId: string,
    resolution: {
      fingerprint: string;
      kind: KnowledgeExtractionResolutionKind;
      resulting_bubble_id: string | null;
      updated_at: string;
    },
  ): KnowledgeExtractionAttempt | undefined {
    const result = this.database
      .prepare(
        `
          UPDATE knowledge_extraction_attempts
          SET
            status = 'resolved',
            resolution_fingerprint = ?,
            resolution_kind = ?,
            resulting_bubble_id = ?,
            updated_at = ?
          WHERE
            project_id = ?
            AND discussion_id = ?
            AND id = ?
            AND status = 'ready'
            AND proposal IS NOT NULL
            AND resolution_fingerprint IS NULL
            AND resolution_kind IS NULL
            AND resulting_bubble_id IS NULL
        `,
      )
      .run(
        resolution.fingerprint,
        resolution.kind,
        resolution.resulting_bubble_id,
        resolution.updated_at,
        projectId,
        discussionId,
        extractionId,
      );

    return result.changes === 0
      ? undefined
      : this.findByProjectDiscussionAndId(
          projectId,
          discussionId,
          extractionId,
        );
  }

  markDiscarded(
    projectId: string,
    discussionId: string,
    extractionId: string,
    updatedAt: string,
  ): KnowledgeExtractionAttempt | undefined {
    const result = this.database
      .prepare(
        `
          UPDATE knowledge_extraction_attempts
          SET
            proposal = NULL,
            status = 'discarded',
            updated_at = ?
          WHERE
            project_id = ?
            AND discussion_id = ?
            AND id = ?
            AND status IN ('generating', 'ready', 'failed')
            AND resolution_fingerprint IS NULL
            AND resolution_kind IS NULL
            AND resulting_bubble_id IS NULL
        `,
      )
      .run(updatedAt, projectId, discussionId, extractionId);

    return result.changes === 0
      ? undefined
      : this.findByProjectDiscussionAndId(
          projectId,
          discussionId,
          extractionId,
        );
  }

  private toAttempt(
    row: KnowledgeExtractionAttemptRow,
  ): KnowledgeExtractionAttempt {
    const extractionId = this.isNonEmptyString(row.id) ? row.id : 'unknown';
    const proposal = this.parseNullableJsonObject(row.proposal, extractionId);
    const status = this.attemptStatus(row.status, extractionId);
    const resolutionKind = this.resolutionKind(
      row.resolution_kind,
      extractionId,
    );

    if (
      !this.isNonEmptyString(row.id) ||
      !this.isNonEmptyString(row.project_id) ||
      !this.isNonEmptyString(row.discussion_id) ||
      !this.isNonEmptyString(row.idempotency_key) ||
      row.idempotency_key.length > 200 ||
      !this.isFingerprint(row.request_fingerprint) ||
      !this.isNullableInstructions(row.instructions) ||
      !this.isDetailLevel(row.detail_level) ||
      !Number.isInteger(row.retry_count) ||
      (row.retry_count as number) < 0 ||
      !this.isIsoTimestamp(row.created_at) ||
      !this.isIsoTimestamp(row.updated_at) ||
      !this.isIsoTimestamp(row.expires_at) ||
      row.updated_at < row.created_at ||
      row.expires_at <= row.created_at ||
      !this.isNullableFingerprint(row.resolution_fingerprint) ||
      !this.isNullableNonEmptyString(row.resulting_bubble_id)
    ) {
      throw new KnowledgeExtractionIntegrityError(extractionId);
    }

    const sourceSnapshot = this.parseSourceSnapshot(
      row.source_snapshot,
      extractionId,
    );

    if (
      sourceSnapshot.project_id !== row.project_id ||
      sourceSnapshot.discussion_id !== row.discussion_id ||
      sourceSnapshot.requested_at !== row.created_at ||
      ((status === 'generating' || status === 'failed') && proposal !== null) ||
      ((status === 'ready' || status === 'resolved') && proposal === null) ||
      (status !== 'resolved' &&
        (row.resolution_fingerprint !== null ||
          resolutionKind !== null ||
          row.resulting_bubble_id !== null)) ||
      (status === 'resolved' &&
        (row.resolution_fingerprint === null ||
          resolutionKind === null ||
          (resolutionKind === 'reject'
            ? row.resulting_bubble_id !== null
            : row.resulting_bubble_id === null)))
    ) {
      throw new KnowledgeExtractionIntegrityError(extractionId);
    }

    return {
      id: row.id,
      project_id: row.project_id,
      discussion_id: row.discussion_id,
      idempotency_key: row.idempotency_key,
      request_fingerprint: row.request_fingerprint,
      source_snapshot: sourceSnapshot,
      instructions: row.instructions,
      detail_level: row.detail_level,
      proposal,
      status,
      resolution_fingerprint: row.resolution_fingerprint,
      resolution_kind: resolutionKind,
      resulting_bubble_id: row.resulting_bubble_id,
      retry_count: row.retry_count as number,
      created_at: row.created_at,
      updated_at: row.updated_at,
      expires_at: row.expires_at,
    };
  }

  private isNullableInstructions(value: unknown): value is string | null {
    return (
      value === null ||
      (typeof value === 'string' &&
        value.length > 0 &&
        value.length <= KNOWLEDGE_EXTRACTION_INSTRUCTIONS_MAX_LENGTH &&
        value === value.trim())
    );
  }

  private isDetailLevel(
    value: unknown,
  ): value is KnowledgeExtractionDetailLevel {
    return value === 'tight' || value === 'standard' || value === 'detailed';
  }

  private parseSourceSnapshot(
    serialized: unknown,
    extractionId: string,
  ): KnowledgeExtractionSourceSnapshotV1 {
    if (typeof serialized !== 'string') {
      throw new KnowledgeExtractionIntegrityError(extractionId);
    }

    let value: unknown;

    try {
      value = JSON.parse(serialized) as unknown;
    } catch {
      throw new KnowledgeExtractionIntegrityError(extractionId);
    }

    if (
      !this.isRecord(value) ||
      !this.hasExactKeys(value, [
        'version',
        'project_id',
        'discussion_id',
        'discussion_title',
        'requested_at',
        'message_selection_kind',
        'messages',
        'frozen_context_items',
      ]) ||
      value.version !== 1 ||
      !this.isNonEmptyString(value.project_id) ||
      !this.isNonEmptyString(value.discussion_id) ||
      !this.isNonEmptyString(value.discussion_title) ||
      !this.isIsoTimestamp(value.requested_at) ||
      (value.message_selection_kind !== 'selected' &&
        value.message_selection_kind !== 'whole_discussion') ||
      !Array.isArray(value.messages) ||
      !Array.isArray(value.frozen_context_items) ||
      value.messages.length + value.frozen_context_items.length === 0 ||
      value.messages.length + value.frozen_context_items.length > 100
    ) {
      throw new KnowledgeExtractionIntegrityError(extractionId);
    }

    const messageIds = new Set<string>();
    const messages = value.messages.map((message, index) =>
      this.messageSnapshot(message, index, messageIds, extractionId),
    );
    const contextItemIds = new Set<string>();
    const frozenContextItems = value.frozen_context_items.map((item) =>
      this.contextSnapshot(item, contextItemIds, extractionId),
    );

    for (let index = 1; index < messages.length; index += 1) {
      const previous = messages[index - 1];
      const current = messages[index];

      if (
        previous.created_at > current.created_at ||
        (previous.created_at === current.created_at &&
          previous.source_id >= current.source_id)
      ) {
        throw new KnowledgeExtractionIntegrityError(extractionId);
      }
    }

    for (let index = 1; index < frozenContextItems.length; index += 1) {
      const previous = frozenContextItems[index - 1];
      const current = frozenContextItems[index];

      if (
        previous.display_order > current.display_order ||
        (previous.display_order === current.display_order &&
          previous.source_id >= current.source_id)
      ) {
        throw new KnowledgeExtractionIntegrityError(extractionId);
      }
    }

    return {
      version: 1,
      project_id: value.project_id,
      discussion_id: value.discussion_id,
      discussion_title: value.discussion_title,
      requested_at: value.requested_at,
      message_selection_kind: value.message_selection_kind,
      messages,
      frozen_context_items: frozenContextItems,
    };
  }

  private messageSnapshot(
    value: unknown,
    index: number,
    ids: Set<string>,
    extractionId: string,
  ): KnowledgeExtractionMessageSnapshot {
    if (
      !this.isRecord(value) ||
      !this.hasExactKeys(value, [
        'source_kind',
        'source_id',
        'role',
        'content',
        'created_at',
        'discussion_order',
      ]) ||
      value.source_kind !== 'message' ||
      !this.isNonEmptyString(value.source_id) ||
      ids.has(value.source_id) ||
      (value.role !== 'user' && value.role !== 'assistant') ||
      !this.isNonEmptyString(value.content) ||
      !this.isIsoTimestamp(value.created_at) ||
      value.discussion_order !== index
    ) {
      throw new KnowledgeExtractionIntegrityError(extractionId);
    }

    ids.add(value.source_id);
    return {
      source_kind: 'message',
      source_id: value.source_id,
      role: value.role,
      content: value.content,
      created_at: value.created_at,
      discussion_order: value.discussion_order,
    };
  }

  private contextSnapshot(
    value: unknown,
    ids: Set<string>,
    extractionId: string,
  ): KnowledgeExtractionFrozenContextSnapshot {
    if (
      !this.isRecord(value) ||
      !this.hasExactKeys(value, [
        'source_kind',
        'source_id',
        'context_source_kind',
        'source_title',
        'content',
        'created_at',
        'display_order',
      ]) ||
      value.source_kind !== 'frozen_context' ||
      !this.isNonEmptyString(value.source_id) ||
      ids.has(value.source_id) ||
      (value.context_source_kind !== 'project_description' &&
        value.context_source_kind !== 'bubble' &&
        value.context_source_kind !== 'document') ||
      !this.isNonEmptyString(value.source_title) ||
      typeof value.content !== 'string' ||
      !this.isIsoTimestamp(value.created_at) ||
      !Number.isInteger(value.display_order) ||
      (value.display_order as number) < 0
    ) {
      throw new KnowledgeExtractionIntegrityError(extractionId);
    }

    ids.add(value.source_id);
    return {
      source_kind: 'frozen_context',
      source_id: value.source_id,
      context_source_kind: value.context_source_kind,
      source_title: value.source_title,
      content: value.content,
      created_at: value.created_at,
      display_order: value.display_order as number,
    };
  }

  private parseNullableJsonObject(
    serialized: unknown,
    extractionId: string,
  ): KnowledgeExtractionProposal | null {
    if (serialized === null) {
      return null;
    }

    if (typeof serialized !== 'string') {
      throw new KnowledgeExtractionIntegrityError(extractionId);
    }

    try {
      const value = JSON.parse(serialized) as unknown;

      if (
        !this.isRecord(value) ||
        !this.hasExactKeys(value, ['title', 'summary', 'content']) ||
        !this.isNormalizedText(
          value.title,
          KNOWLEDGE_PROPOSAL_TITLE_MAX_LENGTH,
          true,
        ) ||
        !this.isNormalizedText(
          value.summary,
          KNOWLEDGE_PROPOSAL_SUMMARY_MAX_LENGTH,
          true,
        ) ||
        !this.isNormalizedText(
          value.content,
          KNOWLEDGE_PROPOSAL_CONTENT_MAX_LENGTH,
          false,
        )
      ) {
        throw new KnowledgeExtractionIntegrityError(extractionId);
      }

      return {
        title: value.title,
        summary: value.summary,
        content: value.content,
      };
    } catch (error) {
      if (error instanceof KnowledgeExtractionIntegrityError) {
        throw error;
      }

      throw new KnowledgeExtractionIntegrityError(extractionId);
    }
  }

  private attemptStatus(
    value: unknown,
    extractionId: string,
  ): KnowledgeExtractionAttemptStatus {
    if (
      value !== 'generating' &&
      value !== 'ready' &&
      value !== 'failed' &&
      value !== 'resolved' &&
      value !== 'discarded'
    ) {
      throw new KnowledgeExtractionIntegrityError(extractionId);
    }

    return value;
  }

  private resolutionKind(
    value: unknown,
    extractionId: string,
  ): KnowledgeExtractionResolutionKind | null {
    if (value === null) {
      return null;
    }

    if (
      value !== 'new_bubble' &&
      value !== 'update_bubble' &&
      value !== 'reject'
    ) {
      throw new KnowledgeExtractionIntegrityError(extractionId);
    }

    return value;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private hasExactKeys(
    value: Record<string, unknown>,
    keys: readonly string[],
  ): boolean {
    const actualKeys = Object.keys(value);

    return (
      actualKeys.length === keys.length &&
      actualKeys.every((key) => keys.includes(key))
    );
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private isNormalizedText(
    value: unknown,
    maximumLength: number,
    singleLine: boolean,
  ): value is string {
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= maximumLength &&
      value === value.trim() &&
      (!singleLine || !/[\r\n]|\s{2,}/.test(value))
    );
  }

  private isNullableNonEmptyString(value: unknown): value is string | null {
    return value === null || this.isNonEmptyString(value);
  }

  private isFingerprint(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  }

  private isNullableFingerprint(value: unknown): value is string | null {
    return value === null || this.isFingerprint(value);
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

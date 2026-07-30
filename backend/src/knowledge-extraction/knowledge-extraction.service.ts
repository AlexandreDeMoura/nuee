import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  DISCUSSION_EXTRACTION_SOURCE_READER,
  type DiscussionExtractionSourceReader,
} from '../discussions/discussion.types';
import { ProjectsService } from '../projects/projects.service';
import {
  KNOWLEDGE_EXTRACTION_REPOSITORY,
  type KnowledgeExtractionAttempt,
  type KnowledgeExtractionMessageSelection,
  type KnowledgeExtractionRepository,
  type KnowledgeExtractionSourceSnapshotV1,
} from './knowledge-extraction.types';

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const MAX_SOURCE_IDENTIFIER_LENGTH = 200;
const MAX_SOURCE_COUNT = 100;
const ATTEMPT_RETENTION_MILLISECONDS = 24 * 60 * 60 * 1_000;

interface NormalizedSnapshotInput {
  idempotency_key: string;
  message_selection: KnowledgeExtractionMessageSelection;
  frozen_context_item_ids: string[];
}

@Injectable()
export class KnowledgeExtractionService {
  constructor(
    private readonly projects: ProjectsService,
    @Inject(DISCUSSION_EXTRACTION_SOURCE_READER)
    private readonly discussionSources: DiscussionExtractionSourceReader,
    @Inject(KNOWLEDGE_EXTRACTION_REPOSITORY)
    private readonly extractions: KnowledgeExtractionRepository,
  ) {}

  createSourceSnapshot(
    projectId: string,
    discussionId: string,
    input: unknown,
  ): KnowledgeExtractionAttempt {
    this.projects.get(projectId);
    const normalized = this.validateInput(input);
    const requestedAt = new Date().toISOString();
    const sourceResult = this.discussionSources.readExtractionSources(
      projectId,
      discussionId,
      {
        message_selection: normalized.message_selection,
        frozen_context_item_ids: normalized.frozen_context_item_ids,
      },
    );

    if (sourceResult.status === 'discussion_not_found') {
      throw new NotFoundException({
        code: 'DISCUSSION_NOT_FOUND',
        message: `Discussion "${discussionId}" was not found in project "${projectId}".`,
      });
    }

    if (sourceResult.status === 'invalid_sources') {
      throw new UnprocessableEntityException({
        code: 'KNOWLEDGE_EXTRACTION_SOURCE_INVALID',
        message:
          'One or more selected extraction sources are unavailable. Review or remove the affected selections.',
        source_errors: sourceResult.issues,
      });
    }

    const sourceCount =
      sourceResult.messages.length + sourceResult.frozen_context_items.length;

    if (sourceCount === 0) {
      throw this.validationFailed({
        message_selection:
          'Select at least one completed message or frozen context item.',
      });
    }

    if (sourceCount > MAX_SOURCE_COUNT) {
      throw this.validationFailed({
        message_selection: `Select no more than ${MAX_SOURCE_COUNT} sources in one extraction.`,
      });
    }

    const sourceSnapshot: KnowledgeExtractionSourceSnapshotV1 = {
      version: 1,
      project_id: projectId,
      discussion_id: discussionId,
      discussion_title: sourceResult.discussion_title,
      requested_at: requestedAt,
      message_selection_kind: normalized.message_selection.kind,
      messages: sourceResult.messages.map((message, discussionOrder) => ({
        source_kind: 'message',
        source_id: message.id,
        role: message.role,
        content: message.content,
        created_at: message.created_at,
        discussion_order: discussionOrder,
      })),
      frozen_context_items: sourceResult.frozen_context_items.map((item) => ({
        source_kind: 'frozen_context',
        source_id: item.id,
        context_source_kind: item.source_kind,
        source_title: item.source_title,
        content: item.frozen_content,
        created_at: item.created_at,
        display_order: item.display_order,
      })),
    };
    const expiresAt = new Date(
      Date.parse(requestedAt) + ATTEMPT_RETENTION_MILLISECONDS,
    ).toISOString();
    const attempt: KnowledgeExtractionAttempt = {
      id: randomUUID(),
      project_id: projectId,
      discussion_id: discussionId,
      idempotency_key: normalized.idempotency_key,
      request_fingerprint: this.requestFingerprint(normalized),
      source_snapshot: sourceSnapshot,
      proposal: null,
      status: 'generating',
      resolution_fingerprint: null,
      resolution_kind: null,
      resulting_bubble_id: null,
      retry_count: 0,
      created_at: requestedAt,
      updated_at: requestedAt,
      expires_at: expiresAt,
    };

    try {
      return this.extractions.create(attempt);
    } catch {
      throw new ServiceUnavailableException({
        code: 'KNOWLEDGE_EXTRACTION_SNAPSHOT_PERSISTENCE_FAILED',
        message:
          'The extraction source snapshot could not be saved. Retry with the same idempotency key.',
      });
    }
  }

  private validateInput(input: unknown): NormalizedSnapshotInput {
    const fieldErrors: Record<string, string> = {};

    if (!this.isRecord(input)) {
      throw this.validationFailed({
        request_body: 'Request body must be a JSON object.',
      });
    }

    this.rejectUnknownFields(
      input,
      ['idempotency_key', 'message_selection', 'frozen_context_item_ids'],
      fieldErrors,
    );
    const idempotencyKey = this.idempotencyKey(
      input.idempotency_key,
      fieldErrors,
    );
    const messageSelection = this.messageSelection(
      input.message_selection,
      fieldErrors,
    );
    const frozenContextItemIds = this.identifierArray(
      input.frozen_context_item_ids,
      'frozen_context_item_ids',
      fieldErrors,
    );

    if (
      messageSelection?.kind === 'selected' &&
      frozenContextItemIds &&
      messageSelection.message_ids.length + frozenContextItemIds.length >
        MAX_SOURCE_COUNT
    ) {
      fieldErrors.message_selection = `Select no more than ${MAX_SOURCE_COUNT} sources in one extraction.`;
    }

    if (
      messageSelection?.kind === 'selected' &&
      frozenContextItemIds &&
      messageSelection.message_ids.length === 0 &&
      frozenContextItemIds.length === 0
    ) {
      fieldErrors.message_selection =
        'Select at least one completed message or frozen context item.';
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw this.validationFailed(fieldErrors);
    }

    if (!idempotencyKey || !messageSelection || !frozenContextItemIds) {
      throw new Error(
        'Validated knowledge extraction input is unexpectedly missing.',
      );
    }

    return {
      idempotency_key: idempotencyKey,
      message_selection: messageSelection,
      frozen_context_item_ids: frozenContextItemIds,
    };
  }

  private idempotencyKey(
    value: unknown,
    fieldErrors: Record<string, string>,
  ): string | undefined {
    if (typeof value !== 'string' || value.trim().length === 0) {
      fieldErrors.idempotency_key = 'Idempotency key is required.';
      return undefined;
    }

    const normalized = value.trim();

    if (normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      fieldErrors.idempotency_key = `Idempotency key must be ${MAX_IDEMPOTENCY_KEY_LENGTH} characters or fewer.`;
      return undefined;
    }

    return normalized;
  }

  private messageSelection(
    value: unknown,
    fieldErrors: Record<string, string>,
  ): KnowledgeExtractionMessageSelection | undefined {
    if (!this.isRecord(value)) {
      fieldErrors.message_selection = 'Message selection must be an object.';
      return undefined;
    }

    if (value.kind === 'selected') {
      this.rejectUnknownFields(
        value,
        ['kind', 'message_ids'],
        fieldErrors,
        'message_selection.',
      );
      const messageIds = this.identifierArray(
        value.message_ids,
        'message_selection.message_ids',
        fieldErrors,
      );

      return messageIds
        ? { kind: 'selected', message_ids: messageIds }
        : undefined;
    }

    if (value.kind === 'whole_discussion') {
      this.rejectUnknownFields(
        value,
        ['kind'],
        fieldErrors,
        'message_selection.',
      );
      return { kind: 'whole_discussion' };
    }

    fieldErrors['message_selection.kind'] =
      'Message selection kind must be "selected" or "whole_discussion".';
    return undefined;
  }

  private identifierArray(
    value: unknown,
    field: string,
    fieldErrors: Record<string, string>,
  ): string[] | undefined {
    if (!Array.isArray(value)) {
      fieldErrors[field] = 'Must be an array of source identifiers.';
      return undefined;
    }

    if (value.length > MAX_SOURCE_COUNT) {
      fieldErrors[field] = `Select no more than ${MAX_SOURCE_COUNT} sources.`;
      return undefined;
    }

    const identifiers: string[] = [];

    value.forEach((identifier, index) => {
      if (typeof identifier !== 'string' || identifier.trim().length === 0) {
        fieldErrors[`${field}[${index}]`] =
          'Source identifier must be a non-empty string.';
        return;
      }

      const normalized = identifier.trim();

      if (normalized.length > MAX_SOURCE_IDENTIFIER_LENGTH) {
        fieldErrors[`${field}[${index}]`] =
          `Source identifier must be ${MAX_SOURCE_IDENTIFIER_LENGTH} characters or fewer.`;
        return;
      }

      identifiers.push(normalized);
    });

    if (new Set(identifiers).size !== identifiers.length) {
      fieldErrors[field] = 'Source identifiers must not contain duplicates.';
    }

    return identifiers;
  }

  private requestFingerprint(input: NormalizedSnapshotInput): string {
    const canonicalSelection = {
      message_selection:
        input.message_selection.kind === 'selected'
          ? {
              kind: 'selected',
              message_ids: [...input.message_selection.message_ids].sort(),
            }
          : { kind: 'whole_discussion' },
      frozen_context_item_ids: [...input.frozen_context_item_ids].sort(),
    };

    return createHash('sha256')
      .update(JSON.stringify(canonicalSelection))
      .digest('hex');
  }

  private rejectUnknownFields(
    value: Record<string, unknown>,
    allowedFields: readonly string[],
    fieldErrors: Record<string, string>,
    prefix = '',
  ): void {
    for (const field of Object.keys(value)) {
      if (!allowedFields.includes(field)) {
        fieldErrors[`${prefix}${field}`] = 'Unknown field.';
      }
    }
  }

  private validationFailed(
    fieldErrors: Record<string, string>,
  ): BadRequestException {
    return new BadRequestException({
      code: 'KNOWLEDGE_EXTRACTION_VALIDATION_FAILED',
      message: 'Knowledge extraction input is invalid.',
      field_errors: fieldErrors,
    });
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

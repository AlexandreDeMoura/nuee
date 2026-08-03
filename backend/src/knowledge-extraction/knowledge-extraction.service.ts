import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type {
  KnowledgeExtractionProposal,
  KnowledgeExtractionProposalResponse,
} from '@nuee/shared-types';
import { MODEL_CLIENT, type ModelClient } from '../ai/model-client';
import {
  MODEL_INPUT_BUDGET,
  type ModelInputBudget,
} from '../ai/model-input-budget';
import {
  DISCUSSION_EXTRACTION_SOURCE_READER,
  type DiscussionExtractionSourceReader,
} from '../discussions/discussion.types';
import { ProjectsService } from '../projects/projects.service';
import {
  buildKnowledgeExtractionModelInput,
  KNOWLEDGE_PROPOSAL_CONTENT_MAX_LENGTH,
  KNOWLEDGE_PROPOSAL_SUMMARY_MAX_LENGTH,
  KNOWLEDGE_PROPOSAL_TITLE_MAX_LENGTH,
} from './knowledge-extraction.prompt';
import {
  KNOWLEDGE_EXTRACTION_REPOSITORY,
  type KnowledgeExtractionAttempt,
  type KnowledgeExtractionRepository,
  type KnowledgeExtractionSourceSnapshotV1,
} from './knowledge-extraction.types';

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const MAX_SOURCE_IDENTIFIER_LENGTH = 200;
const MAX_SOURCE_COUNT = 100;
const ATTEMPT_RETENTION_MILLISECONDS = 24 * 60 * 60 * 1_000;

interface NormalizedSnapshotInput {
  idempotency_key: string;
  message_ids: string[];
  frozen_context_item_ids: string[];
}

@Injectable()
export class KnowledgeExtractionService {
  private readonly inFlightGenerations = new Map<
    string,
    Promise<KnowledgeExtractionProposalResponse>
  >();

  constructor(
    private readonly projects: ProjectsService,
    @Inject(DISCUSSION_EXTRACTION_SOURCE_READER)
    private readonly discussionSources: DiscussionExtractionSourceReader,
    @Inject(KNOWLEDGE_EXTRACTION_REPOSITORY)
    private readonly extractions: KnowledgeExtractionRepository,
    @Inject(MODEL_CLIENT)
    private readonly modelClient: ModelClient,
    @Inject(MODEL_INPUT_BUDGET)
    private readonly modelInputBudget: ModelInputBudget,
  ) {}

  async generateProposal(
    projectId: string,
    discussionId: string,
    input: unknown,
  ): Promise<KnowledgeExtractionProposalResponse> {
    this.projects.get(projectId);
    const normalized = this.validateInput(input);
    const requestFingerprint = this.requestFingerprint(normalized);
    const existing = this.findByIdempotencyKey(
      projectId,
      discussionId,
      normalized.idempotency_key,
    );

    if (existing) {
      return this.replayOrRetry(existing, requestFingerprint);
    }

    const attempt = this.buildSourceSnapshot(
      projectId,
      discussionId,
      normalized,
      requestFingerprint,
    );
    const modelInput = this.prepareModelInput(attempt.source_snapshot);
    let persisted: KnowledgeExtractionAttempt;

    try {
      persisted = this.extractions.create(attempt);
    } catch {
      const concurrent = this.findByIdempotencyKey(
        projectId,
        discussionId,
        normalized.idempotency_key,
      );

      if (concurrent) {
        return this.replayOrRetry(concurrent, requestFingerprint);
      }

      throw this.snapshotPersistenceFailed();
    }

    return this.startGeneration(persisted, modelInput);
  }

  createSourceSnapshot(
    projectId: string,
    discussionId: string,
    input: unknown,
  ): KnowledgeExtractionAttempt {
    this.projects.get(projectId);
    const normalized = this.validateInput(input);
    const attempt = this.buildSourceSnapshot(
      projectId,
      discussionId,
      normalized,
      this.requestFingerprint(normalized),
    );

    try {
      return this.extractions.create(attempt);
    } catch {
      throw this.snapshotPersistenceFailed();
    }
  }

  private buildSourceSnapshot(
    projectId: string,
    discussionId: string,
    normalized: NormalizedSnapshotInput,
    requestFingerprint: string,
  ): KnowledgeExtractionAttempt {
    const requestedAt = new Date().toISOString();
    const sourceResult = this.discussionSources.readExtractionSources(
      projectId,
      discussionId,
      {
        message_ids: normalized.message_ids,
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
        message_ids:
          'Select at least one completed message or frozen context item.',
      });
    }

    if (sourceCount > MAX_SOURCE_COUNT) {
      throw this.validationFailed({
        message_ids: `Select no more than ${MAX_SOURCE_COUNT} sources in one extraction.`,
      });
    }

    const sourceSnapshot: KnowledgeExtractionSourceSnapshotV1 = {
      version: 1,
      project_id: projectId,
      discussion_id: discussionId,
      discussion_title: sourceResult.discussion_title,
      requested_at: requestedAt,
      message_selection_kind: 'selected',
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
      request_fingerprint: requestFingerprint,
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

    return attempt;
  }

  private replayOrRetry(
    attempt: KnowledgeExtractionAttempt,
    requestFingerprint: string,
  ): Promise<KnowledgeExtractionProposalResponse> {
    if (attempt.request_fingerprint !== requestFingerprint) {
      throw new ConflictException({
        code: 'KNOWLEDGE_EXTRACTION_IDEMPOTENCY_CONFLICT',
        message:
          'The idempotency key has already been used with a different source selection.',
      });
    }

    if (
      (attempt.status === 'ready' || attempt.status === 'resolved') &&
      attempt.proposal
    ) {
      return Promise.resolve(this.toProposalResponse(attempt));
    }

    if (attempt.status === 'discarded') {
      throw new ConflictException({
        code: 'KNOWLEDGE_EXTRACTION_DISCARDED',
        message: 'This extraction attempt has already been discarded.',
      });
    }

    const inFlight = this.inFlightGenerations.get(attempt.id);

    if (inFlight) {
      return inFlight;
    }

    const modelInput = this.prepareModelInput(attempt.source_snapshot);
    let retry: KnowledgeExtractionAttempt | undefined;

    try {
      retry = this.extractions.markGeneratingForRetry(
        attempt.project_id,
        attempt.discussion_id,
        attempt.id,
        new Date().toISOString(),
      );
    } catch {
      throw this.proposalPersistenceFailed();
    }

    if (!retry) {
      const reloaded = this.findByIdempotencyKey(
        attempt.project_id,
        attempt.discussion_id,
        attempt.idempotency_key,
      );

      if (
        reloaded &&
        (reloaded.status === 'ready' || reloaded.status === 'resolved') &&
        reloaded.proposal
      ) {
        return Promise.resolve(this.toProposalResponse(reloaded));
      }

      throw this.proposalPersistenceFailed();
    }

    return this.startGeneration(retry, modelInput);
  }

  private startGeneration(
    attempt: KnowledgeExtractionAttempt,
    modelInput: ReturnType<typeof buildKnowledgeExtractionModelInput>,
  ): Promise<KnowledgeExtractionProposalResponse> {
    const existing = this.inFlightGenerations.get(attempt.id);

    if (existing) {
      return existing;
    }

    const generation = this.runGeneration(attempt, modelInput);
    this.inFlightGenerations.set(attempt.id, generation);
    const clear = () => {
      if (this.inFlightGenerations.get(attempt.id) === generation) {
        this.inFlightGenerations.delete(attempt.id);
      }
    };
    void generation.then(clear, clear);

    return generation;
  }

  private async runGeneration(
    attempt: KnowledgeExtractionAttempt,
    modelInput: ReturnType<typeof buildKnowledgeExtractionModelInput>,
  ): Promise<KnowledgeExtractionProposalResponse> {
    let proposal: KnowledgeExtractionProposal;

    try {
      const generation =
        await this.modelClient.generateStructuredOutput(modelInput);
      proposal = this.normalizeProposal(generation.output);
    } catch {
      try {
        const failed = this.extractions.markGenerationFailed(
          attempt.project_id,
          attempt.discussion_id,
          attempt.id,
          new Date().toISOString(),
        );

        if (!failed) {
          throw new Error('The failed generation state was not persisted.');
        }
      } catch {
        throw this.proposalPersistenceFailed();
      }

      throw new ServiceUnavailableException({
        code: 'KNOWLEDGE_EXTRACTION_GENERATION_FAILED',
        message:
          'The knowledge proposal could not be generated. Retry with the same idempotency key.',
      });
    }

    let ready: KnowledgeExtractionAttempt | undefined;

    try {
      ready = this.extractions.saveProposal(
        attempt.project_id,
        attempt.discussion_id,
        attempt.id,
        proposal,
        new Date().toISOString(),
      );
    } catch {
      throw this.proposalPersistenceFailed();
    }

    if (!ready) {
      throw this.proposalPersistenceFailed();
    }

    return this.toProposalResponse(ready);
  }

  private prepareModelInput(
    snapshot: KnowledgeExtractionSourceSnapshotV1,
  ): ReturnType<typeof buildKnowledgeExtractionModelInput> {
    const input = buildKnowledgeExtractionModelInput(snapshot);
    const budget = this.modelInputBudget.evaluateStructuredOutput(input);

    if (!budget.fits) {
      throw new PayloadTooLargeException({
        code: 'KNOWLEDGE_EXTRACTION_SOURCE_TOO_LARGE',
        message:
          'The selected extraction sources exceed the supported model input budget. Select fewer messages or frozen context items and try again.',
        estimated_input_tokens: budget.estimatedInputTokens,
        available_input_tokens: budget.availableInputTokens,
        input_token_limit: budget.inputTokenLimit,
        reserved_output_tokens: budget.reservedOutputTokens,
        safety_margin_tokens: budget.safetyMarginTokens,
      });
    }

    return input;
  }

  private normalizeProposal(output: unknown): KnowledgeExtractionProposal {
    if (
      !this.isRecord(output) ||
      Object.keys(output).length !== 3 ||
      !Object.keys(output).every((key) =>
        ['title', 'summary', 'content'].includes(key),
      )
    ) {
      throw new Error('The model returned an invalid knowledge proposal.');
    }

    const title = this.normalizedSingleLine(
      output.title,
      KNOWLEDGE_PROPOSAL_TITLE_MAX_LENGTH,
    );
    const summary = this.normalizedSingleLine(
      output.summary,
      KNOWLEDGE_PROPOSAL_SUMMARY_MAX_LENGTH,
    );
    const content =
      typeof output.content === 'string' ? output.content.trim() : '';

    if (
      !title ||
      !summary ||
      content.length === 0 ||
      content.length > KNOWLEDGE_PROPOSAL_CONTENT_MAX_LENGTH
    ) {
      throw new Error('The model returned an invalid knowledge proposal.');
    }

    return { title, summary, content };
  }

  private normalizedSingleLine(value: unknown, maximumLength: number): string {
    if (typeof value !== 'string') {
      return '';
    }

    const normalized = value.trim().replace(/\s+/g, ' ');

    return normalized.length <= maximumLength ? normalized : '';
  }

  private toProposalResponse(
    attempt: KnowledgeExtractionAttempt,
  ): KnowledgeExtractionProposalResponse {
    if (!attempt.proposal) {
      throw new Error('A ready knowledge extraction has no proposal.');
    }

    return {
      id: attempt.id,
      project_id: attempt.project_id,
      discussion_id: attempt.discussion_id,
      status: 'ready',
      proposal: attempt.proposal,
      source: {
        message_ids: attempt.source_snapshot.messages.map(
          ({ source_id }) => source_id,
        ),
        frozen_context_item_ids:
          attempt.source_snapshot.frozen_context_items.map(
            ({ source_id }) => source_id,
          ),
      },
      created_at: attempt.created_at,
      expires_at: attempt.expires_at,
    };
  }

  private findByIdempotencyKey(
    projectId: string,
    discussionId: string,
    idempotencyKey: string,
  ): KnowledgeExtractionAttempt | undefined {
    try {
      return this.extractions.findByProjectDiscussionAndIdempotencyKey(
        projectId,
        discussionId,
        idempotencyKey,
      );
    } catch {
      throw this.proposalPersistenceFailed();
    }
  }

  private snapshotPersistenceFailed(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'KNOWLEDGE_EXTRACTION_SNAPSHOT_PERSISTENCE_FAILED',
      message:
        'The extraction source snapshot could not be saved. Retry with the same idempotency key.',
    });
  }

  private proposalPersistenceFailed(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'KNOWLEDGE_EXTRACTION_PROPOSAL_PERSISTENCE_FAILED',
      message:
        'The generated proposal state could not be saved. Retry with the same idempotency key.',
    });
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
      ['idempotency_key', 'message_ids', 'frozen_context_item_ids'],
      fieldErrors,
    );
    const idempotencyKey = this.idempotencyKey(
      input.idempotency_key,
      fieldErrors,
    );
    const messageIds = this.identifierArray(
      input.message_ids,
      'message_ids',
      fieldErrors,
    );
    const frozenContextItemIds = this.identifierArray(
      input.frozen_context_item_ids,
      'frozen_context_item_ids',
      fieldErrors,
    );

    if (
      messageIds &&
      frozenContextItemIds &&
      messageIds.length + frozenContextItemIds.length > MAX_SOURCE_COUNT
    ) {
      fieldErrors.message_ids = `Select no more than ${MAX_SOURCE_COUNT} sources in one extraction.`;
    }

    if (
      messageIds &&
      frozenContextItemIds &&
      messageIds.length === 0 &&
      frozenContextItemIds.length === 0
    ) {
      fieldErrors.message_ids =
        'Select at least one completed message or frozen context item.';
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw this.validationFailed(fieldErrors);
    }

    if (!idempotencyKey || !messageIds || !frozenContextItemIds) {
      throw new Error(
        'Validated knowledge extraction input is unexpectedly missing.',
      );
    }

    return {
      idempotency_key: idempotencyKey,
      message_ids: messageIds,
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
      message_ids: [...input.message_ids].sort(),
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

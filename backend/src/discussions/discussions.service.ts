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
  AiCapabilities,
  CreateDiscussionInput,
  DiscussionDetails,
  DiscussionFrozenContext,
  DiscussionListResponse,
  DiscussionMessage,
  DiscussionSummary,
  MessageCitation,
  SendMessageInput,
} from '@nuee/shared-types';
import { AI_CAPABILITIES } from '../ai/ai-capabilities';
import {
  FROZEN_CONTEXT_FORMATTER,
  type FrozenContextFormatter,
} from '../ai/frozen-context.formatter';
import {
  GENERATED_TITLE_MAX_LENGTH,
  MODEL_CLIENT,
  ModelGenerationError,
} from '../ai/model-client';
import type {
  GenerateAnswerInput,
  ModelClient,
  ModelGeneration,
  ModelMessage,
} from '../ai/model-client';
import {
  MODEL_INPUT_BUDGET,
  type ModelInputBudget,
} from '../ai/model-input-budget';
import {
  BUBBLE_DISCUSSION_PROVENANCE_WRITER,
  type BubbleDiscussionProvenanceWriter,
} from '../bubbles/bubble.types';
import { DatabaseTransaction } from '../database/database-transaction';
import { DiscussionContextAssembler } from '../discussion-context/discussion-context.assembler';
import { DiscussionContextSourceError } from '../discussion-context/discussion-context.types';
import { ProjectsService } from '../projects/projects.service';
import {
  DISCUSSION_MESSAGE_REPOSITORY,
  DISCUSSION_REPOSITORY,
} from './discussion.types';
import type {
  DiscussionMessageRepository,
  DiscussionRepository,
  PersistedDiscussion,
  PersistedDiscussionMessage,
  VersionedPersistedDiscussion,
} from './discussion.types';

const TEMPORARY_TITLE = 'New discussion';
const MAX_MESSAGE_LENGTH = 20_000;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const MAX_CONTEXT_SOURCE_ID_LENGTH = 200;
const MAX_CONTEXT_SELECTION_COUNT = 100;
const MAX_CITATIONS_SERIALIZED_BYTES = 64 * 1024;

type DiscussionField =
  'project_id' | 'first_prompt' | 'content' | 'idempotency_key';

@Injectable()
export class DiscussionsService {
  private readonly titleGenerations = new Map<
    string,
    Promise<DiscussionDetails>
  >();

  constructor(
    private readonly projects: ProjectsService,
    @Inject(DISCUSSION_REPOSITORY)
    private readonly discussions: DiscussionRepository,
    @Inject(DISCUSSION_MESSAGE_REPOSITORY)
    private readonly messages: DiscussionMessageRepository,
    @Inject(MODEL_CLIENT)
    private readonly modelClient: ModelClient,
    @Inject(FROZEN_CONTEXT_FORMATTER)
    private readonly contextFormatter: FrozenContextFormatter,
    @Inject(MODEL_INPUT_BUDGET)
    private readonly modelInputBudget: ModelInputBudget,
    private readonly contextAssembler: DiscussionContextAssembler,
    @Inject(BUBBLE_DISCUSSION_PROVENANCE_WRITER)
    private readonly bubbleProvenance: BubbleDiscussionProvenanceWriter,
    private readonly transactions: DatabaseTransaction,
    @Inject(AI_CAPABILITIES)
    private readonly aiCapabilities: AiCapabilities,
  ) {}

  async create(
    projectId: string,
    input: CreateDiscussionInput,
  ): Promise<DiscussionDetails> {
    this.projects.get(projectId);

    const fieldErrors: Record<string, string> = {};
    this.rejectUnknownFields(
      input,
      [
        'project_id',
        'first_prompt',
        'idempotency_key',
        'bubble_ids',
        'document_ids',
        'web_search',
      ],
      fieldErrors,
    );
    const inputProjectId = this.requiredText(
      input?.project_id,
      'project_id',
      fieldErrors,
    );
    const firstPrompt = this.messageText(
      input?.first_prompt,
      'first_prompt',
      fieldErrors,
    );
    const creationIdempotencyKey = this.idempotencyKey(
      input?.idempotency_key,
      fieldErrors,
    );
    const bubbleIds = this.contextSourceIds(
      input?.bubble_ids,
      'bubble_ids',
      fieldErrors,
    );
    const documentIds = this.contextSourceIds(
      input?.document_ids,
      'document_ids',
      fieldErrors,
    );
    const webSearch = this.webSearch(input?.web_search, fieldErrors);

    if (inputProjectId && inputProjectId !== projectId) {
      fieldErrors.project_id =
        'Project id must match the project in the request path.';
    }

    this.throwIfInvalid(fieldErrors);
    this.assertWebSearchAvailable(webSearch);

    if (!firstPrompt || !creationIdempotencyKey || !bubbleIds || !documentIds) {
      throw new Error('Validated discussion input is unexpectedly missing.');
    }

    const selection = {
      bubble_ids: this.deduplicate(bubbleIds),
      document_ids: this.deduplicate(documentIds),
    };
    const requestFingerprint = this.creationRequestFingerprint(
      firstPrompt,
      selection,
    );
    const replay = this.findCreationReplay(
      projectId,
      creationIdempotencyKey,
      requestFingerprint,
      webSearch,
    );

    if (replay) {
      return replay;
    }

    let frozenContext: VersionedPersistedDiscussion['frozen_context'];

    try {
      frozenContext = this.contextAssembler.assemble(projectId, selection);
    } catch (error) {
      if (error instanceof DiscussionContextSourceError) {
        throw new UnprocessableEntityException({
          code: error.code,
          message:
            'One or more selected context sources are unavailable. Review or remove the affected selections.',
          source_errors: error.issues,
        });
      }

      throw error;
    }

    const modelInput = this.prepareModelInput(
      frozenContext,
      [{ role: 'user', content: firstPrompt }],
      webSearch,
    );

    const timestamp = new Date().toISOString();
    const discussion: VersionedPersistedDiscussion = {
      id: randomUUID(),
      project_id: projectId,
      title: null,
      frozen_context: frozenContext,
      created_at: timestamp,
      updated_at: timestamp,
      last_activity_at: timestamp,
      deleted_at: null,
      context_version: frozenContext.version,
      expected_context_item_count: frozenContext.items.length,
      creation_idempotency_key: creationIdempotencyKey,
      creation_request_fingerprint: requestFingerprint,
    };
    const firstMessage: PersistedDiscussionMessage = {
      id: randomUUID(),
      discussion_id: discussion.id,
      role: 'user',
      content: firstPrompt,
      created_at: timestamp,
      status: 'pending',
      request_id: randomUUID(),
      ...(webSearch ? { web_search: true } : {}),
    };

    try {
      this.discussions.createWithFirstMessage(discussion, firstMessage);
    } catch {
      const concurrentReplay = this.findCreationReplay(
        projectId,
        creationIdempotencyKey,
        requestFingerprint,
        webSearch,
      );

      if (concurrentReplay) {
        return concurrentReplay;
      }

      throw this.snapshotPersistenceFailed();
    }

    await this.generateAnswer(discussion, firstMessage, modelInput);

    return this.get(projectId, discussion.id);
  }

  list(projectId: string): DiscussionListResponse {
    this.projects.get(projectId);

    return this.discussions
      .findAllByProjectId(projectId)
      .map((discussion, index) => this.toSummary(discussion, index === 0));
  }

  get(projectId: string, discussionId: string): DiscussionDetails {
    const discussion = this.getPersisted(projectId, discussionId);

    return this.toDetails(
      discussion,
      this.messages.findAllMessages(projectId, discussionId),
    );
  }

  recordOpen(projectId: string, discussionId: string): DiscussionDetails {
    const discussion = this.getPersisted(projectId, discussionId);
    const openedAt = this.nextTimestamp(discussion.last_activity_at);
    const openedDiscussion = this.discussions.updateActivity(
      projectId,
      discussionId,
      openedAt,
    );

    if (!openedDiscussion) {
      throw this.notFound(projectId, discussionId);
    }

    return this.toDetails(
      openedDiscussion,
      this.messages.findAllMessages(projectId, discussionId),
    );
  }

  async sendMessage(
    projectId: string,
    discussionId: string,
    input: SendMessageInput,
  ): Promise<DiscussionDetails> {
    const discussion = this.getPersisted(projectId, discussionId);
    const fieldErrors: Record<string, string> = {};
    this.rejectUnknownFields(
      input,
      ['content', 'idempotency_key', 'web_search'],
      fieldErrors,
    );
    const content = this.messageText(input?.content, 'content', fieldErrors);
    const requestId = this.idempotencyKey(input?.idempotency_key, fieldErrors);
    const webSearch = this.webSearch(input?.web_search, fieldErrors);
    this.throwIfInvalid(fieldErrors);
    this.assertWebSearchAvailable(webSearch);

    if (!content || !requestId) {
      throw new Error('Validated discussion input is unexpectedly missing.');
    }

    const existingMessages = this.messages.findAllMessages(
      projectId,
      discussionId,
    );
    const existingRequest = this.messages.findMessageByRequestId(
      projectId,
      discussionId,
      requestId,
    );

    if (existingRequest) {
      this.assertIdempotentTurn(existingRequest, content, webSearch);

      if (existingRequest.status === 'completed') {
        return this.get(projectId, discussionId);
      }

      if (existingRequest.status === 'pending') {
        return this.get(projectId, discussionId);
      }

      const modelInput = this.prepareModelInput(
        discussion.frozen_context,
        this.toModelMessages(existingMessages),
        existingRequest.web_search === true,
      );

      const pendingAt = this.nextTimestamp(discussion.updated_at);
      const retriedMessage = this.messages.updateMessageStatus(
        projectId,
        discussionId,
        existingRequest.id,
        'pending',
        pendingAt,
      );

      if (!retriedMessage) {
        throw this.notFound(projectId, discussionId);
      }

      await this.generateAnswer(discussion, retriedMessage, modelInput);
      return this.get(projectId, discussionId);
    }

    this.assertNoUnansweredTurn(existingMessages);
    const modelInput = this.prepareModelInput(
      discussion.frozen_context,
      this.toModelMessages(existingMessages, content),
      webSearch,
    );

    const createdAt = this.nextTimestamp(
      this.latestTimestamp(discussion.updated_at, discussion.last_activity_at),
    );
    const userMessage: PersistedDiscussionMessage = {
      id: randomUUID(),
      discussion_id: discussionId,
      role: 'user',
      content,
      created_at: createdAt,
      status: 'pending',
      request_id: requestId,
      ...(webSearch ? { web_search: true } : {}),
    };

    try {
      const appendedMessage = this.messages.appendMessage(
        projectId,
        userMessage,
        createdAt,
      );

      if (!appendedMessage) {
        throw this.notFound(projectId, discussionId);
      }
    } catch (error) {
      const concurrentRequest = this.messages.findMessageByRequestId(
        projectId,
        discussionId,
        requestId,
      );

      if (!concurrentRequest) {
        throw error;
      }

      this.assertIdempotentTurn(concurrentRequest, content, webSearch);
      return this.get(projectId, discussionId);
    }

    await this.generateAnswer(
      {
        ...discussion,
        updated_at: createdAt,
        last_activity_at: createdAt,
      },
      userMessage,
      modelInput,
    );

    return this.get(projectId, discussionId);
  }

  async generateTitle(
    projectId: string,
    discussionId: string,
  ): Promise<DiscussionDetails> {
    const discussion = this.getPersisted(projectId, discussionId);

    if (discussion.title !== null) {
      return this.get(projectId, discussionId);
    }

    const messages = this.messages.findAllMessages(projectId, discussionId);
    this.assertCompletedExchange(messages);

    const generationKey = `${projectId}:${discussionId}`;
    const activeGeneration = this.titleGenerations.get(generationKey);

    if (activeGeneration) {
      return activeGeneration;
    }

    const generation = this.generateAndPersistTitle(discussion, messages);
    this.titleGenerations.set(generationKey, generation);

    try {
      return await generation;
    } finally {
      if (this.titleGenerations.get(generationKey) === generation) {
        this.titleGenerations.delete(generationKey);
      }
    }
  }

  delete(projectId: string, discussionId: string): void {
    const discussion = this.getPersisted(projectId, discussionId);
    const deletedAt = this.nextTimestamp(
      this.latestTimestamp(discussion.updated_at, discussion.last_activity_at),
    );

    this.transactions.run(() => {
      if (!this.discussions.softDelete(projectId, discussionId, deletedAt)) {
        throw this.notFound(projectId, discussionId);
      }

      this.bubbleProvenance.markSourceDiscussionDeleted(
        projectId,
        discussionId,
        deletedAt,
      );
    });
  }

  private async generateAndPersistTitle(
    discussion: PersistedDiscussion,
    messages: readonly PersistedDiscussionMessage[],
  ): Promise<DiscussionDetails> {
    let title: string;

    try {
      const generation = await this.modelClient.generateTitle({
        messages: this.toModelMessages(
          messages.filter(({ status }) => status === 'completed'),
        ),
      });
      title = this.generatedTitle(generation.content);
    } catch {
      throw new ServiceUnavailableException({
        code: 'AI_TITLE_GENERATION_FAILED',
        message:
          'The discussion title could not be generated. Retry title generation.',
        discussion_id: discussion.id,
      });
    }

    const updatedAt = this.nextTimestamp(discussion.updated_at);
    const titledDiscussion = this.discussions.updateTitle(
      discussion.project_id,
      discussion.id,
      title,
      updatedAt,
    );

    if (titledDiscussion) {
      return this.toDetails(
        titledDiscussion,
        this.messages.findAllMessages(discussion.project_id, discussion.id),
      );
    }

    const currentDiscussion = this.discussions.findByProjectAndId(
      discussion.project_id,
      discussion.id,
    );

    if (currentDiscussion && currentDiscussion.title !== null) {
      return this.toDetails(
        currentDiscussion,
        this.messages.findAllMessages(discussion.project_id, discussion.id),
      );
    }

    throw this.notFound(discussion.project_id, discussion.id);
  }

  private async generateAnswer(
    discussion: PersistedDiscussion,
    userMessage: PersistedDiscussionMessage,
    modelInput: GenerateAnswerInput,
  ): Promise<void> {
    try {
      const generation = await this.modelClient.generateAnswer(modelInput);
      const content = generation.content?.trim();

      if (!content) {
        throw new Error('The model returned an empty response.');
      }

      const attribution = this.generatedAttribution(
        generation,
        userMessage.web_search === true,
      );

      const completedAt = this.nextTimestamp(
        this.latestTimestamp(
          discussion.updated_at,
          discussion.last_activity_at,
          userMessage.created_at,
        ),
      );
      const completed = this.messages.completeMessageGeneration(
        discussion.project_id,
        discussion.id,
        userMessage.id,
        {
          id: randomUUID(),
          discussion_id: discussion.id,
          role: 'assistant',
          content,
          created_at: completedAt,
          status: 'completed',
          request_id: null,
          ...attribution,
        },
        completedAt,
      );

      if (!completed) {
        return;
      }
    } catch (error) {
      const failedAt = this.nextTimestamp(
        this.latestTimestamp(discussion.updated_at, userMessage.created_at),
      );
      this.messages.updateMessageStatus(
        discussion.project_id,
        discussion.id,
        userMessage.id,
        'failed',
        failedAt,
      );

      const timedOut =
        error instanceof ModelGenerationError && error.reason === 'timeout';

      throw new ServiceUnavailableException({
        code: timedOut ? 'AI_GENERATION_TIMEOUT' : 'AI_GENERATION_FAILED',
        message: timedOut
          ? 'The response took too long to generate. Retry the unanswered message.'
          : 'The response could not be generated. Retry the unanswered message.',
        discussion_id: discussion.id,
        request_id: userMessage.request_id,
      });
    }
  }

  private getPersisted(
    projectId: string,
    discussionId: string,
  ): PersistedDiscussion {
    this.projects.get(projectId);
    const discussion = this.discussions.findByProjectAndId(
      projectId,
      discussionId,
    );

    if (!discussion) {
      throw this.notFound(projectId, discussionId);
    }

    return discussion;
  }

  private toDetails(
    discussion: PersistedDiscussion,
    messages: PersistedDiscussionMessage[],
  ): DiscussionDetails {
    return {
      id: discussion.id,
      project_id: discussion.project_id,
      title: discussion.title ?? TEMPORARY_TITLE,
      frozen_context: discussion.frozen_context,
      created_at: discussion.created_at,
      updated_at: discussion.updated_at,
      last_activity_at: discussion.last_activity_at,
      messages: messages.map((message) => this.toPublicMessage(message)),
    };
  }

  private toPublicMessage(
    message: PersistedDiscussionMessage,
  ): DiscussionMessage {
    const publicMessage = { ...message };
    delete publicMessage.web_search;
    return publicMessage;
  }

  private toSummary(
    discussion: PersistedDiscussion,
    isActive: boolean,
  ): DiscussionSummary {
    return {
      id: discussion.id,
      project_id: discussion.project_id,
      title: discussion.title ?? TEMPORARY_TITLE,
      created_at: discussion.created_at,
      updated_at: discussion.updated_at,
      last_activity_at: discussion.last_activity_at,
      is_active: isActive,
    };
  }

  private messageText(
    value: unknown,
    field: 'first_prompt' | 'content',
    fieldErrors: Record<string, string>,
  ): string | undefined {
    const text = this.requiredText(value, field, fieldErrors);

    if (text && text.length > MAX_MESSAGE_LENGTH) {
      fieldErrors[field] =
        `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`;
      return undefined;
    }

    return text;
  }

  private idempotencyKey(
    value: unknown,
    fieldErrors: Record<string, string>,
  ): string | undefined {
    const key = this.requiredText(value, 'idempotency_key', fieldErrors);

    if (key && key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      fieldErrors.idempotency_key = `Idempotency key must be ${MAX_IDEMPOTENCY_KEY_LENGTH} characters or fewer.`;
      return undefined;
    }

    return key;
  }

  private contextSourceIds(
    value: unknown,
    field: 'bubble_ids' | 'document_ids',
    fieldErrors: Record<string, string>,
  ): string[] | undefined {
    const sourceLabel = field === 'bubble_ids' ? 'Bubble' : 'Document';

    if (!Array.isArray(value)) {
      fieldErrors[field] = `${sourceLabel} ids must be an array.`;
      return undefined;
    }

    if (value.length > MAX_CONTEXT_SELECTION_COUNT) {
      fieldErrors[field] =
        `Select no more than ${MAX_CONTEXT_SELECTION_COUNT} ${sourceLabel.toLowerCase()}s.`;
      return undefined;
    }

    const sourceIds: string[] = [];
    let isValid = true;

    value.forEach((sourceId, index) => {
      const fieldName = `${field}.${index}`;

      if (typeof sourceId !== 'string' || sourceId.trim().length === 0) {
        fieldErrors[fieldName] = `${sourceLabel} identifier is required.`;
        isValid = false;
        return;
      }

      const normalizedSourceId = sourceId.trim();

      if (normalizedSourceId.length > MAX_CONTEXT_SOURCE_ID_LENGTH) {
        fieldErrors[fieldName] =
          `${sourceLabel} identifier must be ${MAX_CONTEXT_SOURCE_ID_LENGTH} characters or fewer.`;
        isValid = false;
        return;
      }

      sourceIds.push(normalizedSourceId);
    });

    return isValid ? sourceIds : undefined;
  }

  private webSearch(
    value: unknown,
    fieldErrors: Record<string, string>,
  ): boolean {
    if (value === undefined) {
      return false;
    }

    if (typeof value !== 'boolean') {
      fieldErrors.web_search = 'Web search must be a boolean.';
      return false;
    }

    return value;
  }

  private requiredText(
    value: unknown,
    field: DiscussionField,
    fieldErrors: Record<string, string>,
  ): string | undefined {
    if (typeof value !== 'string' || value.trim().length === 0) {
      fieldErrors[field] =
        field === 'idempotency_key'
          ? 'Idempotency key is required.'
          : field === 'project_id'
            ? 'Project id is required.'
            : 'Message is required.';
      return undefined;
    }

    return value.trim();
  }

  private deduplicate(values: readonly string[]): string[] {
    return [...new Set(values)];
  }

  private creationRequestFingerprint(
    firstPrompt: string,
    selection: Pick<CreateDiscussionInput, 'bubble_ids' | 'document_ids'>,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          first_prompt: firstPrompt,
          bubble_ids: selection.bubble_ids,
          document_ids: selection.document_ids,
        }),
      )
      .digest('hex');
  }

  private findCreationReplay(
    projectId: string,
    idempotencyKey: string,
    requestFingerprint: string,
    webSearch: boolean,
  ): DiscussionDetails | undefined {
    let existing: PersistedDiscussion | undefined;

    try {
      existing = this.discussions.findByProjectAndCreationIdempotencyKey(
        projectId,
        idempotencyKey,
      );
    } catch {
      throw this.snapshotPersistenceFailed();
    }

    if (!existing) {
      return undefined;
    }

    const existingMessages = this.messages.findAllMessages(
      projectId,
      existing.id,
    );
    const firstUserMessage = existingMessages.find(
      ({ role }) => role === 'user',
    );

    if (
      existing.creation_request_fingerprint !== requestFingerprint ||
      (firstUserMessage?.web_search === true) !== webSearch
    ) {
      throw new ConflictException({
        code: 'DISCUSSION_CREATION_IDEMPOTENCY_CONFLICT',
        message:
          'The creation idempotency key has already been used with a different prompt or context selection.',
      });
    }

    return this.toDetails(existing, existingMessages);
  }

  private rejectUnknownFields(
    input: unknown,
    allowedFields: readonly string[],
    fieldErrors: Record<string, string>,
  ): void {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return;
    }

    for (const field of Object.keys(input)) {
      if (!allowedFields.includes(field)) {
        fieldErrors[field] = 'Unknown field.';
      }
    }
  }

  private throwIfInvalid(fieldErrors: Record<string, string>): void {
    if (Object.keys(fieldErrors).length === 0) {
      return;
    }

    throw new BadRequestException({
      code: 'DISCUSSION_VALIDATION_FAILED',
      message: 'Discussion input is invalid.',
      field_errors: fieldErrors,
    });
  }

  private assertWebSearchAvailable(webSearch: boolean): void {
    if (!webSearch || this.aiCapabilities.web_search) {
      return;
    }

    throw new BadRequestException({
      code: 'AI_WEB_SEARCH_UNAVAILABLE',
      message: 'Web search is not available for this application.',
    });
  }

  private generatedAttribution(
    generation: ModelGeneration,
    webSearchRequested: boolean,
  ): Pick<PersistedDiscussionMessage, 'web_search_used' | 'citations'> {
    const webSearchUsed = generation.webSearchUsed as unknown;
    const rawCitations = generation.citations as unknown;

    if (
      (webSearchUsed !== undefined && typeof webSearchUsed !== 'boolean') ||
      (!webSearchRequested && webSearchUsed === true) ||
      (rawCitations !== undefined && webSearchUsed !== true)
    ) {
      throw new Error('The model returned invalid search attribution.');
    }

    if (webSearchUsed !== true) {
      return {};
    }

    if (rawCitations !== undefined && !Array.isArray(rawCitations)) {
      throw new Error('The model returned invalid search citations.');
    }

    const citations = (rawCitations ?? []).map((citation) =>
      this.validatedCitation(citation),
    );
    const serialized = JSON.stringify(citations);

    if (
      Buffer.byteLength(serialized, 'utf8') > MAX_CITATIONS_SERIALIZED_BYTES
    ) {
      throw new Error('The model returned too many search citations.');
    }

    return {
      web_search_used: true,
      citations,
    };
  }

  private validatedCitation(value: unknown): MessageCitation {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('The model returned an invalid search citation.');
    }

    const citation = value as Record<string, unknown>;
    const { url, title, snippet } = citation;
    const hasOnlyKnownFields = Object.keys(citation).every((key) =>
      ['url', 'title', 'snippet'].includes(key),
    );

    if (
      !hasOnlyKnownFields ||
      typeof url !== 'string' ||
      url.trim().length === 0 ||
      typeof title !== 'string' ||
      title.trim().length === 0 ||
      (snippet !== undefined && typeof snippet !== 'string')
    ) {
      throw new Error('The model returned an invalid search citation.');
    }

    return {
      url,
      title,
      ...(snippet === undefined ? {} : { snippet }),
    };
  }

  private prepareModelInput(
    frozenContext: DiscussionFrozenContext,
    messages: readonly ModelMessage[],
    webSearch = false,
  ): GenerateAnswerInput {
    const formattedContext = this.contextFormatter.format(frozenContext);
    const input = {
      formattedContext,
      messages,
      ...(webSearch ? { webSearch: true } : {}),
    };
    const budget = this.modelInputBudget.evaluateAnswer(input);

    if (!budget.fits) {
      throw new PayloadTooLargeException({
        code: 'DISCUSSION_CONTEXT_TOO_LARGE',
        message:
          'The frozen context and complete message history exceed the supported model input budget. Remove selected context or start a new discussion.',
        estimated_input_tokens: budget.estimatedInputTokens,
        available_input_tokens: budget.availableInputTokens,
        input_token_limit: budget.inputTokenLimit,
        reserved_output_tokens: budget.reservedOutputTokens,
        safety_margin_tokens: budget.safetyMarginTokens,
      });
    }

    return input;
  }

  private snapshotPersistenceFailed(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'DISCUSSION_SNAPSHOT_PERSISTENCE_FAILED',
      message:
        'The discussion and its frozen context could not be saved. Retry creation with the same idempotency key.',
    });
  }

  private toModelMessages(
    messages: readonly PersistedDiscussionMessage[],
    nextContent?: string,
  ): ModelMessage[] {
    const history = messages.map(({ role, content }) => ({ role, content }));

    return nextContent === undefined
      ? history
      : [...history, { role: 'user', content: nextContent }];
  }

  private assertIdempotentTurn(
    existing: PersistedDiscussionMessage,
    content: string,
    webSearch: boolean,
  ): void {
    if (
      existing.content === content &&
      (existing.web_search === true) === webSearch
    ) {
      return;
    }

    throw new ConflictException({
      code: 'DISCUSSION_IDEMPOTENCY_CONFLICT',
      message:
        'The idempotency key has already been used for different message content.',
    });
  }

  private assertNoUnansweredTurn(
    messages: readonly PersistedDiscussionMessage[],
  ): void {
    const unanswered = messages.find(
      (message) =>
        message.role === 'user' &&
        (message.status === 'pending' || message.status === 'failed'),
    );

    if (!unanswered) {
      return;
    }

    throw new ConflictException({
      code:
        unanswered.status === 'pending'
          ? 'DISCUSSION_RESPONSE_PENDING'
          : 'DISCUSSION_RESPONSE_RETRY_REQUIRED',
      message:
        unanswered.status === 'pending'
          ? 'Wait for the pending response before sending another message.'
          : 'Retry the failed response before sending another message.',
      request_id: unanswered.request_id,
    });
  }

  private assertCompletedExchange(
    messages: readonly PersistedDiscussionMessage[],
  ): void {
    const firstCompletedUserIndex = messages.findIndex(
      ({ role, status }) => role === 'user' && status === 'completed',
    );
    const hasCompletedExchange =
      firstCompletedUserIndex >= 0 &&
      messages
        .slice(firstCompletedUserIndex + 1)
        .some(
          ({ role, status }) => role === 'assistant' && status === 'completed',
        );

    if (hasCompletedExchange) {
      return;
    }

    throw new ConflictException({
      code: 'DISCUSSION_TITLE_NOT_READY',
      message:
        'A title can be generated after the first response is completed.',
    });
  }

  private generatedTitle(value: unknown): string {
    const title =
      typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

    if (title.length === 0 || title.length > GENERATED_TITLE_MAX_LENGTH) {
      throw new Error('The model returned an invalid discussion title.');
    }

    return title;
  }

  private latestTimestamp(...timestamps: string[]): string {
    return timestamps.reduce((latest, candidate) =>
      new Date(candidate).getTime() > new Date(latest).getTime()
        ? candidate
        : latest,
    );
  }

  private nextTimestamp(previousTimestamp: string): string {
    const currentTime = Date.now();
    const previousTime = new Date(previousTimestamp).getTime();

    return new Date(Math.max(currentTime, previousTime + 1)).toISOString();
  }

  private notFound(projectId: string, discussionId: string): NotFoundException {
    return new NotFoundException({
      code: 'DISCUSSION_NOT_FOUND',
      message: `Discussion "${discussionId}" was not found in project "${projectId}".`,
    });
  }
}

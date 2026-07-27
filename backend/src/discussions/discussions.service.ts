import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CreateDiscussionInput,
  DiscussionDetails,
  DiscussionListResponse,
  DiscussionSummary,
  SendMessageInput,
} from '@nuee/shared-types';
import { MODEL_CLIENT } from '../ai/model-client';
import type { ModelClient, ModelMessage } from '../ai/model-client';
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
} from './discussion.types';

const TEMPORARY_TITLE = 'New discussion';
const MAX_MESSAGE_LENGTH = 20_000;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const MAX_MODEL_INPUT_BYTES = 250_000;

type DiscussionField =
  'project_id' | 'first_prompt' | 'content' | 'idempotency_key';

@Injectable()
export class DiscussionsService {
  constructor(
    private readonly projects: ProjectsService,
    @Inject(DISCUSSION_REPOSITORY)
    private readonly discussions: DiscussionRepository,
    @Inject(DISCUSSION_MESSAGE_REPOSITORY)
    private readonly messages: DiscussionMessageRepository,
    @Inject(MODEL_CLIENT)
    private readonly modelClient: ModelClient,
  ) {}

  async create(
    projectId: string,
    input: CreateDiscussionInput,
  ): Promise<DiscussionDetails> {
    this.projects.get(projectId);

    const fieldErrors: Record<string, string> = {};
    this.rejectUnknownFields(
      input,
      ['project_id', 'frozen_context', 'first_prompt'],
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
    const frozenContext = this.frozenContext(
      input?.frozen_context,
      fieldErrors,
    );

    if (inputProjectId && inputProjectId !== projectId) {
      fieldErrors.project_id =
        'Project id must match the project in the request path.';
    }

    this.throwIfInvalid(fieldErrors);

    if (!firstPrompt || !frozenContext) {
      throw new Error('Validated discussion input is unexpectedly missing.');
    }

    this.guardModelInput(frozenContext, [
      { role: 'user', content: firstPrompt },
    ]);

    const timestamp = new Date().toISOString();
    const discussion: PersistedDiscussion = {
      id: randomUUID(),
      project_id: projectId,
      title: null,
      frozen_context: frozenContext,
      created_at: timestamp,
      updated_at: timestamp,
      last_activity_at: timestamp,
      deleted_at: null,
    };
    const firstMessage: PersistedDiscussionMessage = {
      id: randomUUID(),
      discussion_id: discussion.id,
      role: 'user',
      content: firstPrompt,
      created_at: timestamp,
      status: 'pending',
      request_id: randomUUID(),
    };

    this.discussions.createWithFirstMessage(discussion, firstMessage);
    await this.generateAnswer(discussion, firstMessage);

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
      ['content', 'idempotency_key'],
      fieldErrors,
    );
    const content = this.messageText(input?.content, 'content', fieldErrors);
    const requestId = this.idempotencyKey(input?.idempotency_key, fieldErrors);
    this.throwIfInvalid(fieldErrors);

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
      this.assertIdempotentContent(existingRequest, content);

      if (existingRequest.status === 'completed') {
        return this.get(projectId, discussionId);
      }

      if (existingRequest.status === 'pending') {
        return this.get(projectId, discussionId);
      }

      this.guardModelInput(
        discussion.frozen_context,
        this.toModelMessages(existingMessages),
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

      await this.generateAnswer(discussion, retriedMessage);
      return this.get(projectId, discussionId);
    }

    this.assertNoUnansweredTurn(existingMessages);
    this.guardModelInput(
      discussion.frozen_context,
      this.toModelMessages(existingMessages, content),
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

      this.assertIdempotentContent(concurrentRequest, content);
      return this.get(projectId, discussionId);
    }

    await this.generateAnswer(
      {
        ...discussion,
        updated_at: createdAt,
        last_activity_at: createdAt,
      },
      userMessage,
    );

    return this.get(projectId, discussionId);
  }

  delete(projectId: string, discussionId: string): void {
    const discussion = this.getPersisted(projectId, discussionId);
    const deletedAt = this.nextTimestamp(
      this.latestTimestamp(discussion.updated_at, discussion.last_activity_at),
    );

    if (!this.discussions.softDelete(projectId, discussionId, deletedAt)) {
      throw this.notFound(projectId, discussionId);
    }
  }

  private async generateAnswer(
    discussion: PersistedDiscussion,
    userMessage: PersistedDiscussionMessage,
  ): Promise<void> {
    const history = this.messages.findAllMessages(
      discussion.project_id,
      discussion.id,
    );
    const modelMessages = history.map(({ role, content }) => ({
      role,
      content,
    }));
    this.guardModelInput(discussion.frozen_context, modelMessages);

    try {
      const generation = await this.modelClient.generateAnswer({
        frozenContext: discussion.frozen_context,
        messages: modelMessages,
      });
      const content = generation.content?.trim();

      if (!content) {
        throw new Error('The model returned an empty response.');
      }

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
        },
        completedAt,
      );

      if (!completed) {
        return;
      }
    } catch {
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

      throw new ServiceUnavailableException({
        code: 'AI_GENERATION_FAILED',
        message:
          'The response could not be generated. Retry the unanswered message.',
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
      messages,
    };
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

  private frozenContext(
    value: unknown,
    fieldErrors: Record<string, string>,
  ): Record<string, unknown> | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      fieldErrors.frozen_context = 'Frozen context must be a JSON object.';
      return undefined;
    }

    try {
      const serialized = JSON.stringify(value);

      if (!serialized) {
        throw new Error('Frozen context is not serializable.');
      }

      return JSON.parse(serialized) as Record<string, unknown>;
    } catch {
      fieldErrors.frozen_context =
        'Frozen context must be a serializable JSON object.';
      return undefined;
    }
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

  private guardModelInput(
    frozenContext: Record<string, unknown>,
    messages: readonly ModelMessage[],
  ): void {
    const serialized = JSON.stringify({
      frozen_context: frozenContext,
      messages,
    });

    if (Buffer.byteLength(serialized, 'utf8') > MAX_MODEL_INPUT_BYTES) {
      throw new PayloadTooLargeException({
        code: 'DISCUSSION_CONTEXT_TOO_LARGE',
        message:
          'The frozen context and message history are too large to send without truncation.',
        limit_bytes: MAX_MODEL_INPUT_BYTES,
      });
    }
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

  private assertIdempotentContent(
    existing: PersistedDiscussionMessage,
    content: string,
  ): void {
    if (existing.content === content) {
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

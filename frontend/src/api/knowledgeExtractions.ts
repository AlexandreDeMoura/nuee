import type {
  Bubble,
  CreateKnowledgeExtractionInput,
  KnowledgeExtractionDetailLevel,
  KnowledgeExtractionProposal,
  KnowledgeExtractionProposalResponse,
  KnowledgeExtractionResolutionResponse,
  KnowledgeExtractionSourceReference,
  KnowledgeExtractionTargetChangedError,
  KnowledgeExtractionTargetPreview,
  ResolveKnowledgeExtractionInput,
} from '@nuee/shared-types';
import { isBubbleResponse } from './bubbles';
import { requestJson } from './client';

export type {
  CreateKnowledgeExtractionInput,
  KnowledgeExtractionDetailLevel,
  KnowledgeExtractionProposal,
  KnowledgeExtractionProposalResponse,
  KnowledgeExtractionResolutionResponse,
  KnowledgeExtractionSourceReference,
  KnowledgeExtractionTargetChangedError,
  KnowledgeExtractionTargetPreview,
  ResolveKnowledgeExtractionInput,
};

export type KnowledgeExtractionRequest = typeof requestJson;

const INVALID_RESPONSE_MESSAGE =
  'The knowledge extraction response contained invalid data.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const milliseconds = Date.parse(value);

  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function isIdentifierList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(isNonEmptyString) &&
    new Set(value).size === value.length
  );
}

function haveSameIdentifiers(
  first: readonly string[],
  second: readonly string[],
): boolean {
  return (
    first.length === second.length &&
    first.every((identifier) => second.includes(identifier))
  );
}

function isProposal(value: unknown): value is KnowledgeExtractionProposal {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.summary) &&
    isNonEmptyString(value.content)
  );
}

function isSourceReference(
  value: unknown,
): value is KnowledgeExtractionSourceReference {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isIdentifierList(value.message_ids) &&
    isIdentifierList(value.frozen_context_item_ids) &&
    value.message_ids.length + value.frozen_context_item_ids.length > 0
  );
}

function sourceMatchesInput(
  source: KnowledgeExtractionSourceReference,
  input: CreateKnowledgeExtractionInput,
): boolean {
  if (
    !haveSameIdentifiers(
      source.frozen_context_item_ids,
      input.frozen_context_item_ids,
    )
  ) {
    return false;
  }

  return haveSameIdentifiers(source.message_ids, input.message_ids);
}

export function isKnowledgeExtractionProposalResponse(
  value: unknown,
  projectId: string,
  discussionId: string,
  input?: CreateKnowledgeExtractionInput,
): value is KnowledgeExtractionProposalResponse {
  if (!isRecord(value)) {
    return false;
  }

  const source = value.source;

  return (
    isNonEmptyString(value.id) &&
    value.project_id === projectId &&
    value.discussion_id === discussionId &&
    value.status === 'ready' &&
    isProposal(value.proposal) &&
    isSourceReference(source) &&
    (!input || sourceMatchesInput(source, input)) &&
    isIsoTimestamp(value.created_at) &&
    isIsoTimestamp(value.expires_at) &&
    Date.parse(value.expires_at) > Date.parse(value.created_at)
  );
}

export function assertKnowledgeExtractionProposalResponse(
  value: unknown,
  projectId: string,
  discussionId: string,
  input?: CreateKnowledgeExtractionInput,
): KnowledgeExtractionProposalResponse {
  if (
    !isKnowledgeExtractionProposalResponse(
      value,
      projectId,
      discussionId,
      input,
    )
  ) {
    throw new Error(INVALID_RESPONSE_MESSAGE);
  }

  return value;
}

function resolutionBubble(
  value: unknown,
  projectId: string,
): value is Bubble {
  return isBubbleResponse(value, projectId);
}

export function isKnowledgeExtractionResolutionResponse(
  value: unknown,
  projectId: string,
  discussionId: string,
  extractionId: string,
  expectedKind?: ResolveKnowledgeExtractionInput['kind'],
  expectedTargetBubbleId?: string,
): value is KnowledgeExtractionResolutionResponse {
  if (
    !isRecord(value) ||
    value.id !== extractionId ||
    value.project_id !== projectId ||
    value.discussion_id !== discussionId ||
    value.status !== 'resolved' ||
    !isRecord(value.resolution)
  ) {
    return false;
  }

  const resolution = value.resolution;

  if (
    expectedKind !== undefined &&
    resolution.kind !== expectedKind
  ) {
    return false;
  }

  if (resolution.kind === 'reject') {
    return true;
  }

  if (
    resolution.kind !== 'new_bubble' &&
    resolution.kind !== 'update_bubble'
  ) {
    return false;
  }

  return (
    resolutionBubble(resolution.bubble, projectId) &&
    resolution.bubble.source_kind === 'discussion' &&
    resolution.bubble.source_discussion_id === discussionId &&
    (resolution.kind !== 'update_bubble' ||
      expectedTargetBubbleId === undefined ||
      resolution.bubble.id === expectedTargetBubbleId)
  );
}

export function assertKnowledgeExtractionResolutionResponse(
  value: unknown,
  projectId: string,
  discussionId: string,
  extractionId: string,
  input?: ResolveKnowledgeExtractionInput,
): KnowledgeExtractionResolutionResponse {
  if (
    !isKnowledgeExtractionResolutionResponse(
      value,
      projectId,
      discussionId,
      extractionId,
      input?.kind,
      input?.kind === 'update_bubble'
        ? input.target_bubble_id
        : undefined,
    )
  ) {
    throw new Error(INVALID_RESPONSE_MESSAGE);
  }

  return value;
}

export function isKnowledgeExtractionTargetChangedError(
  value: unknown,
): value is KnowledgeExtractionTargetChangedError {
  if (
    !isRecord(value) ||
    value.code !== 'KNOWLEDGE_EXTRACTION_TARGET_CHANGED' ||
    !isNonEmptyString(value.message) ||
    !isRecord(value.current_target)
  ) {
    return false;
  }

  const target = value.current_target;

  return (
    isNonEmptyString(target.id) &&
    isNonEmptyString(target.title) &&
    (target.summary === null || typeof target.summary === 'string') &&
    isNonEmptyString(target.content) &&
    isIsoTimestamp(target.updated_at)
  );
}

export function createKnowledgeExtractionsApi(
  request: KnowledgeExtractionRequest = requestJson,
) {
  function collectionPath(
    projectId: string,
    discussionId: string,
  ): string {
    return `/projects/${encodeURIComponent(projectId)}/discussions/${encodeURIComponent(discussionId)}/knowledge-extractions`;
  }

  function resourcePath(
    projectId: string,
    discussionId: string,
    extractionId: string,
  ): string {
    return `${collectionPath(projectId, discussionId)}/${encodeURIComponent(extractionId)}`;
  }

  function createKnowledgeExtraction(
    projectId: string,
    discussionId: string,
    input: CreateKnowledgeExtractionInput,
    signal?: AbortSignal,
  ): Promise<KnowledgeExtractionProposalResponse> {
    return request<unknown>(collectionPath(projectId, discussionId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    }).then((response) =>
      assertKnowledgeExtractionProposalResponse(
        response,
        projectId,
        discussionId,
        input,
      ),
    );
  }

  function resolveKnowledgeExtraction(
    projectId: string,
    discussionId: string,
    extractionId: string,
    input: ResolveKnowledgeExtractionInput,
    signal?: AbortSignal,
  ): Promise<KnowledgeExtractionResolutionResponse> {
    return request<unknown>(
      `${resourcePath(projectId, discussionId, extractionId)}/resolution`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal,
      },
    ).then((response) =>
      assertKnowledgeExtractionResolutionResponse(
        response,
        projectId,
        discussionId,
        extractionId,
        input,
      ),
    );
  }

  function discardKnowledgeExtraction(
    projectId: string,
    discussionId: string,
    extractionId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return request<void>(
      resourcePath(projectId, discussionId, extractionId),
      {
        method: 'DELETE',
        signal,
      },
    );
  }

  return {
    createKnowledgeExtraction,
    discardKnowledgeExtraction,
    resolveKnowledgeExtraction,
  };
}

export const {
  createKnowledgeExtraction,
  discardKnowledgeExtraction,
  resolveKnowledgeExtraction,
} = createKnowledgeExtractionsApi();

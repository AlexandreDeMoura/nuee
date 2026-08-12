import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type {
  Bubble,
  CreateKnowledgeExtractionInput,
  DiscussionDetails,
  KnowledgeExtractionDetailLevel,
  KnowledgeExtractionProposal,
  KnowledgeExtractionProposalResponse,
  KnowledgeExtractionResolutionResponse,
  ResolveKnowledgeExtractionInput,
  TerritoryDestination,
} from '../api';
import {
  analytics,
  trackAnalytics,
  type AnalyticsClient,
} from '../analytics';
import {
  knowledgeExtractionGenerationMetrics,
  type KnowledgeExtractionGenerationMetrics,
} from './knowledgeExtractionAnalytics';
import {
  ApiError,
  createKnowledgeExtraction,
  discardKnowledgeExtraction,
  isKnowledgeExtractionTargetChangedError,
  resolveKnowledgeExtraction,
} from '../api';
import {
  createKnowledgeExtractionState,
  hasKnowledgeExtractionSources,
  knowledgeExtractionReducer,
  type KnowledgeExtractionBinding,
  type KnowledgeExtractionEvent,
  type KnowledgeExtractionFailure,
  type KnowledgeExtractionFieldErrors,
  type KnowledgeExtractionRequestField,
  type KnowledgeExtractionSelection,
  type KnowledgeExtractionSourceIssue,
  type KnowledgeExtractionSourceIssueReason,
  type KnowledgeExtractionState,
  type KnowledgeExtractionUpdateTarget,
} from './knowledgeExtractionStateMachine';

export type KnowledgeExtractionCreateRequest =
  typeof createKnowledgeExtraction;
export type KnowledgeExtractionDiscardRequest =
  typeof discardKnowledgeExtraction;
export type KnowledgeExtractionResolveRequest =
  typeof resolveKnowledgeExtraction;

export interface KnowledgeExtractionRequests {
  create?: KnowledgeExtractionCreateRequest;
  discard?: KnowledgeExtractionDiscardRequest;
  resolve?: KnowledgeExtractionResolveRequest;
}

export interface UseKnowledgeExtractionOptions
  extends KnowledgeExtractionBinding {
  analyticsClient?: AnalyticsClient;
  analyticsDiscussion?: DiscussionDetails | null;
  createAttemptId?: () => string;
  onResolved?: (
    response: KnowledgeExtractionResolutionResponse,
  ) => void;
  requests?: KnowledgeExtractionRequests;
}

export interface KnowledgeExtractionController {
  approveAsNewBubble: (
    destination?: TerritoryDestination,
  ) => Promise<KnowledgeExtractionResolutionResponse | null>;
  approveBubbleUpdate: () => Promise<KnowledgeExtractionResolutionResponse | null>;
  beginUpdateTargetSelection: () => void;
  cancelUpdateTargetSelection: () => void;
  discard: () => Promise<void>;
  editProposal: (
    field: keyof KnowledgeExtractionProposal,
    value: string,
  ) => void;
  generateProposal: () => Promise<KnowledgeExtractionProposalResponse | null>;
  reject: () => Promise<KnowledgeExtractionResolutionResponse | null>;
  reset: () => void;
  selectAllMessages: (messageIds: readonly string[]) => void;
  selectUpdateTarget: (bubble: Bubble) => void;
  setDetailLevel: (detailLevel: KnowledgeExtractionDetailLevel) => void;
  setInstructions: (instructions: string) => void;
  setMessageIds: (messageIds: readonly string[]) => void;
  start: (initialMessageId?: string) => boolean;
  state: KnowledgeExtractionState;
  toggleFrozenContextItem: (contextItemId: string) => void;
  toggleMessage: (messageId: string) => void;
}

const SOURCE_VALIDATION_CODES = new Set([
  'DISCUSSION_NOT_FOUND',
  'KNOWLEDGE_EXTRACTION_DISCARDED',
  'KNOWLEDGE_EXTRACTION_IDEMPOTENCY_CONFLICT',
  'KNOWLEDGE_EXTRACTION_SOURCE_INVALID',
  'KNOWLEDGE_EXTRACTION_SOURCE_TOO_LARGE',
  'KNOWLEDGE_EXTRACTION_VALIDATION_FAILED',
  'PROJECT_NOT_FOUND',
]);

const SOURCE_ISSUE_REASONS =
  new Set<KnowledgeExtractionSourceIssueReason>([
    'missing',
    'cross_project',
    'cross_discussion',
    'inaccessible',
  ]);

function createDefaultAttemptId(): string {
  return crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === 'AbortError'
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback;
}

function normalizeSourceIssues(
  value: unknown,
): KnowledgeExtractionSourceIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const issues: KnowledgeExtractionSourceIssue[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      (candidate.source_kind !== 'message' &&
        candidate.source_kind !== 'frozen_context') ||
      typeof candidate.source_id !== 'string' ||
      candidate.source_id.trim().length === 0 ||
      typeof candidate.reason !== 'string' ||
      !SOURCE_ISSUE_REASONS.has(
        candidate.reason as KnowledgeExtractionSourceIssueReason,
      )
    ) {
      continue;
    }

    const sourceId = candidate.source_id.trim();
    const key = `${candidate.source_kind}:${sourceId}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    issues.push({
      reason: candidate.reason as KnowledgeExtractionSourceIssueReason,
      sourceId,
      sourceKind: candidate.source_kind,
    });
  }

  return issues;
}

function generationFailure(
  error: unknown,
): Extract<KnowledgeExtractionFailure, { kind: 'generation' }> {
  return {
    code: error instanceof ApiError ? (error.code ?? null) : null,
    kind: 'generation',
    message: errorMessage(
      error,
      'The knowledge proposal could not be generated. Try again.',
    ),
    retryable: true,
  };
}

function sourceValidationFailure(
  error: unknown,
): Extract<
  KnowledgeExtractionFailure,
  { kind: 'source_validation' }
> {
  return {
    code: error instanceof ApiError ? (error.code ?? null) : null,
    fieldErrors:
      error instanceof ApiError
        ? normalizeFieldErrors(error.body.field_errors)
        : {},
    kind: 'source_validation',
    message: errorMessage(
      error,
      'Review the selected extraction sources before trying again.',
    ),
    retryable: false,
    sourceIssues:
      error instanceof ApiError
        ? normalizeSourceIssues(error.body.source_errors)
        : [],
  };
}

const REQUEST_FIELDS = new Set<KnowledgeExtractionRequestField>([
  'detail_level',
  'frozen_context_item_ids',
  'instructions',
  'message_ids',
]);

function normalizeFieldErrors(
  value: unknown,
): KnowledgeExtractionFieldErrors {
  if (!isRecord(value)) {
    return {};
  }

  const errors: KnowledgeExtractionFieldErrors = {};

  for (const [field, message] of Object.entries(value)) {
    if (
      REQUEST_FIELDS.has(field as KnowledgeExtractionRequestField) &&
      typeof message === 'string' &&
      message.trim().length > 0
    ) {
      errors[field as KnowledgeExtractionRequestField] = message.trim();
    }
  }

  return errors;
}

function resolutionFailure(
  error: unknown,
): Extract<KnowledgeExtractionFailure, { kind: 'resolution' }> {
  return {
    code: error instanceof ApiError ? (error.code ?? null) : null,
    kind: 'resolution',
    message: errorMessage(
      error,
      'The extraction resolution could not be saved. Try again.',
    ),
    retryable: true,
  };
}

function targetChangedFailure(
  error: ApiError,
): {
  failure: Extract<
    KnowledgeExtractionFailure,
    { kind: 'target_changed' }
  >;
  target: Omit<KnowledgeExtractionUpdateTarget, 'project_id'>;
} | null {
  if (!isKnowledgeExtractionTargetChangedError(error.body)) {
    return null;
  }

  return {
    failure: {
      code: 'KNOWLEDGE_EXTRACTION_TARGET_CHANGED',
      kind: 'target_changed',
      message: error.body.message,
      retryable: false,
    },
    target: error.body.current_target,
  };
}

function selectionInput(
  state: KnowledgeExtractionState,
): Omit<CreateKnowledgeExtractionInput, 'idempotency_key'> {
  return {
    detail_level: state.selection.detailLevel,
    frozen_context_item_ids: [
      ...state.selection.frozenContextItemIds,
    ],
    ...(state.selection.instructions.trim().length > 0
      ? { instructions: state.selection.instructions.trim() }
      : {}),
    message_ids: [...state.selection.messageIds],
  };
}

function isUnresolvedServerAttempt(
  state: KnowledgeExtractionState,
): boolean {
  return (
    state.extractionId !== null &&
    state.status !== 'idle' &&
    state.status !== 'resolved' &&
    state.status !== 'discarded'
  );
}

export function useKnowledgeExtraction({
  analyticsClient = analytics,
  analyticsDiscussion,
  createAttemptId = createDefaultAttemptId,
  discussionId,
  onResolved,
  projectId,
  requests,
}: UseKnowledgeExtractionOptions): KnowledgeExtractionController {
  const binding = { discussionId, projectId };
  const [state, setState] = useState<KnowledgeExtractionState>(() =>
    createKnowledgeExtractionState(binding),
  );
  const stateRef = useRef(state);
  const operationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const requestsRef = useRef({
    create: requests?.create ?? createKnowledgeExtraction,
    discard: requests?.discard ?? discardKnowledgeExtraction,
    resolve: requests?.resolve ?? resolveKnowledgeExtraction,
  });
  const createAttemptIdRef = useRef(createAttemptId);
  const onResolvedRef = useRef(onResolved);
  const analyticsClientRef = useRef(analyticsClient);
  const analyticsDiscussionRef = useRef(analyticsDiscussion);
  const generationMetricsRef = useRef<{
    key: string;
    metrics: KnowledgeExtractionGenerationMetrics;
  } | null>(null);

  useEffect(() => {
    requestsRef.current = {
      create: requests?.create ?? createKnowledgeExtraction,
      discard: requests?.discard ?? discardKnowledgeExtraction,
      resolve: requests?.resolve ?? resolveKnowledgeExtraction,
    };
    createAttemptIdRef.current = createAttemptId;
    onResolvedRef.current = onResolved;
    analyticsClientRef.current = analyticsClient;
    analyticsDiscussionRef.current = analyticsDiscussion;
  }, [
    analyticsClient,
    analyticsDiscussion,
    createAttemptId,
    onResolved,
    requests?.create,
    requests?.discard,
    requests?.resolve,
  ]);

  const transition = useCallback(
    (event: KnowledgeExtractionEvent): KnowledgeExtractionState => {
      const current = stateRef.current;
      const next = knowledgeExtractionReducer(current, event);

      if (next !== current) {
        stateRef.current = next;
        setState(next);
      }

      return next;
    },
    [],
  );

  const abortCurrentOperation = useCallback(() => {
    operationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const bestEffortDiscard = useCallback(
    (attempt: KnowledgeExtractionState) => {
      if (!isUnresolvedServerAttempt(attempt) || !attempt.extractionId) {
        return;
      }

      void requestsRef.current
        .discard(
          attempt.projectId,
          attempt.discussionId,
          attempt.extractionId,
        )
        .catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    const scopedBinding = { discussionId, projectId };

    if (
      stateRef.current.projectId !== projectId ||
      stateRef.current.discussionId !== discussionId
    ) {
      transition({
        binding: scopedBinding,
        type: 'binding_changed',
      });
    }

    return () => {
      const current = stateRef.current;

      if (
        current.projectId === scopedBinding.projectId &&
        current.discussionId === scopedBinding.discussionId
      ) {
        abortCurrentOperation();
        bestEffortDiscard(current);
      }
    };
  }, [
    abortCurrentOperation,
    bestEffortDiscard,
    discussionId,
    projectId,
    transition,
  ]);

  const currentBindingMatches = useCallback(
    (current: KnowledgeExtractionState) =>
      current.projectId === projectId &&
      current.discussionId === discussionId,
    [discussionId, projectId],
  );

  const start = useCallback(
    (initialMessageId?: string) => {
      const current = stateRef.current;

      if (!currentBindingMatches(current)) {
        return false;
      }

      const next = transition({
        initialMessageId,
        type: 'start',
      });

      return next !== current && next.status === 'selecting';
    },
    [currentBindingMatches, transition],
  );

  const updateSelection = useCallback(
    (
      createSelection: (
        current: KnowledgeExtractionSelection,
      ) => KnowledgeExtractionSelection,
      selectAllUsed = false,
    ) => {
      const current = stateRef.current;

      if (!currentBindingMatches(current)) {
        return;
      }

      transition({
        selection: createSelection(current.selection),
        selectAllUsed,
        type: 'selection_changed',
      });
    },
    [currentBindingMatches, transition],
  );

  const toggleMessage = useCallback(
    (messageId: string) => {
      const normalizedId = messageId.trim();

      if (normalizedId.length === 0) {
        return;
      }

      updateSelection((current) => {
        const currentIds = current.messageIds;
        const nextIds = currentIds.includes(normalizedId)
          ? currentIds.filter((identifier) => identifier !== normalizedId)
          : [...currentIds, normalizedId];

        return {
          ...current,
          messageIds: nextIds,
        };
      });
    },
    [updateSelection],
  );

  const setMessageIds = useCallback(
    (messageIds: readonly string[]) => {
      updateSelection((current) => ({
        ...current,
        messageIds: [...messageIds],
      }));
    },
    [updateSelection],
  );

  const selectAllMessages = useCallback(
    (messageIds: readonly string[]) => {
      updateSelection(
        (current) => ({
          ...current,
          messageIds: [...messageIds],
        }),
        true,
      );
    },
    [updateSelection],
  );

  const setInstructions = useCallback(
    (instructions: string) => {
      updateSelection((current) => ({
        ...current,
        instructions,
      }));
    },
    [updateSelection],
  );

  const setDetailLevel = useCallback(
    (detailLevel: KnowledgeExtractionDetailLevel) => {
      updateSelection((current) => ({
        ...current,
        detailLevel,
      }));
    },
    [updateSelection],
  );

  const toggleFrozenContextItem = useCallback(
    (contextItemId: string) => {
      const normalizedId = contextItemId.trim();

      if (normalizedId.length === 0) {
        return;
      }

      updateSelection((current) => ({
        ...current,
        frozenContextItemIds: current.frozenContextItemIds.includes(
          normalizedId,
        )
          ? current.frozenContextItemIds.filter(
              (identifier) => identifier !== normalizedId,
            )
          : [...current.frozenContextItemIds, normalizedId],
      }));
    },
    [updateSelection],
  );

  const generateProposal = useCallback(async () => {
    const current = stateRef.current;

    if (
      !currentBindingMatches(current) ||
      (current.status !== 'selecting' &&
        current.status !== 'generation_failed')
    ) {
      return null;
    }

    if (!hasKnowledgeExtractionSources(current.selection)) {
      transition({
        failure: {
          code: 'KNOWLEDGE_EXTRACTION_SELECTION_REQUIRED',
          fieldErrors: {
            message_ids:
              'Select at least one completed message or frozen context item.',
          },
          kind: 'source_validation',
          message:
            'Select at least one completed message or frozen context item.',
          retryable: false,
          sourceIssues: [],
        },
        type: 'selection_invalid',
      });
      return null;
    }

    const attemptId =
      current.attemptId ?? createAttemptIdRef.current();
    const generating = transition({
      attemptId,
      type: 'generation_started',
    });

    if (generating.status !== 'generating') {
      return null;
    }

    abortCurrentOperation();
    const operation = operationRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const input: CreateKnowledgeExtractionInput = {
      idempotency_key: attemptId,
      ...selectionInput(generating),
    };
    const startedAt = Date.now();
    const generationMetricsKey = `${attemptId}:${generating.selectionFingerprint}:${generating.selectAllUsed}`;
    const generationMetrics =
      generationMetricsRef.current?.key === generationMetricsKey
        ? generationMetricsRef.current.metrics
        : knowledgeExtractionGenerationMetrics(
            analyticsDiscussionRef.current?.id === discussionId &&
              analyticsDiscussionRef.current.project_id === projectId
              ? analyticsDiscussionRef.current
              : null,
            generating.selection,
            generating.selectAllUsed,
          );

    generationMetricsRef.current = {
      key: generationMetricsKey,
      metrics: generationMetrics,
    };
    const trackGeneration = (
      status:
        | 'succeeded'
        | 'failed'
        | 'source_invalid',
    ) => {
      trackAnalytics(
        analyticsClientRef.current,
        'knowledge_extraction_generation_finished',
        {
          project_id: projectId,
          discussion_id: discussionId,
          ...generationMetrics,
          status,
          latency_ms: Math.max(0, Date.now() - startedAt),
          retry_count: generating.retryCount,
          occurred_at: new Date().toISOString(),
        },
      );
    };

    try {
      const response = await requestsRef.current.create(
        projectId,
        discussionId,
        input,
        controller.signal,
      );

      if (
        controller.signal.aborted ||
        operationRef.current !== operation ||
        stateRef.current.status !== 'generating' ||
        stateRef.current.attemptId !== attemptId ||
        !currentBindingMatches(stateRef.current)
      ) {
        return null;
      }

      transition({
        extractionId: response.id,
        proposal: response.proposal,
        type: 'generation_succeeded',
      });
      trackGeneration('succeeded');
      return response;
    } catch (error: unknown) {
      if (
        controller.signal.aborted ||
        operationRef.current !== operation ||
        isAbort(error) ||
        !currentBindingMatches(stateRef.current)
      ) {
        return null;
      }

      if (
        error instanceof ApiError &&
        error.code !== undefined &&
        SOURCE_VALIDATION_CODES.has(error.code)
      ) {
        transition({
          failure: sourceValidationFailure(error),
          type: 'source_invalid',
        });
        trackGeneration('source_invalid');
      } else {
        transition({
          failure: generationFailure(error),
          type: 'generation_failed',
        });
        trackGeneration('failed');
      }

      return null;
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, [
    abortCurrentOperation,
    currentBindingMatches,
    discussionId,
    projectId,
    transition,
  ]);

  const editProposal = useCallback(
    (
      field: keyof KnowledgeExtractionProposal,
      value: string,
    ) => {
      transition({
        field,
        type: 'proposal_edited',
        value,
      });
    },
    [transition],
  );

  const beginUpdateTargetSelection = useCallback(() => {
    transition({ type: 'update_target_selection_started' });
  }, [transition]);

  const cancelUpdateTargetSelection = useCallback(() => {
    transition({ type: 'update_target_selection_cancelled' });
  }, [transition]);

  const selectUpdateTarget = useCallback(
    (bubble: Bubble) => {
      if (bubble.project_id !== projectId) {
        return;
      }

      transition({
        target: {
          content: bubble.content,
          id: bubble.id,
          project_id: bubble.project_id,
          summary: bubble.summary,
          title: bubble.title,
          updated_at: bubble.updated_at,
        },
        type: 'update_target_selected',
      });
    },
    [projectId, transition],
  );

  const runResolution = useCallback(
    async (
      input: ResolveKnowledgeExtractionInput,
      savingEvent:
        | Extract<
            KnowledgeExtractionEvent,
            { type: 'new_bubble_save_started' }
          >
        | Extract<
            KnowledgeExtractionEvent,
            { type: 'bubble_update_save_started' }
          >
        | null,
    ): Promise<KnowledgeExtractionResolutionResponse | null> => {
      const beforeSaving = stateRef.current;

      if (
        !currentBindingMatches(beforeSaving) ||
        beforeSaving.status !== 'reviewing' ||
        !beforeSaving.extractionId
      ) {
        return null;
      }

      const saving = savingEvent
        ? transition(savingEvent)
        : beforeSaving;
      const expectedStatus =
        input.kind === 'new_bubble'
          ? 'saving_new'
          : input.kind === 'update_bubble'
            ? 'saving_update'
            : 'reviewing';

      if (saving.status !== expectedStatus) {
        return null;
      }

      abortCurrentOperation();
      const operation = operationRef.current;
      const controller = new AbortController();
      controllerRef.current = controller;
      const extractionId = beforeSaving.extractionId;
      const startedAt = Date.now();
      const trackResolution = (
        status: 'succeeded' | 'failed' | 'target_changed',
      ) => {
        trackAnalytics(
          analyticsClientRef.current,
          'knowledge_extraction_resolution_finished',
          {
            project_id: projectId,
            discussion_id: discussionId,
            resolution: input.kind,
            status,
            latency_ms: Math.max(0, Date.now() - startedAt),
            occurred_at: new Date().toISOString(),
          },
        );
      };

      try {
        const response = await requestsRef.current.resolve(
          projectId,
          discussionId,
          extractionId,
          input,
          controller.signal,
        );

        if (
          controller.signal.aborted ||
          operationRef.current !== operation ||
          stateRef.current.status !== expectedStatus ||
          stateRef.current.extractionId !== extractionId ||
          !currentBindingMatches(stateRef.current)
        ) {
          return null;
        }

        const resolved = transition({
          resolution: response,
          type: 'resolved',
        });

        if (resolved.status !== 'resolved') {
          return null;
        }

        trackResolution('succeeded');
        if (
          input.kind === 'new_bubble' &&
          response.resolution.kind === 'new_bubble'
        ) {
          const destination = input.destination ?? {
            kind: 'ungrouped' as const,
          };

          trackAnalytics(
            analyticsClientRef.current,
            'territory_destination_selected',
            {
              project_id: projectId,
              source: 'extraction',
              destination_kind: destination.kind,
            },
          );

          if (destination.kind === 'new') {
            trackAnalytics(
              analyticsClientRef.current,
              'territory_created',
              {
                project_id: projectId,
                territory_id: response.resolution.bubble.territory_id,
                source: 'extraction',
              },
            );
          }
        }
        onResolvedRef.current?.(response);
        return response;
      } catch (error: unknown) {
        if (
          controller.signal.aborted ||
          operationRef.current !== operation ||
          isAbort(error) ||
          !currentBindingMatches(stateRef.current)
        ) {
          return null;
        }

        if (
          input.kind === 'update_bubble' &&
          error instanceof ApiError
        ) {
          const changed = targetChangedFailure(error);

          if (changed) {
            transition({
              failure: changed.failure,
              target: {
                ...changed.target,
                project_id: projectId,
              },
              type: 'update_target_changed',
            });
            trackResolution('target_changed');
            return null;
          }
        }

        transition({
          failure: resolutionFailure(error),
          type: 'resolution_failed',
        });
        trackResolution('failed');
        return null;
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
      }
    },
    [
      abortCurrentOperation,
      currentBindingMatches,
      discussionId,
      projectId,
      transition,
    ],
  );

  const approveAsNewBubble = useCallback(
    (destination: TerritoryDestination = { kind: 'ungrouped' }) => {
      const current = stateRef.current;

      if (current.status !== 'reviewing' || !current.proposal) {
        return Promise.resolve(null);
      }

      return runResolution(
        {
          destination,
          kind: 'new_bubble',
          proposal: { ...current.proposal },
        },
        { type: 'new_bubble_save_started' },
      );
    },
    [runResolution],
  );

  const approveBubbleUpdate = useCallback(() => {
    const current = stateRef.current;

    if (
      current.status !== 'reviewing' ||
      !current.proposal ||
      !current.target
    ) {
      return Promise.resolve(null);
    }

    return runResolution(
      {
        expected_updated_at: current.target.updated_at,
        kind: 'update_bubble',
        proposal: { ...current.proposal },
        target_bubble_id: current.target.id,
      },
      { type: 'bubble_update_save_started' },
    );
  }, [runResolution]);

  const reject = useCallback(() => {
    return runResolution({ kind: 'reject' }, null);
  }, [runResolution]);

  const discard = useCallback(async () => {
    const current = stateRef.current;

    if (
      !currentBindingMatches(current) ||
      current.status === 'idle' ||
      current.status === 'resolved' ||
      current.status === 'discarded'
    ) {
      return;
    }

    abortCurrentOperation();
    transition({ type: 'discarded' });

    if (!current.extractionId) {
      return;
    }

    try {
      await requestsRef.current.discard(
        current.projectId,
        current.discussionId,
        current.extractionId,
      );
    } catch {
      // Attempts expire server-side, so closing the transient client flow does
      // not depend on a best-effort discard request succeeding.
    }
  }, [abortCurrentOperation, currentBindingMatches, transition]);

  const reset = useCallback(() => {
    transition({ type: 'reset' });
  }, [transition]);

  return {
    approveAsNewBubble,
    approveBubbleUpdate,
    beginUpdateTargetSelection,
    cancelUpdateTargetSelection,
    discard,
    editProposal,
    generateProposal,
    reject,
    reset,
    selectAllMessages,
    selectUpdateTarget,
    setDetailLevel,
    setInstructions,
    setMessageIds,
    start,
    state,
    toggleFrozenContextItem,
    toggleMessage,
  };
}

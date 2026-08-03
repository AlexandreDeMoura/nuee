import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ApiError,
  createDiscussion,
  generateDiscussionTitle,
  getAiCapabilities,
  getDiscussion,
  retryDiscussionMessage,
  sendDiscussionMessage,
  type CreateDiscussionInput,
  type DiscussionContextSelectionInput,
  type DiscussionDetails,
} from '../api';
import {
  analytics,
  trackAnalytics,
  type AnalyticsClient,
} from '../analytics';
import type { VisibleDiscussion } from './useDiscussionVisibility';
import {
  assertDiscussionDetails,
  isDiscussionGenerationFailureCode,
  isTemporaryDiscussionTitle,
  TEMPORARY_DISCUSSION_TITLE,
  type DiscussionGenerationFailureCode,
  type RecoveredDiscussionTurn,
} from './discussionModel';
import {
  normalizeDiscussionCreationFailure,
  type DiscussionCreationFailure,
} from './discussionCreationFailure';

export type DiscussionCreateRequest = typeof createDiscussion;
export type DiscussionCapabilitiesRequest = typeof getAiCapabilities;
export type DiscussionGetRequest = typeof getDiscussion;
export type DiscussionMessageRequest = typeof sendDiscussionMessage;
export type DiscussionTitleRequest = typeof generateDiscussionTitle;

export interface DiscussionLifecycleRequests {
  capabilities?: DiscussionCapabilitiesRequest;
  create?: DiscussionCreateRequest;
  generateTitle?: DiscussionTitleRequest;
  get?: DiscussionGetRequest;
  retry?: DiscussionMessageRequest;
  send?: DiscussionMessageRequest;
}

export interface PendingDiscussionTurn {
  content: string;
  discussionId: string | null;
  failureCode?: DiscussionGenerationFailureCode;
  requestId: string;
  status: 'pending' | 'failed';
  webSearch: boolean;
}

type DiscussionLoadStatus = 'draft' | 'loading' | 'ready' | 'error';

export interface DiscussionLifecycle {
  composerError: string | null;
  composerValue: string;
  creationFailure: DiscussionCreationFailure | null;
  details: DiscussionDetails | null;
  isSubmitting: boolean;
  loadError: string | null;
  loadStatus: DiscussionLoadStatus;
  onComposerChange: (value: string) => void;
  pendingTurn: PendingDiscussionTurn | null;
  retryFailedTurn: (turn: PendingDiscussionTurn) => void;
  submit: (
    selection?: DiscussionContextSelectionInput,
    selectionRevision?: number,
  ) => void;
  setWebSearchEnabled: (enabled: boolean) => void;
  webSearchEnabled: boolean;
  webSearchSupported: boolean;
}

interface UseDiscussionLifecycleOptions {
  analyticsClient?: AnalyticsClient;
  onDiscussionCreated: (discussion: {
    id: string;
    recoveredTurn?: RecoveredDiscussionTurn;
    title: string;
  }) => void;
  onDiscussionChanged?: (discussion: DiscussionDetails) => void;
  onDraftPromptChange: (prompt: string) => void;
  projectId: string;
  requests?: DiscussionLifecycleRequests;
  visibleDiscussion: VisibleDiscussion;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function recoveryIdentifiers(error: unknown): {
  discussionId: string;
  failureCode: DiscussionGenerationFailureCode;
  requestId: string;
} | null {
  if (
    !(error instanceof ApiError) ||
    !isDiscussionGenerationFailureCode(error.code)
  ) {
    return null;
  }

  const discussionId = error.body.discussion_id;
  const requestId = error.body.request_id;

  return typeof discussionId === 'string' &&
    discussionId.length > 0 &&
    typeof requestId === 'string' &&
    requestId.length > 0
    ? { discussionId, failureCode: error.code, requestId }
    : null;
}

function generationFailureCode(
  error: unknown,
): DiscussionGenerationFailureCode | null {
  return error instanceof ApiError &&
    isDiscussionGenerationFailureCode(error.code)
    ? error.code
    : null;
}

function createRequestId(): string {
  return crypto.randomUUID();
}

const EMPTY_CONTEXT_SELECTION: DiscussionContextSelectionInput = {
  bubble_ids: [],
  document_ids: [],
};

function normalizeSelection(
  selection: DiscussionContextSelectionInput,
): DiscussionContextSelectionInput {
  return {
    bubble_ids: [...new Set(selection.bubble_ids)],
    document_ids: [...new Set(selection.document_ids)],
  };
}

function selectionFingerprint(
  selection: DiscussionContextSelectionInput,
): string {
  return JSON.stringify([
    selection.bubble_ids,
    selection.document_ids,
  ]);
}

function occurredAt(): string {
  return new Date().toISOString();
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function firstUserMessage(discussion: DiscussionDetails) {
  return discussion.messages.find((message) => message.role === 'user');
}

function completedResponse(
  discussion: DiscussionDetails,
  requestId: string,
) {
  const userMessageIndex = discussion.messages.findIndex(
    (message) =>
      message.role === 'user' &&
      message.request_id === requestId &&
      message.status === 'completed',
  );

  if (userMessageIndex < 0) {
    return null;
  }

  return (
    discussion.messages
      .slice(userMessageIndex + 1)
      .find(
        (message) =>
          message.role === 'assistant' && message.status === 'completed',
      ) ?? null
  );
}

function responseSearchAnalytics(
  response: NonNullable<ReturnType<typeof completedResponse>>,
  webSearchRequested: boolean,
) {
  return {
    citation_count: Array.isArray(response.citations)
      ? response.citations.length
      : 0,
    web_search_requested: webSearchRequested,
    web_search_used: response.web_search_used === true,
  };
}

function hasCompletedExchange(discussion: DiscussionDetails): boolean {
  return (
    discussion.messages.some(
      (message) =>
        message.role === 'user' && message.status === 'completed',
    ) &&
    discussion.messages.some(
      (message) =>
        message.role === 'assistant' && message.status === 'completed',
    )
  );
}

export function useDiscussionLifecycle({
  analyticsClient = analytics,
  onDiscussionCreated,
  onDiscussionChanged,
  onDraftPromptChange,
  projectId,
  requests,
  visibleDiscussion,
}: UseDiscussionLifecycleOptions): DiscussionLifecycle {
  const capabilitiesRequest = requests?.capabilities ?? getAiCapabilities;
  const createRequest = requests?.create ?? createDiscussion;
  const generateTitleRequest =
    requests?.generateTitle ?? generateDiscussionTitle;
  const getRequest = requests?.get ?? getDiscussion;
  const retryRequest = requests?.retry ?? retryDiscussionMessage;
  const sendRequest = requests?.send ?? sendDiscussionMessage;
  const [details, setDetails] = useState<DiscussionDetails | null>(null);
  const [loadStatus, setLoadStatus] = useState<DiscussionLoadStatus>(
    visibleDiscussion.kind === 'draft' ? 'draft' : 'loading',
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [composerValue, setComposerValue] = useState('');
  const [composerError, setComposerError] = useState<string | null>(null);
  const [creationFailure, setCreationFailure] =
    useState<DiscussionCreationFailure | null>(null);
  const [pendingTurn, setPendingTurn] =
    useState<PendingDiscussionTurn | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [webSearchEnabled, setWebSearchEnabledState] = useState(false);
  const [webSearchSupported, setWebSearchSupported] = useState(false);
  const detailsRef = useRef(details);
  const submittingRef = useRef(false);
  const operationRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const capabilitiesControllerRef = useRef<AbortController | null>(null);
  const titleControllerRef = useRef<AbortController | null>(null);
  const titleAttemptRef = useRef<string | null>(null);
  const creationAttemptRef = useRef<{
    content: string;
    requestId: string;
    selectionFingerprint: string;
    selectionRevision: number | null;
    webSearch: boolean;
  } | null>(null);
  const retainedAttemptRef = useRef<{
    content: string;
    requestId: string;
    webSearch: boolean;
  } | null>(null);
  const persistedDiscussionId =
    visibleDiscussion.kind === 'persisted'
      ? visibleDiscussion.discussionId
      : null;
  const recoveredTurn =
    visibleDiscussion.kind === 'persisted'
      ? visibleDiscussion.recoveredTurn
      : undefined;

  useEffect(() => {
    const controller = new AbortController();
    capabilitiesControllerRef.current = controller;

    capabilitiesRequest(controller.signal)
      .then((capabilities) => {
        if (controller.signal.aborted) {
          return;
        }

        setWebSearchSupported(capabilities.web_search);

        if (!capabilities.web_search) {
          setWebSearchEnabledState(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setWebSearchSupported(false);
          setWebSearchEnabledState(false);
        }
      });

    return () => controller.abort();
  }, [capabilitiesRequest]);

  const setWebSearchEnabled = useCallback(
    (enabled: boolean) => {
      setWebSearchEnabledState(webSearchSupported && enabled);
      setComposerError(null);
      setCreationFailure(null);
    },
    [webSearchSupported],
  );

  const updateDetails = useCallback((next: DiscussionDetails | null) => {
    detailsRef.current = next;
    setDetails(next);
  }, []);

  const updatePendingTurn = useCallback(
    (next: PendingDiscussionTurn | null) => {
      setPendingTurn(next);
    },
    [],
  );

  const generateTitleIfNeeded = useCallback(
    (discussion: DiscussionDetails) => {
      if (
        !isTemporaryDiscussionTitle(discussion.title) ||
        !hasCompletedExchange(discussion) ||
        titleAttemptRef.current === discussion.id
      ) {
        return;
      }

      titleControllerRef.current?.abort();
      const controller = new AbortController();
      const discussionId = discussion.id;
      const startedAt = performance.now();
      titleControllerRef.current = controller;
      titleAttemptRef.current = discussionId;

      generateTitleRequest(projectId, discussionId, controller.signal)
        .then((response) => {
          if (
            controller.signal.aborted ||
            titleAttemptRef.current !== discussionId
          ) {
            return;
          }

          const titled = assertDiscussionDetails(
            response,
            projectId,
            discussionId,
          );

          if (detailsRef.current?.id !== discussionId) {
            return;
          }

          updateDetails(titled);
          onDiscussionChanged?.(titled);
          trackAnalytics(analyticsClient, 'discussion_title_generated', {
            project_id: projectId,
            discussion_id: discussionId,
            occurred_at: occurredAt(),
            latency_ms: elapsedMilliseconds(startedAt),
          });
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            trackAnalytics(
              analyticsClient,
              'discussion_title_generation_failed',
              {
                project_id: projectId,
                discussion_id: discussionId,
                occurred_at: occurredAt(),
                latency_ms: elapsedMilliseconds(startedAt),
              },
            );
          }

          // Title generation is intentionally non-blocking. The deterministic
          // placeholder remains visible and a later load/message can retry.
        })
        .finally(() => {
          if (titleAttemptRef.current === discussionId) {
            titleAttemptRef.current = null;
          }
        });
    },
    [
      analyticsClient,
      generateTitleRequest,
      onDiscussionChanged,
      projectId,
      updateDetails,
    ],
  );

  useEffect(() => {
    if (persistedDiscussionId === null) {
      return;
    }

    const controller = new AbortController();
    requestControllerRef.current = controller;
    operationRef.current += 1;
    const operation = operationRef.current;

    getRequest(projectId, persistedDiscussionId, controller.signal)
      .then((response) => {
        if (
          controller.signal.aborted ||
          operation !== operationRef.current
        ) {
          return;
        }

        const next = assertDiscussionDetails(
          response,
          projectId,
          persistedDiscussionId,
        );
        updateDetails(next);
        onDiscussionChanged?.(next);
        const recoveredMessage = recoveredTurn
          ? next.messages.find(
              (message) =>
                message.role === 'user' &&
                message.request_id === recoveredTurn.requestId &&
                message.status === 'failed',
            )
          : undefined;

        if (recoveredMessage && recoveredTurn) {
          updatePendingTurn({
            content: recoveredMessage.content,
            discussionId: persistedDiscussionId,
            failureCode: recoveredTurn.failureCode,
            requestId: recoveredTurn.requestId,
            status: 'failed',
            webSearch: recoveredTurn.webSearch,
          });
        }

        setLoadStatus('ready');
        setLoadError(null);
        generateTitleIfNeeded(next);
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          operation !== operationRef.current ||
          isAbort(error)
        ) {
          return;
        }

        updateDetails(null);
        setLoadStatus('error');
        setLoadError(
          errorMessage(error, 'The discussion could not be loaded.'),
        );
      });

    return () => controller.abort();
  }, [
    getRequest,
    generateTitleIfNeeded,
    onDiscussionChanged,
    persistedDiscussionId,
    projectId,
    recoveredTurn,
    updateDetails,
    updatePendingTurn,
  ]);

  useEffect(
    () => () => {
      operationRef.current += 1;
      requestControllerRef.current?.abort();
      capabilitiesControllerRef.current?.abort();
      titleControllerRef.current?.abort();
    },
    [],
  );

  const onComposerChange = useCallback(
    (value: string) => {
      setComposerError(null);
      setCreationFailure(null);

      if (
        retainedAttemptRef.current &&
        retainedAttemptRef.current.content !== value.trim()
      ) {
        retainedAttemptRef.current = null;
      }

      if (visibleDiscussion.kind === 'draft') {
        if (
          creationAttemptRef.current &&
          creationAttemptRef.current.content !== value.trim()
        ) {
          creationAttemptRef.current = null;
        }

        onDraftPromptChange(value);
      } else {
        setComposerValue(value);
      }
    },
    [onDraftPromptChange, visibleDiscussion.kind],
  );

  const beginRequest = useCallback(() => {
    submittingRef.current = true;
    setIsSubmitting(true);
    setComposerError(null);
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    operationRef.current += 1;
    return { controller, operation: operationRef.current };
  }, []);

  const finishRequest = useCallback((operation: number) => {
    if (operation !== operationRef.current) {
      return false;
    }

    submittingRef.current = false;
    setIsSubmitting(false);
    return true;
  }, []);

  const submitDraft = useCallback(
    async (
      content: string,
      requestedSelection: DiscussionContextSelectionInput,
      selectionRevision: number | undefined,
      webSearch: boolean,
    ) => {
      const selection = normalizeSelection(requestedSelection);
      const fingerprint = selectionFingerprint(selection);
      const normalizedSelectionRevision = selectionRevision ?? null;
      const retainedAttempt = creationAttemptRef.current;
      const requestId =
        retainedAttempt?.content === content &&
        retainedAttempt.selectionFingerprint === fingerprint &&
        retainedAttempt.selectionRevision === normalizedSelectionRevision &&
        retainedAttempt.webSearch === webSearch
          ? retainedAttempt.requestId
          : createRequestId();
      const input: CreateDiscussionInput = {
        project_id: projectId,
        first_prompt: content,
        idempotency_key: requestId,
        ...selection,
        ...(webSearch ? { web_search: true } : {}),
      };
      creationAttemptRef.current = {
        content,
        requestId,
        selectionFingerprint: fingerprint,
        selectionRevision: normalizedSelectionRevision,
        webSearch,
      };
      setCreationFailure(null);
      const startedAt = performance.now();
      const { controller, operation } = beginRequest();
      const optimisticTurn: PendingDiscussionTurn = {
        content,
        discussionId: null,
        requestId,
        status: 'pending',
        webSearch,
      };
      updatePendingTurn(optimisticTurn);

      try {
        const response = await createRequest(
          projectId,
          input,
          controller.signal,
        );

        if (!finishRequest(operation) || controller.signal.aborted) {
          return;
        }

        const next = assertDiscussionDetails(
          response,
          projectId,
          undefined,
          input,
        );
        const firstMessage = firstUserMessage(next);
        creationAttemptRef.current = null;
        trackAnalytics(analyticsClient, 'discussion_created', {
          project_id: projectId,
          discussion_id: next.id,
          occurred_at: next.created_at,
        });

        if (firstMessage?.request_id) {
          trackAnalytics(
            analyticsClient,
            'discussion_first_prompt_submitted',
            {
              project_id: projectId,
              discussion_id: next.id,
              request_id: firstMessage.request_id,
              occurred_at: firstMessage.created_at,
            },
          );

          const assistantResponse = completedResponse(
            next,
            firstMessage.request_id,
          );

          if (assistantResponse) {
            trackAnalytics(
              analyticsClient,
              'discussion_response_completed',
              {
                project_id: projectId,
                discussion_id: next.id,
                request_id: firstMessage.request_id,
                occurred_at: assistantResponse.created_at,
                latency_ms: elapsedMilliseconds(startedAt),
                ...responseSearchAnalytics(assistantResponse, webSearch),
              },
            );
          }
        }

        updateDetails(next);
        onDiscussionChanged?.(next);
        updatePendingTurn(null);
        setLoadStatus('ready');
        onDiscussionCreated({ id: next.id, title: next.title });
      } catch (error: unknown) {
        if (
          controller.signal.aborted ||
          operation !== operationRef.current ||
          isAbort(error)
        ) {
          return;
        }

        finishRequest(operation);
        const recovery = recoveryIdentifiers(error);

        if (recovery) {
          creationAttemptRef.current = null;
          const failureOccurredAt = occurredAt();
          trackAnalytics(analyticsClient, 'discussion_created', {
            project_id: projectId,
            discussion_id: recovery.discussionId,
            occurred_at: failureOccurredAt,
          });
          trackAnalytics(
            analyticsClient,
            'discussion_first_prompt_submitted',
            {
              project_id: projectId,
              discussion_id: recovery.discussionId,
              request_id: recovery.requestId,
              occurred_at: failureOccurredAt,
            },
          );
          trackAnalytics(
            analyticsClient,
            'discussion_response_failed',
            {
              project_id: projectId,
              discussion_id: recovery.discussionId,
              request_id: recovery.requestId,
              occurred_at: failureOccurredAt,
              latency_ms: elapsedMilliseconds(startedAt),
              web_search_requested: webSearch,
              web_search_used: false,
              citation_count: 0,
            },
          );
          updatePendingTurn({
            content,
            discussionId: recovery.discussionId,
            failureCode: recovery.failureCode,
            requestId: recovery.requestId,
            status: 'failed',
            webSearch,
          });
          setComposerValue('');
          onDiscussionCreated({
            id: recovery.discussionId,
            recoveredTurn: {
              failureCode: recovery.failureCode,
              requestId: recovery.requestId,
              webSearch,
            },
            title: TEMPORARY_DISCUSSION_TITLE,
          });
          return;
        }

        updatePendingTurn(null);
        const failure = normalizeDiscussionCreationFailure(error);
        setCreationFailure(failure);
        setComposerError(failure.message);
      }
    },
    [
      analyticsClient,
      beginRequest,
      createRequest,
      finishRequest,
      onDiscussionCreated,
      onDiscussionChanged,
      projectId,
      updateDetails,
      updatePendingTurn,
    ],
  );

  const submitMessage = useCallback(
    async (content: string, webSearch: boolean) => {
      if (visibleDiscussion.kind !== 'persisted' || !detailsRef.current) {
        return;
      }

      const discussionId = visibleDiscussion.discussionId;
      const retainedAttempt = retainedAttemptRef.current;
      const requestId =
        retainedAttempt?.content === content &&
        retainedAttempt.webSearch === webSearch
          ? retainedAttempt.requestId
          : createRequestId();
      retainedAttemptRef.current = { content, requestId, webSearch };
      const startedAt = performance.now();
      const { controller, operation } = beginRequest();
      updatePendingTurn({
        content,
        discussionId,
        requestId,
        status: 'pending',
        webSearch,
      });

      try {
        const response = await sendRequest(
          projectId,
          discussionId,
          {
            content,
            idempotency_key: requestId,
            ...(webSearch ? { web_search: true } : {}),
          },
          controller.signal,
        );

        if (!finishRequest(operation) || controller.signal.aborted) {
          return;
        }

        const next = assertDiscussionDetails(
          response,
          projectId,
          discussionId,
        );
        retainedAttemptRef.current = null;
        updateDetails(next);
        onDiscussionChanged?.(next);
        updatePendingTurn(null);
        setComposerValue('');
        setWebSearchEnabledState(false);
        const assistantResponse = completedResponse(next, requestId);

        if (assistantResponse) {
          trackAnalytics(
            analyticsClient,
            'discussion_response_completed',
            {
              project_id: projectId,
              discussion_id: discussionId,
              request_id: requestId,
              occurred_at: assistantResponse.created_at,
              latency_ms: elapsedMilliseconds(startedAt),
              ...responseSearchAnalytics(assistantResponse, webSearch),
            },
          );
        }

        generateTitleIfNeeded(next);
      } catch (error: unknown) {
        if (
          controller.signal.aborted ||
          operation !== operationRef.current ||
          isAbort(error)
        ) {
          return;
        }

        finishRequest(operation);

        const failureCode = generationFailureCode(error);

        if (failureCode) {
          retainedAttemptRef.current = null;
          updatePendingTurn({
            content,
            discussionId,
            failureCode,
            requestId,
            status: 'failed',
            webSearch,
          });
          setComposerValue('');
          trackAnalytics(analyticsClient, 'discussion_response_failed', {
            project_id: projectId,
            discussion_id: discussionId,
            request_id: requestId,
            occurred_at: occurredAt(),
            latency_ms: elapsedMilliseconds(startedAt),
            web_search_requested: webSearch,
            web_search_used: false,
            citation_count: 0,
          });
          return;
        }

        updatePendingTurn(null);
        setComposerError(
          errorMessage(error, 'The message could not be sent.'),
        );
      }
    },
    [
      analyticsClient,
      beginRequest,
      finishRequest,
      generateTitleIfNeeded,
      onDiscussionChanged,
      projectId,
      sendRequest,
      updateDetails,
      updatePendingTurn,
      visibleDiscussion,
    ],
  );

  const submit = useCallback(
    (
      selection: DiscussionContextSelectionInput = EMPTY_CONTEXT_SELECTION,
      selectionRevision?: number,
    ) => {
      if (submittingRef.current) {
        return;
      }

      const value =
        visibleDiscussion.kind === 'draft'
          ? visibleDiscussion.prompt
          : composerValue;
      const content = value.trim();

      if (content.length === 0) {
        return;
      }

      if (visibleDiscussion.kind === 'draft') {
        void submitDraft(
          content,
          selection,
          selectionRevision,
          webSearchEnabled,
        );
      } else {
        void submitMessage(content, webSearchEnabled);
      }
    },
    [
      composerValue,
      submitDraft,
      submitMessage,
      visibleDiscussion,
      webSearchEnabled,
    ],
  );

  const retryFailedTurn = useCallback(
    (turn: PendingDiscussionTurn) => {
      if (
        submittingRef.current ||
        visibleDiscussion.kind !== 'persisted' ||
        turn.status !== 'failed' ||
        turn.discussionId !== visibleDiscussion.discussionId
      ) {
        return;
      }

      const retry = async () => {
        const startedAt = performance.now();
        const { controller, operation } = beginRequest();
        updatePendingTurn({ ...turn, status: 'pending' });

        try {
          const response = await retryRequest(
            projectId,
            visibleDiscussion.discussionId,
            {
              content: turn.content,
              idempotency_key: turn.requestId,
              ...(turn.webSearch ? { web_search: true } : {}),
            },
            controller.signal,
          );

          if (!finishRequest(operation) || controller.signal.aborted) {
            return;
          }

          const next = assertDiscussionDetails(
            response,
            projectId,
            visibleDiscussion.discussionId,
          );
          updateDetails(next);
          onDiscussionChanged?.(next);
          updatePendingTurn(null);
          setWebSearchEnabledState(false);
          const assistantResponse = completedResponse(next, turn.requestId);

          if (assistantResponse) {
            trackAnalytics(
              analyticsClient,
              'discussion_response_completed',
              {
                project_id: projectId,
                discussion_id: visibleDiscussion.discussionId,
                request_id: turn.requestId,
                occurred_at: assistantResponse.created_at,
                latency_ms: elapsedMilliseconds(startedAt),
                ...responseSearchAnalytics(
                  assistantResponse,
                  turn.webSearch,
                ),
              },
            );
          }

          generateTitleIfNeeded(next);
        } catch (error: unknown) {
          if (
            controller.signal.aborted ||
            operation !== operationRef.current ||
            isAbort(error)
          ) {
            return;
          }

          finishRequest(operation);
          updatePendingTurn({
            ...turn,
            failureCode: generationFailureCode(error) ?? turn.failureCode,
            status: 'failed',
          });
          trackAnalytics(analyticsClient, 'discussion_response_failed', {
            project_id: projectId,
            discussion_id: visibleDiscussion.discussionId,
            request_id: turn.requestId,
            occurred_at: occurredAt(),
            latency_ms: elapsedMilliseconds(startedAt),
            web_search_requested: turn.webSearch,
            web_search_used: false,
            citation_count: 0,
          });
        }
      };

      void retry();
    },
    [
      analyticsClient,
      beginRequest,
      finishRequest,
      generateTitleIfNeeded,
      onDiscussionChanged,
      projectId,
      retryRequest,
      updateDetails,
      updatePendingTurn,
      visibleDiscussion,
    ],
  );

  return useMemo(
    () => ({
      composerError,
      composerValue:
        visibleDiscussion.kind === 'draft'
          ? visibleDiscussion.prompt
          : composerValue,
      creationFailure,
      details,
      isSubmitting,
      loadError,
      loadStatus,
      onComposerChange,
      pendingTurn,
      retryFailedTurn,
      setWebSearchEnabled,
      submit,
      webSearchEnabled,
      webSearchSupported,
    }),
    [
      composerError,
      composerValue,
      creationFailure,
      details,
      isSubmitting,
      loadError,
      loadStatus,
      onComposerChange,
      pendingTurn,
      retryFailedTurn,
      setWebSearchEnabled,
      submit,
      visibleDiscussion,
      webSearchEnabled,
      webSearchSupported,
    ],
  );
}

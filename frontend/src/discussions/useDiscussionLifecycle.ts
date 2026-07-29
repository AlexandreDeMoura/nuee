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
  getDiscussion,
  retryDiscussionMessage,
  sendDiscussionMessage,
  type CreateDiscussionInput,
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
  isTemporaryDiscussionTitle,
  TEMPORARY_DISCUSSION_TITLE,
} from './discussionModel';

export type DiscussionCreateRequest = typeof createDiscussion;
export type DiscussionGetRequest = typeof getDiscussion;
export type DiscussionMessageRequest = typeof sendDiscussionMessage;
export type DiscussionTitleRequest = typeof generateDiscussionTitle;

export interface DiscussionLifecycleRequests {
  create?: DiscussionCreateRequest;
  generateTitle?: DiscussionTitleRequest;
  get?: DiscussionGetRequest;
  retry?: DiscussionMessageRequest;
  send?: DiscussionMessageRequest;
}

export interface PendingDiscussionTurn {
  content: string;
  discussionId: string | null;
  requestId: string;
  status: 'pending' | 'failed';
}

type DiscussionLoadStatus = 'draft' | 'loading' | 'ready' | 'error';

export interface DiscussionLifecycle {
  composerError: string | null;
  composerValue: string;
  details: DiscussionDetails | null;
  isSubmitting: boolean;
  loadError: string | null;
  loadStatus: DiscussionLoadStatus;
  onComposerChange: (value: string) => void;
  pendingTurn: PendingDiscussionTurn | null;
  retryFailedTurn: (turn: PendingDiscussionTurn) => void;
  submit: () => void;
}

interface UseDiscussionLifecycleOptions {
  analyticsClient?: AnalyticsClient;
  onDiscussionCreated: (discussion: {
    id: string;
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
  requestId: string;
} | null {
  if (!(error instanceof ApiError) || error.code !== 'AI_GENERATION_FAILED') {
    return null;
  }

  const discussionId = error.body.discussion_id;
  const requestId = error.body.request_id;

  return typeof discussionId === 'string' &&
    discussionId.length > 0 &&
    typeof requestId === 'string' &&
    requestId.length > 0
    ? { discussionId, requestId }
    : null;
}

function createRequestId(): string {
  return crypto.randomUUID();
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

function completedResponseAt(
  discussion: DiscussionDetails,
  requestId: string,
): string | null {
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
      )?.created_at ?? null
  );
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
  const [pendingTurn, setPendingTurn] =
    useState<PendingDiscussionTurn | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const detailsRef = useRef(details);
  const submittingRef = useRef(false);
  const operationRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const titleControllerRef = useRef<AbortController | null>(null);
  const titleAttemptRef = useRef<string | null>(null);
  const creationAttemptRef = useRef<{
    content: string;
    requestId: string;
  } | null>(null);
  const retainedAttemptRef = useRef<{
    content: string;
    requestId: string;
  } | null>(null);
  const persistedDiscussionId =
    visibleDiscussion.kind === 'persisted'
      ? visibleDiscussion.discussionId
      : null;

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
    updateDetails,
  ]);

  useEffect(
    () => () => {
      operationRef.current += 1;
      requestControllerRef.current?.abort();
      titleControllerRef.current?.abort();
    },
    [],
  );

  const onComposerChange = useCallback(
    (value: string) => {
      setComposerError(null);

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
    async (content: string) => {
      const retainedAttempt = creationAttemptRef.current;
      const requestId =
        retainedAttempt?.content === content
          ? retainedAttempt.requestId
          : createRequestId();
      const input: CreateDiscussionInput = {
        project_id: projectId,
        first_prompt: content,
        idempotency_key: requestId,
        bubble_ids: [],
        document_ids: [],
      };
      creationAttemptRef.current = { content, requestId };
      const startedAt = performance.now();
      const { controller, operation } = beginRequest();
      const optimisticTurn: PendingDiscussionTurn = {
        content,
        discussionId: null,
        requestId,
        status: 'pending',
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

          const responseAt = completedResponseAt(next, firstMessage.request_id);

          if (responseAt) {
            trackAnalytics(
              analyticsClient,
              'discussion_response_completed',
              {
                project_id: projectId,
                discussion_id: next.id,
                request_id: firstMessage.request_id,
                occurred_at: responseAt,
                latency_ms: elapsedMilliseconds(startedAt),
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
            },
          );
          updatePendingTurn({
            content,
            discussionId: recovery.discussionId,
            requestId: recovery.requestId,
            status: 'failed',
          });
          setComposerValue('');
          onDiscussionCreated({
            id: recovery.discussionId,
            title: TEMPORARY_DISCUSSION_TITLE,
          });
          return;
        }

        updatePendingTurn(null);
        setComposerError(
          errorMessage(error, 'The discussion could not be started.'),
        );
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
    async (content: string) => {
      if (visibleDiscussion.kind !== 'persisted' || !detailsRef.current) {
        return;
      }

      const discussionId = visibleDiscussion.discussionId;
      const retainedAttempt = retainedAttemptRef.current;
      const requestId =
        retainedAttempt?.content === content
          ? retainedAttempt.requestId
          : createRequestId();
      retainedAttemptRef.current = { content, requestId };
      const startedAt = performance.now();
      const { controller, operation } = beginRequest();
      updatePendingTurn({
        content,
        discussionId,
        requestId,
        status: 'pending',
      });

      try {
        const response = await sendRequest(
          projectId,
          discussionId,
          { content, idempotency_key: requestId },
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
        const responseAt = completedResponseAt(next, requestId);

        if (responseAt) {
          trackAnalytics(
            analyticsClient,
            'discussion_response_completed',
            {
              project_id: projectId,
              discussion_id: discussionId,
              request_id: requestId,
              occurred_at: responseAt,
              latency_ms: elapsedMilliseconds(startedAt),
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

        if (
          error instanceof ApiError &&
          error.code === 'AI_GENERATION_FAILED'
        ) {
          retainedAttemptRef.current = null;
          updatePendingTurn({
            content,
            discussionId,
            requestId,
            status: 'failed',
          });
          setComposerValue('');
          trackAnalytics(analyticsClient, 'discussion_response_failed', {
            project_id: projectId,
            discussion_id: discussionId,
            request_id: requestId,
            occurred_at: occurredAt(),
            latency_ms: elapsedMilliseconds(startedAt),
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

  const submit = useCallback(() => {
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
      void submitDraft(content);
    } else {
      void submitMessage(content);
    }
  }, [composerValue, submitDraft, submitMessage, visibleDiscussion]);

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
          const responseAt = completedResponseAt(next, turn.requestId);

          if (responseAt) {
            trackAnalytics(
              analyticsClient,
              'discussion_response_completed',
              {
                project_id: projectId,
                discussion_id: visibleDiscussion.discussionId,
                request_id: turn.requestId,
                occurred_at: responseAt,
                latency_ms: elapsedMilliseconds(startedAt),
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
          updatePendingTurn({ ...turn, status: 'failed' });
          trackAnalytics(analyticsClient, 'discussion_response_failed', {
            project_id: projectId,
            discussion_id: visibleDiscussion.discussionId,
            request_id: turn.requestId,
            occurred_at: occurredAt(),
            latency_ms: elapsedMilliseconds(startedAt),
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
      details,
      isSubmitting,
      loadError,
      loadStatus,
      onComposerChange,
      pendingTurn,
      retryFailedTurn,
      submit,
    }),
    [
      composerError,
      composerValue,
      details,
      isSubmitting,
      loadError,
      loadStatus,
      onComposerChange,
      pendingTurn,
      retryFailedTurn,
      submit,
      visibleDiscussion,
    ],
  );
}

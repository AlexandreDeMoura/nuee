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
  getDiscussion,
  retryDiscussionMessage,
  sendDiscussionMessage,
  type DiscussionDetails,
} from '../api';
import type { VisibleDiscussion } from './useDiscussionVisibility';
import {
  assertDiscussionDetails,
  buildDefaultFrozenContext,
} from './discussionModel';

export type DiscussionCreateRequest = typeof createDiscussion;
export type DiscussionGetRequest = typeof getDiscussion;
export type DiscussionMessageRequest = typeof sendDiscussionMessage;

export interface DiscussionLifecycleRequests {
  create?: DiscussionCreateRequest;
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
  onDiscussionCreated: (discussion: {
    id: string;
    title: string;
  }) => void;
  onDiscussionChanged?: (discussion: DiscussionDetails) => void;
  onDraftPromptChange: (prompt: string) => void;
  projectDescription: string;
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

export function useDiscussionLifecycle({
  onDiscussionCreated,
  onDiscussionChanged,
  onDraftPromptChange,
  projectDescription,
  projectId,
  requests,
  visibleDiscussion,
}: UseDiscussionLifecycleOptions): DiscussionLifecycle {
  const createRequest = requests?.create ?? createDiscussion;
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
    onDiscussionChanged,
    persistedDiscussionId,
    projectId,
    updateDetails,
  ]);

  useEffect(
    () => () => {
      operationRef.current += 1;
      requestControllerRef.current?.abort();
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
      const { controller, operation } = beginRequest();
      const optimisticTurn: PendingDiscussionTurn = {
        content,
        discussionId: null,
        requestId: `draft:${visibleDiscussion.kind === 'draft' ? visibleDiscussion.key : 'unknown'}`,
        status: 'pending',
      };
      updatePendingTurn(optimisticTurn);

      try {
        const response = await createRequest(
          projectId,
          {
            project_id: projectId,
            frozen_context: buildDefaultFrozenContext(projectDescription),
            first_prompt: content,
          },
          controller.signal,
        );

        if (!finishRequest(operation) || controller.signal.aborted) {
          return;
        }

        const next = assertDiscussionDetails(response, projectId);
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
          updatePendingTurn({
            content,
            discussionId: recovery.discussionId,
            requestId: recovery.requestId,
            status: 'failed',
          });
          setComposerValue('');
          onDiscussionCreated({
            id: recovery.discussionId,
            title: 'New discussion',
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
      beginRequest,
      createRequest,
      finishRequest,
      onDiscussionCreated,
      onDiscussionChanged,
      projectDescription,
      projectId,
      updateDetails,
      updatePendingTurn,
      visibleDiscussion,
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
          return;
        }

        updatePendingTurn(null);
        setComposerError(
          errorMessage(error, 'The message could not be sent.'),
        );
      }
    },
    [
      beginRequest,
      finishRequest,
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
        }
      };

      void retry();
    },
    [
      beginRequest,
      finishRequest,
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

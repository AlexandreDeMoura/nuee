import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  createBubbleLink,
  deleteBubble,
  deleteBubbleLink,
  updateBubble,
  type Bubble,
  type BubbleLink,
  type UpdateBubbleInput,
} from '../api';
import {
  analytics,
  trackAnalytics,
} from '../analytics';
import type {
  BubbleInspectorProps,
  BubbleInspectorSaveStatus,
} from './bubbleInspectorTypes';

const DEFAULT_SAVE_DELAY_MS = 600;

export interface BubbleDraft {
  title: string;
  summary: string;
  content: string;
}

export interface LinkedBubbleEntry {
  bubble: Bubble | null;
  linkedBubbleId: string;
  link: BubbleLink;
}

function toDraft(bubble: Bubble): BubbleDraft {
  return {
    title: bubble.title,
    summary: bubble.summary ?? '',
    content: bubble.content,
  };
}

function normalizeDraft(draft: BubbleDraft): UpdateBubbleInput {
  const summary = draft.summary.trim();

  return {
    title: draft.title.trim(),
    summary: summary.length > 0 ? summary : null,
    content: draft.content.trim(),
  };
}

function draftSignature(draft: BubbleDraft): string {
  return JSON.stringify(draft);
}

function isSameContent(bubble: Bubble, input: UpdateBubbleInput): boolean {
  return (
    bubble.title === input.title &&
    bubble.summary === input.summary &&
    bubble.content === input.content
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function assertSavedBubble(
  bubble: Bubble,
  projectId: string,
  bubbleId: string,
): Bubble {
  if (
    bubble.id !== bubbleId ||
    bubble.project_id !== projectId ||
    typeof bubble.title !== 'string' ||
    bubble.title.trim().length === 0 ||
    typeof bubble.content !== 'string' ||
    bubble.content.trim().length === 0 ||
    (bubble.summary !== null && typeof bubble.summary !== 'string') ||
    typeof bubble.updated_at !== 'string'
  ) {
    throw new Error('The saved bubble response was invalid.');
  }

  return bubble;
}

export function useBubbleInspector({
  bubble,
  availableBubbles = [],
  bubbleLinks = [],
  onBubbleDeleted,
  onBubbleUpdated,
  onBubbleLinkCreated,
  onBubbleLinkRemoved,
  requestCreateLink = createBubbleLink,
  requestDelete = deleteBubble,
  requestDeleteLink = deleteBubbleLink,
  requestUpdate = updateBubble,
  saveDelayMs = DEFAULT_SAVE_DELAY_MS,
  analyticsClient = analytics,
}: BubbleInspectorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<BubbleDraft>(() => toDraft(bubble));
  const [persistedBubble, setPersistedBubble] = useState(bubble);
  const [status, setStatus] =
    useState<BubbleInspectorSaveStatus>('saved');
  const [failedDraftSignature, setFailedDraftSignature] =
    useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedLinkTargetId, setSelectedLinkTargetId] = useState('');
  const [pendingLinkId, setPendingLinkId] = useState<string | null>(null);
  const [linkActionError, setLinkActionError] = useState<string | null>(null);
  const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] =
    useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [hasDeleteError, setHasDeleteError] = useState(false);
  const draftRef = useRef(draft);
  const persistedBubbleRef = useRef(bubble);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const deleteControllerRef = useRef<AbortController | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  const deleteCancelButtonRef = useRef<HTMLButtonElement>(null);
  const isDeletingRef = useRef(false);
  const onBubbleDeletedRef = useRef(onBubbleDeleted);
  const onBubbleUpdatedRef = useRef(onBubbleUpdated);

  const normalizedDraft = normalizeDraft(draft);
  const isTitleEmpty = normalizedDraft.title.length === 0;
  const isContentEmpty = normalizedDraft.content.length === 0;
  const isValid = !isTitleEmpty && !isContentEmpty;
  const hasChanges = !isSameContent(persistedBubble, normalizedDraft);
  const linkedEntries: LinkedBubbleEntry[] = bubbleLinks.flatMap((link) => {
    const linkedBubbleId =
      link.bubble_a_id === bubble.id
        ? link.bubble_b_id
        : link.bubble_b_id === bubble.id
          ? link.bubble_a_id
          : null;

    if (!linkedBubbleId || link.project_id !== bubble.project_id) {
      return [];
    }

    return [{
      bubble:
        availableBubbles.find((candidate) => candidate.id === linkedBubbleId) ??
        null,
      linkedBubbleId,
      link,
    }];
  });
  const linkedBubbleIds = new Set(
    linkedEntries.map(({ linkedBubbleId }) => linkedBubbleId),
  );
  const linkCandidates = availableBubbles.filter(
    (candidate) =>
      candidate.project_id === bubble.project_id &&
      candidate.id !== bubble.id &&
      !linkedBubbleIds.has(candidate.id),
  );

  useEffect(() => {
    onBubbleDeletedRef.current = onBubbleDeleted;
  }, [onBubbleDeleted]);

  useEffect(() => {
    onBubbleUpdatedRef.current = onBubbleUpdated;
  }, [onBubbleUpdated]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      activeControllerRef.current?.abort();
      deleteControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!isDeleteConfirmationOpen) {
      return;
    }

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = 'hidden';
    deleteCancelButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();

        if (!isDeletingRef.current) {
          setIsDeleteConfirmationOpen(false);
          setHasDeleteError(false);
        }

        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = deleteDialogRef.current
        ? Array.from(
            deleteDialogRef.current.querySelectorAll<HTMLElement>(
              'button:not(:disabled), [tabindex]:not([tabindex="-1"])',
            ),
          )
        : [];

      if (focusableElements.length === 0) {
        event.preventDefault();
        deleteDialogRef.current?.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;

      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [isDeleteConfirmationOpen]);

  const publishStatus = useCallback((nextStatus: BubbleInspectorSaveStatus) => {
    setStatus((current) => current === nextStatus ? current : nextStatus);
  }, []);

  const saveDraft = useCallback(
    async (submittedDraft: BubbleDraft) => {
      const input = normalizeDraft(submittedDraft);

      if (
        !input.title ||
        !input.content ||
        isSameContent(persistedBubbleRef.current, input) ||
        activeControllerRef.current
      ) {
        return;
      }

      const controller = new AbortController();
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      activeControllerRef.current = controller;
      setIsSaving(true);
      setFailedDraftSignature(null);
      publishStatus('saving');

      try {
        const response = await requestUpdate(
          bubble.project_id,
          bubble.id,
          input,
          controller.signal,
        );
        const updatedBubble = assertSavedBubble(
          response,
          bubble.project_id,
          bubble.id,
        );

        if (!mountedRef.current || requestId !== requestIdRef.current) {
          return;
        }

        persistedBubbleRef.current = updatedBubble;
        setPersistedBubble(updatedBubble);
        onBubbleUpdatedRef.current(updatedBubble);
        trackAnalytics(analyticsClient, 'bubble_content_updated', {
          project_id: bubble.project_id,
          bubble_id: bubble.id,
        });

        if (
          draftSignature(draftRef.current) === draftSignature(submittedDraft)
        ) {
          const savedDraft = toDraft(updatedBubble);
          draftRef.current = savedDraft;
          setDraft(savedDraft);
          publishStatus('saved');
        } else {
          publishStatus('dirty');
        }
      } catch (error: unknown) {
        if (
          !mountedRef.current ||
          requestId !== requestIdRef.current ||
          isAbortError(error)
        ) {
          return;
        }

        const submittedSignature = draftSignature(submittedDraft);
        setFailedDraftSignature(submittedSignature);
        publishStatus(
          draftSignature(draftRef.current) === submittedSignature
            ? 'error'
            : 'dirty',
        );
      } finally {
        if (mountedRef.current && requestId === requestIdRef.current) {
          activeControllerRef.current = null;
          setIsSaving(false);
        }
      }
    },
    [
      analyticsClient,
      bubble.id,
      bubble.project_id,
      publishStatus,
      requestUpdate,
    ],
  );

  useEffect(() => {
    if (!isEditing || !isValid || !hasChanges) {
      return;
    }

    const currentSignature = draftSignature(draft);

    if (isSaving || failedDraftSignature === currentSignature) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void saveDraft(draft);
    }, saveDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    draft,
    failedDraftSignature,
    hasChanges,
    isEditing,
    isSaving,
    isValid,
    saveDelayMs,
    saveDraft,
  ]);

  const updateDraft = (field: keyof BubbleDraft, value: string) => {
    const nextDraft = { ...draftRef.current, [field]: value };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setFailedDraftSignature(null);

    if (!isSaving) {
      const normalizedNextDraft = normalizeDraft(nextDraft);
      publishStatus(
        normalizedNextDraft.title &&
          normalizedNextDraft.content &&
          isSameContent(persistedBubbleRef.current, normalizedNextDraft)
          ? 'saved'
          : 'dirty',
      );
    }
  };

  const retrySave = () => {
    if (!isValid || isSaving) {
      return;
    }

    setFailedDraftSignature(null);
    void saveDraft(draftRef.current);
  };

  const openDeleteConfirmation = () => {
    setHasDeleteError(false);
    setIsDeleteConfirmationOpen(true);
  };

  const closeDeleteConfirmation = () => {
    if (isDeletingRef.current) {
      return;
    }

    setIsDeleteConfirmationOpen(false);
    setHasDeleteError(false);
  };

  const confirmDelete = async () => {
    if (isDeletingRef.current) {
      return;
    }

    const controller = new AbortController();
    isDeletingRef.current = true;
    deleteControllerRef.current = controller;
    setIsDeleting(true);
    setHasDeleteError(false);

    try {
      await requestDelete(
        persistedBubble.project_id,
        persistedBubble.id,
        controller.signal,
      );

      if (!mountedRef.current || controller.signal.aborted) {
        return;
      }

      trackAnalytics(analyticsClient, 'bubble_deleted', {
        project_id: persistedBubble.project_id,
        bubble_id: persistedBubble.id,
      });
      setIsDeleteConfirmationOpen(false);
      onBubbleDeletedRef.current?.(persistedBubbleRef.current);
    } catch (error: unknown) {
      if (mountedRef.current && !isAbortError(error)) {
        setHasDeleteError(true);
      }
    } finally {
      if (mountedRef.current && deleteControllerRef.current === controller) {
        isDeletingRef.current = false;
        deleteControllerRef.current = null;
        setIsDeleting(false);
      }
    }
  };

  const selectLinkTarget = (targetId: string) => {
    setSelectedLinkTargetId(targetId);
    setLinkActionError(null);
  };

  const addLink = async () => {
    if (!selectedLinkTargetId || pendingLinkId) {
      return;
    }

    const targetId = selectedLinkTargetId;
    setPendingLinkId(targetId);
    setLinkActionError(null);

    try {
      const link = await requestCreateLink(bubble.project_id, {
        bubble_a_id: bubble.id,
        bubble_b_id: targetId,
      });
      const endpointIds = new Set([link.bubble_a_id, link.bubble_b_id]);

      if (
        link.project_id !== bubble.project_id ||
        endpointIds.size !== 2 ||
        !endpointIds.has(bubble.id) ||
        !endpointIds.has(targetId)
      ) {
        throw new Error('The saved bubble link response was invalid.');
      }

      onBubbleLinkCreated?.(link);
      trackAnalytics(analyticsClient, 'bubble_link_created', {
        project_id: bubble.project_id,
        bubble_a_id: link.bubble_a_id,
        bubble_b_id: link.bubble_b_id,
      });

      if (mountedRef.current) {
        setSelectedLinkTargetId('');
      }
    } catch {
      if (mountedRef.current) {
        setLinkActionError('Couldn’t add this link. Try again.');
      }
    } finally {
      if (mountedRef.current) {
        setPendingLinkId(null);
      }
    }
  };

  const removeLink = async (link: BubbleLink, linkedBubbleId: string) => {
    if (pendingLinkId) {
      return;
    }

    setPendingLinkId(linkedBubbleId);
    setLinkActionError(null);

    try {
      await requestDeleteLink(
        bubble.project_id,
        bubble.id,
        linkedBubbleId,
      );
      onBubbleLinkRemoved?.(link);
      trackAnalytics(analyticsClient, 'bubble_link_removed', {
        project_id: bubble.project_id,
        bubble_a_id: link.bubble_a_id,
        bubble_b_id: link.bubble_b_id,
      });
    } catch {
      if (mountedRef.current) {
        setLinkActionError('Couldn’t remove this link. Try again.');
      }
    } finally {
      if (mountedRef.current) {
        setPendingLinkId(null);
      }
    }
  };

  return {
    addLink,
    closeDeleteConfirmation,
    confirmDelete,
    deleteCancelButtonRef,
    deleteDialogRef,
    draft,
    hasDeleteError,
    isContentEmpty,
    isDeleteConfirmationOpen,
    isDeleting,
    isEditing,
    isTitleEmpty,
    linkActionError,
    linkCandidates,
    linkedEntries,
    openDeleteConfirmation,
    pendingLinkId,
    persistedBubble,
    removeLink,
    retrySave,
    selectLinkTarget,
    selectedLinkTargetId,
    setIsEditing,
    status,
    updateDraft,
  };
}

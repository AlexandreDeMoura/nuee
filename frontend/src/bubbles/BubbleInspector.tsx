import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Link2,
  Link2Off,
  LoaderCircle,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  createBubbleLink,
  deleteBubble,
  deleteBubbleLink,
  updateBubble,
  type Bubble,
  type BubbleLink,
  type CreateBubbleLinkInput,
  type UpdateBubbleInput,
} from '../api';
import {
  analytics,
  trackAnalytics,
  type AnalyticsClient,
} from '../analytics';

const DEFAULT_SAVE_DELAY_MS = 600;

const focusRing =
  '[-webkit-tap-highlight-color:transparent] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/30';
const fieldClasses =
  `w-full rounded-[9px] border bg-[#fafbfc] px-3 py-2.5 text-[12.5px] leading-[1.55] text-[#3a4453] placeholder:text-[#b6c0cc] ${focusRing}`;

export type BubbleUpdateRequest = (
  projectId: string,
  bubbleId: string,
  input: UpdateBubbleInput,
  signal?: AbortSignal,
) => Promise<Bubble>;

export type BubbleLinkCreateRequest = (
  projectId: string,
  input: CreateBubbleLinkInput,
) => Promise<BubbleLink>;

export type BubbleLinkDeleteRequest = (
  projectId: string,
  firstBubbleId: string,
  secondBubbleId: string,
) => Promise<void>;

export type BubbleDeleteRequest = (
  projectId: string,
  bubbleId: string,
  signal?: AbortSignal,
) => Promise<void>;

export type BubbleLinkLoadStatus = 'loading' | 'ready' | 'error';

export type BubbleInspectorSaveStatus =
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'error';

export interface BubbleInspectorProps {
  bubble: Bubble;
  availableBubbles?: Bubble[];
  bubbleLinks?: BubbleLink[];
  linkLoadStatus?: BubbleLinkLoadStatus;
  onBubbleDeleted?: (bubble: Bubble) => void;
  onBubbleUpdated: (bubble: Bubble) => void;
  onBubbleLinkCreated?: (link: BubbleLink) => void;
  onBubbleLinkRemoved?: (link: BubbleLink) => void;
  onRetryBubbleLinks?: () => void;
  requestCreateLink?: BubbleLinkCreateRequest;
  requestDelete?: BubbleDeleteRequest;
  requestDeleteLink?: BubbleLinkDeleteRequest;
  requestUpdate?: BubbleUpdateRequest;
  saveDelayMs?: number;
  analyticsClient?: AnalyticsClient;
}

interface BubbleDraft {
  title: string;
  summary: string;
  content: string;
}

const statusPresentation: Record<
  BubbleInspectorSaveStatus,
  { label: string; classes: string }
> = {
  dirty: { label: 'UNSAVED', classes: 'text-[#a27439]' },
  saving: { label: 'SAVING', classes: 'text-[#3f63a8]' },
  saved: { label: 'SAVED', classes: 'text-[#5c9a6b]' },
  error: { label: 'SAVE FAILED', classes: 'text-[#b4544e]' },
};

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

function formatInspectorDate(value: string): string {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return 'Recently';
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
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

export function BubbleInspector({
  bubble,
  availableBubbles = [],
  bubbleLinks = [],
  linkLoadStatus = 'ready',
  onBubbleDeleted,
  onBubbleUpdated,
  onBubbleLinkCreated,
  onBubbleLinkRemoved,
  onRetryBubbleLinks,
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
  const titleId = useId();
  const summaryId = useId();
  const contentId = useId();
  const deleteTitleId = useId();
  const deleteDescriptionId = useId();

  const normalizedDraft = normalizeDraft(draft);
  const isTitleEmpty = normalizedDraft.title.length === 0;
  const isContentEmpty = normalizedDraft.content.length === 0;
  const isValid = !isTitleEmpty && !isContentEmpty;
  const hasChanges = !isSameContent(persistedBubble, normalizedDraft);
  const presentedStatus = statusPresentation[status];
  const linkedEntries = bubbleLinks.flatMap((link) => {
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
    if (!isEditing) {
      return;
    }

    if (!isValid) {
      return;
    }

    if (!hasChanges) {
      return;
    }

    const currentSignature = draftSignature(draft);

    if (
      isSaving ||
      failedDraftSignature === currentSignature
    ) {
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
    publishStatus,
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
      if (
        mountedRef.current &&
        !(error instanceof DOMException && error.name === 'AbortError')
      ) {
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

  if (!isEditing) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col"
        data-inspector-bubble-id={persistedBubble.id}
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-[18px]">
          <span className="mb-3 inline-flex rounded-[5px] bg-[#eef2fa] px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.1em] text-[#3f63a8] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
            BUBBLE
          </span>
          <h3 className="text-[17px] leading-[1.3] font-semibold tracking-[-0.2px] text-[#1e2733]">
            {persistedBubble.title}
          </h3>

          {persistedBubble.summary && (
            <p className="mt-3 rounded-r-[8px] border-l-2 border-[#a9bde0] bg-[#f6f8fc] px-[13px] py-[11px] text-[12.5px] leading-[1.55] text-[#3a4453] italic">
              {persistedBubble.summary}
            </p>
          )}

          <p className="mt-[18px] mb-2 text-[9.5px] font-semibold tracking-[0.1em] text-[#9aa6b4] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
            CONTENT
          </p>
          <p className="whitespace-pre-wrap text-[12.5px] leading-[1.65] text-[#3a4453]">
            {persistedBubble.content}
          </p>

          <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-[#eef1f5] pt-4 sm:grid-cols-2">
            {persistedBubble.source_kind === 'discussion' &&
              persistedBubble.source_discussion_id && (
                <div className="min-w-0">
                  <dt className="mb-1 text-[9.5px] font-semibold tracking-[0.08em] text-[#9aa6b4] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
                    SOURCE
                  </dt>
                  <dd className="m-0 flex items-start gap-1.5 text-xs font-medium text-[#3f63a8]">
                    <MessageSquare
                      className="mt-px size-[13px] shrink-0"
                      strokeWidth={1.8}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 break-words">
                      Discussion {persistedBubble.source_discussion_id}
                      {persistedBubble.source_message_ids.length > 0 &&
                        ` · ${persistedBubble.source_message_ids.length} source ${
                          persistedBubble.source_message_ids.length === 1
                            ? 'message'
                            : 'messages'
                        }`}
                    </span>
                  </dd>
                </div>
              )}
            <div>
              <dt className="mb-1 text-[9.5px] font-semibold tracking-[0.08em] text-[#9aa6b4] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
                UPDATED
              </dt>
              <dd className="m-0 text-xs text-[#3a4453]">
                <time dateTime={persistedBubble.updated_at}>
                  {formatInspectorDate(persistedBubble.updated_at)}
                </time>
              </dd>
            </div>
          </dl>

          <section
            className="mt-5 border-t border-[#eef1f5] pt-4"
            aria-labelledby={`bubble-links-title-${persistedBubble.id}`}
          >
            <div className="flex items-center gap-2">
              <Link2
                className="size-[14px] text-[#6681b5]"
                strokeWidth={1.8}
                aria-hidden="true"
              />
              <h4
                className="text-[10px] font-semibold tracking-[0.09em] text-[#7b8899] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]"
                id={`bubble-links-title-${persistedBubble.id}`}
              >
                MANUAL LINKS
              </h4>
              {linkLoadStatus === 'ready' && (
                <span className="ml-auto text-[10px] text-[#9aa6b4] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
                  {linkedEntries.length}
                </span>
              )}
            </div>

            {linkLoadStatus === 'loading' && (
              <p className="mt-3 flex items-center gap-2 text-[11.5px] text-[#8b97a6]" role="status">
                <LoaderCircle
                  className="size-[13px] animate-spin motion-reduce:animate-none"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
                Loading links…
              </p>
            )}

            {linkLoadStatus === 'error' && (
              <div className="mt-3 rounded-[9px] border border-[#ecd4d1] bg-[#fbf1f0] p-3" role="alert">
                <p className="text-[11.5px] font-semibold text-[#a44a44]">
                  Couldn’t load manual links
                </p>
                {onRetryBubbleLinks && (
                  <button
                    className={`mt-2 inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-[#e2c0bc] bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-[#a44a44] hover:bg-[#fdf8f8] ${focusRing}`}
                    type="button"
                    onClick={onRetryBubbleLinks}
                  >
                    <RotateCcw className="size-[13px]" strokeWidth={1.8} aria-hidden="true" />
                    Retry
                  </button>
                )}
              </div>
            )}

            {linkLoadStatus === 'ready' && (
              <>
                {linkedEntries.length === 0 ? (
                  <p className="mt-3 text-[11.5px] leading-[1.5] text-[#8b97a6]">
                    No bubbles are directly linked yet.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2" aria-label="Linked bubbles">
                    {linkedEntries.map(({ bubble: linkedBubble, linkedBubbleId, link }) => (
                      <li
                        className="flex items-center gap-2 rounded-[9px] border border-[#e1e6ec] bg-[#fafbfc] px-2.5 py-2"
                        key={link.id}
                      >
                        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-[#3a4453]">
                          {linkedBubble?.title ?? linkedBubbleId}
                        </span>
                        <button
                          className={`grid size-7 shrink-0 cursor-pointer place-items-center rounded-[7px] text-[#8b97a6] hover:bg-[#f9eeee] hover:text-[#a44a44] disabled:cursor-wait disabled:opacity-50 ${focusRing}`}
                          type="button"
                          aria-label={`Unlink ${linkedBubble?.title ?? linkedBubbleId}`}
                          disabled={pendingLinkId !== null}
                          onClick={() => void removeLink(link, linkedBubbleId)}
                        >
                          {pendingLinkId === linkedBubbleId ? (
                            <LoaderCircle className="size-[13px] animate-spin motion-reduce:animate-none" strokeWidth={1.8} aria-hidden="true" />
                          ) : (
                            <Link2Off className="size-[13px]" strokeWidth={1.8} aria-hidden="true" />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 flex items-stretch gap-2">
                  <select
                    className={`min-h-9 min-w-0 flex-1 rounded-[9px] border border-[#dbe1e9] bg-white px-2.5 text-[11.5px] text-[#3a4453] disabled:cursor-not-allowed disabled:text-[#9aa6b4] ${focusRing}`}
                    aria-label="Bubble to link"
                    disabled={pendingLinkId !== null || linkCandidates.length === 0}
                    value={selectedLinkTargetId}
                    onChange={(event) => {
                      setSelectedLinkTargetId(event.target.value);
                      setLinkActionError(null);
                    }}
                  >
                    <option value="">
                      {linkCandidates.length === 0
                        ? 'No bubbles available'
                        : 'Choose a bubble…'}
                    </option>
                    {linkCandidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.title}
                      </option>
                    ))}
                  </select>
                  <button
                    className={`inline-flex min-h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-[#cdd8ea] bg-[#f6f8fc] px-3 text-[11.5px] font-semibold text-[#33538f] hover:border-[#aebed8] hover:bg-[#eef2fa] disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
                    type="button"
                    disabled={!selectedLinkTargetId || pendingLinkId !== null}
                    onClick={() => void addLink()}
                  >
                    <Plus className="size-[13px]" strokeWidth={1.9} aria-hidden="true" />
                    Link
                  </button>
                </div>

                {linkActionError && (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[#b4544e]" role="alert">
                    <CircleAlert className="size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
                    {linkActionError}
                  </p>
                )}
              </>
            )}
          </section>
        </div>

        <div className="flex shrink-0 gap-2 border-t border-[#eef1f5] bg-[#fafbfc] px-[18px] py-[13px]">
          <button
            className={`inline-flex min-h-9 flex-1 cursor-pointer items-center justify-center gap-2 rounded-[9px] bg-[#3f63a8] px-3 py-2 text-[12.5px] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(63,99,168,0.7)] hover:bg-[#33538f] ${focusRing}`}
            type="button"
            onClick={() => setIsEditing(true)}
          >
            <Pencil className="size-[14px]" strokeWidth={1.8} aria-hidden="true" />
            Edit bubble
          </button>
          <button
            className={`grid min-h-9 w-10 shrink-0 cursor-pointer place-items-center rounded-[9px] border border-[#ecd4d1] bg-white text-[#b4544e] hover:bg-[#fbf1f0] ${focusRing}`}
            type="button"
            aria-label="Delete bubble"
            title="Delete bubble"
            onClick={() => {
              setHasDeleteError(false);
              setIsDeleteConfirmationOpen(true);
            }}
          >
            <Trash2 className="size-[15px]" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>

        {isDeleteConfirmationOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#1e2733]/45 p-4 backdrop-blur-[1.5px]"
            data-canvas-overlay
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeDeleteConfirmation();
              }
            }}
          >
            <div
              className="w-full max-w-[472px] overflow-hidden rounded-2xl border border-[#e1e6ec] bg-white shadow-[0_24px_60px_-18px_rgba(20,28,40,0.55)]"
              ref={deleteDialogRef}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={deleteTitleId}
              aria-describedby={deleteDescriptionId}
              aria-busy={isDeleting}
              tabIndex={-1}
            >
              <div className="flex gap-3.5 px-5 pt-5 pb-[18px] sm:px-[22px]">
                <span className="grid size-[38px] shrink-0 place-items-center rounded-[10px] bg-[#fbf1f0] text-[#b4544e]">
                  <Trash2
                    className="size-[19px]"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                </span>
                <div className="min-w-0">
                  <h2
                    className="m-0 break-words text-[15px] leading-[1.4] font-semibold text-[#1e2733]"
                    id={deleteTitleId}
                  >
                    Delete “{persistedBubble.title}”?
                  </h2>
                  <p
                    className="mt-1.5 mb-0 text-[12.5px] leading-[1.55] text-[#5c6a7a]"
                    id={deleteDescriptionId}
                  >
                    It&apos;s removed from the canvas and unlinked from other
                    bubbles. Its source discussion and any frozen copies already
                    captured in existing discussions stay intact.
                  </p>
                  {hasDeleteError && (
                    <p
                      className="mt-3 mb-0 flex items-start gap-1.5 text-[11.5px] leading-[1.45] text-[#b4544e]"
                      role="alert"
                    >
                      <CircleAlert
                        className="mt-px size-[13px] shrink-0"
                        strokeWidth={1.9}
                        aria-hidden="true"
                      />
                      Couldn&apos;t delete the bubble. Try again.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2.5 border-t border-[#eef1f5] bg-[#fafbfc] px-5 py-3.5 sm:px-[22px]">
                <button
                  className={`min-h-9 rounded-[9px] border border-[#e1e6ec] bg-white px-[15px] py-2 text-[12.5px] font-semibold text-[#5c6a7a] disabled:cursor-not-allowed disabled:text-[#b6c0cc] ${focusRing}`}
                  type="button"
                  disabled={isDeleting}
                  onClick={closeDeleteConfirmation}
                  ref={deleteCancelButtonRef}
                >
                  Cancel
                </button>
                <button
                  className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[9px] bg-[#b4544e] px-[18px] py-2 text-[12.5px] font-semibold text-white hover:bg-[#9d443f] disabled:cursor-wait disabled:bg-[#cf8d88] ${focusRing}`}
                  type="button"
                  disabled={isDeleting}
                  onClick={() => void confirmDelete()}
                >
                  {isDeleting && (
                    <LoaderCircle
                      className="size-3 animate-spin motion-reduce:animate-none"
                      strokeWidth={1.8}
                      aria-hidden="true"
                    />
                  )}
                  {isDeleting ? 'Deleting…' : 'Delete bubble'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-inspector-bubble-id={persistedBubble.id}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-[18px]">
        <div className="mb-3 flex items-center gap-2">
          <p className="text-[10px] font-semibold tracking-[0.08em] text-[#7b8899] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
            EDIT BUBBLE
          </p>
          <span
            className={`ml-auto inline-flex items-center gap-1.5 text-[9.5px] font-semibold tracking-[0.05em] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${presentedStatus.classes}`}
            aria-live="polite"
          >
            {status === 'saving' && (
              <LoaderCircle
                className="size-[11px] animate-spin motion-reduce:animate-none"
                strokeWidth={1.8}
                aria-hidden="true"
              />
            )}
            {status === 'saved' && (
              <CircleCheck
                className="size-[11px]"
                strokeWidth={1.9}
                aria-hidden="true"
              />
            )}
            {status === 'error' && (
              <CircleAlert
                className="size-[11px]"
                strokeWidth={1.9}
                aria-hidden="true"
              />
            )}
            {presentedStatus.label}
          </span>
        </div>

        <label
          className="mb-1.5 block text-[11px] font-semibold text-[#3a4453]"
          htmlFor={titleId}
        >
          Title <span className="text-[#b4544e]">*</span>
        </label>
        <input
          className={`${fieldClasses} ${
            isTitleEmpty
              ? 'border-[#e6c7c4] focus:border-[#b4544e]'
              : 'border-[#dbe1e9] focus:border-[#3f63a8]'
          }`}
          id={titleId}
          name="title"
          value={draft.title}
          required
          aria-invalid={isTitleEmpty}
          onChange={(event) => updateDraft('title', event.target.value)}
        />
        {isTitleEmpty && (
          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-[#b4544e]" role="alert">
            <CircleAlert className="size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
            A title is required.
          </p>
        )}

        <label
          className="mt-4 mb-1.5 block text-[11px] font-semibold text-[#3a4453]"
          htmlFor={summaryId}
        >
          Summary
          <span className="ml-1 font-normal text-[#9aa6b4]">· optional</span>
        </label>
        <textarea
          className={`${fieldClasses} min-h-[78px] resize-y border-[#dbe1e9] focus:border-[#3f63a8]`}
          id={summaryId}
          name="summary"
          value={draft.summary}
          rows={3}
          onChange={(event) => updateDraft('summary', event.target.value)}
        />

        <label
          className="mt-4 mb-1.5 block text-[11px] font-semibold text-[#3a4453]"
          htmlFor={contentId}
        >
          Content <span className="text-[#b4544e]">*</span>
        </label>
        <textarea
          className={`${fieldClasses} min-h-[180px] resize-y ${
            isContentEmpty
              ? 'border-[#e6c7c4] focus:border-[#b4544e]'
              : 'border-[#dbe1e9] focus:border-[#3f63a8]'
          }`}
          id={contentId}
          name="content"
          value={draft.content}
          required
          rows={8}
          aria-invalid={isContentEmpty}
          onChange={(event) => updateDraft('content', event.target.value)}
        />
        {isContentEmpty && (
          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-[#b4544e]" role="alert">
            <CircleAlert className="size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
            Content is required.
          </p>
        )}

        {status === 'error' && (
          <div
            className="mt-4 rounded-[9px] border border-[#ecd4d1] bg-[#fbf1f0] p-3"
            role="alert"
          >
            <p className="text-xs font-semibold text-[#a44a44]">
              Couldn’t save the bubble
            </p>
            <p className="mt-1 mb-2.5 text-[11px] leading-[1.45] text-[#b06b66]">
              Your unsaved title, summary, and content are still here.
            </p>
            <button
              className={`inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-[#e2c0bc] bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-[#a44a44] hover:bg-[#fdf8f8] ${focusRing}`}
              type="button"
              onClick={retrySave}
            >
              <RotateCcw className="size-[13px]" strokeWidth={1.8} aria-hidden="true" />
              Retry save
            </button>
          </div>
        )}

        <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-[1.5] text-[#8b97a6]">
          <CircleHelp
            className="mt-px size-[13px] shrink-0"
            strokeWidth={1.7}
            aria-hidden="true"
          />
          Changes update this bubble only. Existing discussion context stays frozen.
        </p>
      </div>

      <div className="shrink-0 border-t border-[#eef1f5] bg-[#fafbfc] px-[18px] py-[13px]">
        <button
          className={`min-h-9 w-full rounded-[9px] border border-[#dbe1e9] bg-white px-3 py-2 text-[12.5px] font-semibold text-[#5c6a7a] hover:bg-[#f6f8fc] disabled:cursor-not-allowed disabled:text-[#b6c0cc] ${focusRing}`}
          type="button"
          disabled={status !== 'saved'}
          onClick={() => setIsEditing(false)}
        >
          Done editing
        </button>
      </div>
    </div>
  );
}

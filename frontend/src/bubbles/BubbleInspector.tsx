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
  LoaderCircle,
  MessageSquare,
  Pencil,
  RotateCcw,
} from 'lucide-react';
import {
  updateBubble,
  type Bubble,
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

export type BubbleInspectorSaveStatus =
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'error';

export interface BubbleInspectorProps {
  bubble: Bubble;
  onBubbleUpdated: (bubble: Bubble) => void;
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
  onBubbleUpdated,
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
  const draftRef = useRef(draft);
  const persistedBubbleRef = useRef(bubble);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const onBubbleUpdatedRef = useRef(onBubbleUpdated);
  const titleId = useId();
  const summaryId = useId();
  const contentId = useId();

  const normalizedDraft = normalizeDraft(draft);
  const isTitleEmpty = normalizedDraft.title.length === 0;
  const isContentEmpty = normalizedDraft.content.length === 0;
  const isValid = !isTitleEmpty && !isContentEmpty;
  const hasChanges = !isSameContent(persistedBubble, normalizedDraft);
  const presentedStatus = statusPresentation[status];

  useEffect(() => {
    onBubbleUpdatedRef.current = onBubbleUpdated;
  }, [onBubbleUpdated]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      activeControllerRef.current?.abort();
    };
  }, []);

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
        </div>

        <div className="shrink-0 border-t border-[#eef1f5] bg-[#fafbfc] px-[18px] py-[13px]">
          <button
            className={`inline-flex min-h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-[9px] bg-[#3f63a8] px-3 py-2 text-[12.5px] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(63,99,168,0.7)] hover:bg-[#33538f] ${focusRing}`}
            type="button"
            onClick={() => setIsEditing(true)}
          >
            <Pencil className="size-[14px]" strokeWidth={1.8} aria-hidden="true" />
            Edit bubble
          </button>
        </div>
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

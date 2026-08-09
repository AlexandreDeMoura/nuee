import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import { ArrowUp, Globe2, LockKeyhole } from 'lucide-react';
import { analytics, type AnalyticsClient } from '../analytics';
import { focusRing } from '../ui/focusRing';
import {
  filterDiscussionSourceCatalog,
  type DiscussionSourceCatalog,
  type DiscussionSourceCatalogItem,
} from './discussionSourceCatalog';
import {
  attachDiscussionMentionSource,
  createDiscussionMentionDraft,
  deleteDiscussionMentionTokenAtEdge,
  discussionMentionSourceKey,
  findDiscussionMentionQuery,
  isDiscussionMentionSourceAttachable,
  removeDiscussionMentionToken,
  replaceDiscussionMentionSources,
  updateDiscussionMentionDraft,
  type DiscussionMentionDraft,
} from './discussionMention';
import type { DiscussionCreationSourceIssue } from './discussionCreationFailure';
import { DiscussionMentionChips } from './DiscussionMentionChips';
import { DiscussionMentionList } from './DiscussionMentionList';
import { trackDiscussionMentionAnalytics } from './discussionMentionAnalytics';
import { useAutoGrowTextarea } from './useAutoGrowTextarea';

const COMPOSER_MAX_ROWS = 3;
const EMPTY_CONTEXT_SOURCES: readonly DiscussionSourceCatalogItem[] = [];
const frozenContextTimeFormatter = new Intl.DateTimeFormat(undefined, {
  timeStyle: 'short',
});

interface OpenMention {
  query: string;
  triggerIndex: number;
}

const textareaMetrics =
  'min-h-[50px] w-full px-2.5 py-2.5 text-[15.5px] leading-[1.5] whitespace-pre-wrap break-words';

function DiscussionMentionMirror({
  disabled,
  draft,
  mirrorRef,
}: {
  disabled: boolean;
  draft: DiscussionMentionDraft;
  mirrorRef: RefObject<HTMLDivElement | null>;
}) {
  const orderedTokens = [...draft.tokens].sort(
    (first, second) => first.start - second.start,
  );
  const content: React.ReactNode[] = [];
  let cursor = 0;

  for (const token of orderedTokens) {
    content.push(draft.value.slice(cursor, token.start));
    content.push(
      <span
        className="rounded-[4px] bg-[#e5ecf8] text-[#34558f]"
        data-discussion-mention-token={discussionMentionSourceKey(token.source)}
        key={`${discussionMentionSourceKey(token.source)}:${token.start}`}
      >
        {draft.value.slice(token.start, token.end)}
      </span>,
    );
    cursor = token.end;
  }

  content.push(draft.value.slice(cursor));

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${textareaMetrics} ${
        disabled ? 'text-[#7f8b99]' : 'text-[#1e2733]'
      }`}
      data-discussion-mention-mirror
      ref={mirrorRef}
    >
      {content}
      {draft.value.endsWith('\n') ? '\u200b' : null}
    </div>
  );
}

export interface DiscussionComposerProps {
  analyticsClient?: AnalyticsClient;
  contextSources?: readonly DiscussionSourceCatalogItem[];
  contextFrozenAt?: string | null;
  disabled?: boolean;
  error?: string | null;
  isInitialPrompt?: boolean;
  isSubmitting: boolean;
  onChange: (value: string) => void;
  onCreateBubble?: () => void;
  onContextSourcesChange?: (
    sources: readonly DiscussionSourceCatalogItem[],
  ) => void;
  onMentionSourceSelect?: (source: DiscussionSourceCatalogItem) => void;
  onSubmit: () => void;
  onUploadDocument?: () => void;
  onWebSearchChange?: (enabled: boolean) => void;
  sourceCatalog?: DiscussionSourceCatalog;
  sourceIssues?: readonly DiscussionCreationSourceIssue[];
  value: string;
  webSearchEnabled?: boolean;
  webSearchSupported?: boolean;
}

export function DiscussionComposer({
  analyticsClient = analytics,
  contextSources = EMPTY_CONTEXT_SOURCES,
  contextFrozenAt,
  disabled = false,
  error,
  isInitialPrompt = false,
  isSubmitting,
  onChange,
  onCreateBubble,
  onContextSourcesChange,
  onMentionSourceSelect,
  onSubmit,
  onUploadDocument,
  onWebSearchChange,
  sourceCatalog,
  sourceIssues,
  value,
  webSearchEnabled = false,
  webSearchSupported = false,
}: DiscussionComposerProps) {
  const composerId = useId();
  const statusId = useId();
  const mentionListId = useId();
  const mentionStatusId = useId();
  const mentionOptionIdPrefix = useId();
  const [mention, setMention] = useState<OpenMention | null>(null);
  const [activeSourceKey, setActiveSourceKey] = useState<string | null>(null);
  const [mentionAnnouncement, setMentionAnnouncement] = useState('');
  const [mentionDraft, setMentionDraft] = useState(() =>
    createDiscussionMentionDraft(value, contextSources),
  );
  const [controlledContextSources, setControlledContextSources] =
    useState(contextSources);
  const [exitingSources, setExitingSources] = useState<
    { source: DiscussionSourceCatalogItem }[]
  >([]);
  const dismissedMentionRef = useRef<{
    triggerIndex: number;
    value: string;
  } | null>(null);
  const mentionOpenTrackedRef = useRef(false);
  const previousControlledValueRef = useRef(value);
  const pendingCaretPositionRef = useRef<number | null>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const exitTimersRef = useRef<Map<string, number>>(new Map());
  const displayedValue = isInitialPrompt ? mentionDraft.value : value;
  const analyticsProjectId = sourceCatalog?.projectId;
  const normalizedValue = displayedValue.trim();
  const textareaRef = useAutoGrowTextarea(
    displayedValue,
    COMPOSER_MAX_ROWS,
  );
  const attachedSources = mentionDraft.sources;
  const hasMentionTokens = mentionDraft.tokens.length > 0;
  const mentionResults = useMemo(
    () =>
      mention && sourceCatalog
        ? filterDiscussionSourceCatalog(sourceCatalog, mention.query)
        : [],
    [mention, sourceCatalog],
  );
  const resolvedActiveSourceKey = mentionResults.some(
    (source) => discussionMentionSourceKey(source) === activeSourceKey,
  )
    ? activeSourceKey
    : mentionResults[0]
      ? discussionMentionSourceKey(mentionResults[0])
      : null;
  const activeOptionIndex = mentionResults.findIndex(
    (source) => discussionMentionSourceKey(source) === resolvedActiveSourceKey,
  );
  const activeOptionId =
    activeOptionIndex >= 0
      ? `${mentionOptionIdPrefix}-${activeOptionIndex}`
      : undefined;
  const describedBy = [
    error || isSubmitting ? statusId : null,
    mention ? mentionStatusId : null,
  ]
    .filter(Boolean)
    .join(' ') || undefined;

  useEffect(() => {
    if (!isInitialPrompt || previousControlledValueRef.current === value) {
      return;
    }

    previousControlledValueRef.current = value;
    setMentionDraft((current) =>
      updateDiscussionMentionDraft(current, value),
    );
  }, [isInitialPrompt, value]);

  useEffect(() => {
    if (!mention || !sourceCatalog) {
      mentionOpenTrackedRef.current = false;
      return;
    }

    if (mentionOpenTrackedRef.current || !analyticsProjectId) {
      return;
    }

    mentionOpenTrackedRef.current = true;
    const bubbleCount = mentionResults.filter(
      ({ kind }) => kind === 'bubble',
    ).length;
    const documentCount = mentionResults.length - bubbleCount;
    trackDiscussionMentionAnalytics(
      analyticsClient,
      'discussion_mention_list_opened',
      {
        project_id: analyticsProjectId,
        result_count: mentionResults.length,
        bubble_count: bubbleCount,
        document_count: documentCount,
      },
    );

    if (sourceCatalog.sources.length === 0) {
      trackDiscussionMentionAnalytics(
        analyticsClient,
        'discussion_mention_empty_state_displayed',
        { project_id: analyticsProjectId },
      );
    }
  }, [analyticsClient, analyticsProjectId, mention, mentionResults, sourceCatalog]);

  if (isInitialPrompt && controlledContextSources !== contextSources) {
    setControlledContextSources(contextSources);
    setMentionDraft((current) =>
      replaceDiscussionMentionSources(current, contextSources),
    );
  }

  useEffect(
    () => () => {
      exitTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  useLayoutEffect(() => {
    const caretPosition = pendingCaretPositionRef.current;
    const textarea = textareaRef.current;

    if (caretPosition === null || !textarea) {
      return;
    }

    pendingCaretPositionRef.current = null;
    textarea.setSelectionRange(caretPosition, caretPosition);
  }, [mentionDraft.value, textareaRef]);

  const showExitingChip = (source: DiscussionSourceCatalogItem) => {
    const sourceKey = discussionMentionSourceKey(source);
    const previousTimer = exitTimersRef.current.get(sourceKey);
    if (previousTimer !== undefined) {
      window.clearTimeout(previousTimer);
    }

    setExitingSources((current) =>
      current.some(
        (candidate) =>
          discussionMentionSourceKey(candidate.source) === sourceKey,
      )
        ? current
        : [...current, { source }],
    );

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(
      () => {
        setExitingSources((current) =>
          current.filter(
            (candidate) =>
              discussionMentionSourceKey(candidate.source) !== sourceKey,
          ),
        );
        if (exitTimersRef.current.get(sourceKey) === timer) {
          exitTimersRef.current.delete(sourceKey);
        }
      },
      prefersReducedMotion ? 0 : 170,
    );
    exitTimersRef.current.set(sourceKey, timer);
  };

  const cancelExitingChip = (source: DiscussionSourceCatalogItem) => {
    const sourceKey = discussionMentionSourceKey(source);
    const timer = exitTimersRef.current.get(sourceKey);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      exitTimersRef.current.delete(sourceKey);
    }
    setExitingSources((current) =>
      current.filter(
        (candidate) =>
          discussionMentionSourceKey(candidate.source) !== sourceKey,
      ),
    );
  };

  const commitMentionDraft = (
    nextDraft: DiscussionMentionDraft,
    caretPosition?: number,
    removalMethod?: 'remove_control' | 'token_deletion',
  ) => {
    const nextSourceKeys = new Set(
      nextDraft.sources.map(discussionMentionSourceKey),
    );
    const contextSourcesChanged =
      nextDraft.sources.length !== mentionDraft.sources.length ||
      mentionDraft.sources.some(
        (source) =>
          !nextSourceKeys.has(discussionMentionSourceKey(source)),
      );
    const removedSources = mentionDraft.sources.filter(
      (source) =>
        !nextSourceKeys.has(discussionMentionSourceKey(source)),
    );
    removedSources.forEach((source) => {
      if (!nextSourceKeys.has(discussionMentionSourceKey(source))) {
        showExitingChip(source);
      }
    });

    if (removalMethod) {
      removedSources.forEach((source) => {
        if (analyticsProjectId) {
          trackDiscussionMentionAnalytics(
            analyticsClient,
            'discussion_mention_source_removed',
            {
              project_id: analyticsProjectId,
              source_id: source.id,
              source_kind: source.kind,
              removal_method: removalMethod,
            },
          );
        }
      });

      if (removedSources.length === 1) {
        setMentionAnnouncement(
          `${removedSources[0].title} removed from discussion context.`,
        );
      } else if (removedSources.length > 1) {
        setMentionAnnouncement(
          `${removedSources.length} sources removed from discussion context.`,
        );
      }
    }

    if (caretPosition !== undefined) {
      pendingCaretPositionRef.current = caretPosition;
    }

    previousControlledValueRef.current = nextDraft.value;
    setMentionDraft(nextDraft);
    onChange(nextDraft.value);
    if (contextSourcesChanged) {
      onContextSourcesChange?.(nextDraft.sources);
    }
  };

  const closeMention = () => {
    setMention(null);
    setActiveSourceKey(null);
  };

  const updateMentionAtCaret = (
    nextValue: string,
    caretPosition: number | null,
  ) => {
    if (!isInitialPrompt || !sourceCatalog || disabled || isSubmitting) {
      closeMention();
      return;
    }

    const nextMention = findDiscussionMentionQuery(nextValue, caretPosition);

    if (
      nextMention &&
      dismissedMentionRef.current?.value === nextValue &&
      dismissedMentionRef.current.triggerIndex === nextMention.triggerIndex
    ) {
      closeMention();
      return;
    }

    setMention(nextMention);

    if (!nextMention) {
      setActiveSourceKey(null);
      return;
    }

    const firstAttachable = filterDiscussionSourceCatalog(
      sourceCatalog,
      nextMention.query,
    ).find(isDiscussionMentionSourceAttachable);
    setActiveSourceKey(
      firstAttachable ? discussionMentionSourceKey(firstAttachable) : null,
    );
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!disabled && !isSubmitting && normalizedValue.length > 0) {
      closeMention();
      onSubmit();
    }
  };

  const selectSource = (
    source: DiscussionSourceCatalogItem,
    inputMethod: 'keyboard' | 'pointer',
  ) => {
    if (!mention) {
      return;
    }

    if (!isDiscussionMentionSourceAttachable(source)) {
      if (
        source.kind === 'document' &&
        source.readiness.status === 'not_ready' &&
        analyticsProjectId
      ) {
        trackDiscussionMentionAnalytics(
          analyticsClient,
          'discussion_mention_not_ready_attach_attempted',
          {
            project_id: analyticsProjectId,
            source_id: source.id,
            source_kind: source.kind,
            input_method: inputMethod,
            readiness_reason: source.readiness.reason,
          },
        );
      }
      setMentionAnnouncement(
        `${source.title} is not ready and was not attached.`,
      );
      return;
    }

    const result = attachDiscussionMentionSource(
      mentionDraft,
      source,
      mention,
    );
    closeMention();

    if (result.attached) {
      cancelExitingChip(source);
      commitMentionDraft(result.draft, result.caretPosition);
      onMentionSourceSelect?.(source);
      if (analyticsProjectId) {
        trackDiscussionMentionAnalytics(
          analyticsClient,
          'discussion_mention_source_attached',
          {
            project_id: analyticsProjectId,
            source_id: source.id,
            source_kind: source.kind,
            input_method: inputMethod,
          },
        );
      }
      setMentionAnnouncement(
        `${source.title} attached to discussion context.`,
      );
    } else {
      setMentionAnnouncement(
        `${source.title} is already attached to discussion context.`,
      );
    }

    textareaRef.current?.focus();
  };

  const moveActiveSource = (direction: 1 | -1) => {
    if (mentionResults.length === 0) {
      return;
    }

    const currentIndex = mentionResults.findIndex(
      (source) =>
        discussionMentionSourceKey(source) === resolvedActiveSourceKey,
    );
    const nextIndex =
      (currentIndex + direction + mentionResults.length) %
      mentionResults.length;
    setActiveSourceKey(
      discussionMentionSourceKey(mentionResults[nextIndex]),
    );
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        moveActiveSource(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        dismissedMentionRef.current = {
          triggerIndex: mention.triggerIndex,
          value: event.currentTarget.value,
        };
        closeMention();
        event.currentTarget.focus();
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const activeSource = mentionResults.find(
          (source) =>
            discussionMentionSourceKey(source) === resolvedActiveSourceKey,
        );
        if (activeSource) {
          selectSource(activeSource, 'keyboard');
        }
        return;
      }
    }

    if (
      !event.nativeEvent.isComposing &&
      (event.key === 'Backspace' || event.key === 'Delete')
    ) {
      const deletion = deleteDiscussionMentionTokenAtEdge(
        mentionDraft,
        event.key,
        event.currentTarget.selectionStart,
        event.currentTarget.selectionEnd,
      );

      if (deletion) {
        event.preventDefault();
        closeMention();
        commitMentionDraft(
          deletion.draft,
          deletion.caretPosition,
          'token_deletion',
        );
        return;
      }
    }

    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const handleCaretActivity = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    updateMentionAtCaret(
      event.currentTarget.value,
      event.currentTarget.selectionStart,
    );
  };

  const resultCountLabel = `${mentionResults.length} ${
    mentionResults.length === 1 ? 'source' : 'sources'
  } found`;
  const formattedFrozenAt = contextFrozenAt
    ? frozenContextTimeFormatter.format(new Date(contextFrozenAt))
    : null;

  return (
    <form
      className="shrink-0 border-t border-[#eef1f5] bg-white p-4.25 sm:p-4.75"
      onSubmit={submit}
    >
      <label className="sr-only" htmlFor={composerId}>
        {isInitialPrompt ? 'Discussion prompt' : 'Discussion message'}
      </label>
      {!isInitialPrompt && contextFrozenAt && formattedFrozenAt && (
        <p
          className="mb-2.5 flex items-center gap-1.75 px-1.25 text-[12px] leading-[1.45] text-[#8b97a6]"
          data-discussion-context-locked
        >
          <LockKeyhole
            aria-hidden="true"
            className="size-3.25 shrink-0 text-[#8a96a5]"
            strokeWidth={1.8}
          />
          <span>
            Context locked for this discussion — frozen at{' '}
            <time dateTime={contextFrozenAt}>{formattedFrozenAt}</time>. Start a
            new discussion to change it.
          </span>
        </p>
      )}
      <div className="rounded-xl border border-[#d7dee7] bg-white p-2.5 shadow-[0_1px_2px_rgba(30,39,51,0.04)] focus-within:border-[#3f63a8] focus-within:ring-3 focus-within:ring-[#3f63a8]/10">
        {isInitialPrompt && (
          <div className="border-b border-[#eef1f5] px-1.25 pb-2.5">
            <DiscussionMentionChips
              exitingSources={exitingSources}
              onRemove={(source) => {
                const nextDraft = removeDiscussionMentionToken(
                  mentionDraft,
                  source,
                );
                if (nextDraft !== mentionDraft) {
                  commitMentionDraft(
                    nextDraft,
                    undefined,
                    'remove_control',
                  );
                  textareaRef.current?.focus();
                }
              }}
              sourceIssues={sourceIssues}
              sources={attachedSources}
            />
          </div>
        )}
        <div className="flex items-end gap-2.5">
          <div className="relative min-w-0 flex-1">
            {mention && sourceCatalog && (
              <DiscussionMentionList
                activeSourceKey={resolvedActiveSourceKey}
                catalog={sourceCatalog}
                listId={mentionListId}
                onCreateBubble={() => {
                  closeMention();
                  if (analyticsProjectId) {
                    trackDiscussionMentionAnalytics(
                      analyticsClient,
                      'discussion_mention_empty_state_cta_activated',
                      {
                        project_id: analyticsProjectId,
                        action: 'create_bubble',
                      },
                    );
                  }
                  onCreateBubble?.();
                }}
                onSelect={selectSource}
                onUploadDocument={() => {
                  closeMention();
                  if (analyticsProjectId) {
                    trackDiscussionMentionAnalytics(
                      analyticsClient,
                      'discussion_mention_empty_state_cta_activated',
                      {
                        project_id: analyticsProjectId,
                        action: 'upload_document',
                      },
                    );
                  }
                  onUploadDocument?.();
                }}
                optionIdPrefix={mentionOptionIdPrefix}
                query={mention.query}
                results={mentionResults}
              />
            )}
            {isInitialPrompt && hasMentionTokens && (
              <DiscussionMentionMirror
                disabled={disabled || isSubmitting}
                draft={mentionDraft}
                mirrorRef={mirrorRef}
              />
            )}
            <textarea
              aria-activedescendant={mention ? activeOptionId : undefined}
              aria-autocomplete={mention ? 'list' : undefined}
              aria-controls={mention ? mentionListId : undefined}
              aria-describedby={describedBy}
              aria-expanded={mention ? 'true' : 'false'}
              aria-haspopup={
                isInitialPrompt && sourceCatalog
                  ? sourceCatalog.sources.length === 0
                    ? 'dialog'
                    : 'listbox'
                  : undefined
              }
              className={`scrollbar-subtle relative resize-none overflow-y-hidden overscroll-contain border-0 bg-transparent outline-none placeholder:text-[#a7b1be] disabled:cursor-not-allowed ${textareaMetrics} ${
                isInitialPrompt && hasMentionTokens
                  ? 'text-transparent caret-[#1e2733] disabled:caret-[#7f8b99]'
                  : 'text-[#1e2733] disabled:text-[#7f8b99]'
              }`}
              disabled={disabled || isSubmitting}
              id={composerId}
              name="message"
              ref={textareaRef}
              placeholder={
                disabled
                  ? 'Resolve the unanswered message first'
                  : isInitialPrompt
                    ? 'What do you want to understand?'
                    : 'Ask a focused follow-up'
              }
              role={isInitialPrompt && sourceCatalog ? 'combobox' : undefined}
              rows={1}
              value={displayedValue}
              onChange={(event) => {
                const nextValue = event.target.value;
                dismissedMentionRef.current = null;

                if (isInitialPrompt) {
                  const nextDraft = updateDiscussionMentionDraft(
                    mentionDraft,
                    nextValue,
                  );
                  commitMentionDraft(
                    nextDraft,
                    undefined,
                    'token_deletion',
                  );
                } else {
                  onChange(nextValue);
                }

                updateMentionAtCaret(nextValue, event.target.selectionStart);
              }}
              onClick={handleCaretActivity}
              onKeyDown={handleKeyDown}
              onScroll={(event) => {
                if (mirrorRef.current) {
                  mirrorRef.current.scrollLeft = event.currentTarget.scrollLeft;
                  mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
                }
              }}
              onSelect={handleCaretActivity}
            />
          </div>
          <button
            className={`grid size-10.75 shrink-0 place-items-center rounded-[11px] bg-[#3f63a8] text-white shadow-[0_5px_12px_-7px_rgba(63,99,168,0.8)] hover:bg-[#33538f] disabled:cursor-not-allowed disabled:bg-[#c6cfda] disabled:shadow-none ${focusRing}`}
            type="submit"
            aria-label={
              isSubmitting
                ? 'Waiting for response'
                : isInitialPrompt
                  ? 'Continue discussion'
                  : 'Send message'
            }
            disabled={
              disabled || isSubmitting || normalizedValue.length === 0
            }
            title={isSubmitting ? 'Waiting for response' : 'Send'}
          >
            <ArrowUp
              className="size-[19px]"
              strokeWidth={2}
              aria-hidden="true"
            />
          </button>
        </div>
        {webSearchSupported && (
          <div className="mt-1.25 border-t border-[#eef1f5] px-1.25 pt-2.5">
            <button
              aria-label="Search the web"
              aria-pressed={webSearchEnabled}
              className={`inline-flex min-h-8.5 items-center gap-1.75 rounded-[9px] px-2.5 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${focusRing} ${
                webSearchEnabled
                  ? 'bg-[#e8eef9] text-[#34558f]'
                  : 'text-[#728096] hover:bg-[#f2f5f8] hover:text-[#47566a]'
              }`}
              disabled={disabled || isSubmitting}
              onClick={() => onWebSearchChange?.(!webSearchEnabled)}
              title={
                webSearchEnabled
                  ? 'Web search allowed for this turn'
                  : 'Allow web search for this turn'
              }
              type="button"
            >
              <Globe2 className="size-4.25" aria-hidden="true" />
              Search web
            </button>
          </div>
        )}
      </div>
      {isInitialPrompt && (
        <div className="mt-2.25 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1.25 text-[10px] font-semibold tracking-[0.07em] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
          <p className="text-[#8b97a6]">
            {attachedSources.length === 0
              ? 'Type @ to bring in a bubble or document'
              : `${attachedSources.length} attached ${
                  attachedSources.length === 1 ? 'source' : 'sources'
                }`}
          </p>
          <p aria-live="polite" className="text-[#617187]">
            {attachedSources.length + 1}{' '}
            {attachedSources.length === 0 ? 'SOURCE' : 'SOURCES'} FREEZE WHEN
            YOU SEND
          </p>
        </div>
      )}
      <p
        aria-live="polite"
        className="sr-only"
        id={mentionStatusId}
      >
        {mention ? resultCountLabel : ''}
      </p>
      <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {mentionAnnouncement}
      </p>
      {(error || isSubmitting) && (
        <p
          className={`mt-2.5 px-1.25 text-[14px] ${
            error ? 'text-[#a64540]' : 'text-[#728096]'
          }`}
          id={statusId}
          role={error ? 'alert' : 'status'}
        >
          {error ?? 'Generating a focused response…'}
        </p>
      )}
    </form>
  );
}

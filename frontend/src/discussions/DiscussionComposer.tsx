import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';
import { ArrowUp, Globe2 } from 'lucide-react';
import { focusRing } from '../ui/focusRing';
import {
  filterDiscussionSourceCatalog,
  type DiscussionSourceCatalog,
  type DiscussionSourceCatalogItem,
} from './discussionSourceCatalog';
import {
  discussionMentionSourceKey,
  findDiscussionMentionQuery,
  isDiscussionMentionSourceAttachable,
} from './discussionMention';
import { DiscussionMentionList } from './DiscussionMentionList';
import { useAutoGrowTextarea } from './useAutoGrowTextarea';

const COMPOSER_MAX_ROWS = 3;

interface OpenMention {
  query: string;
  triggerIndex: number;
}

export interface DiscussionComposerProps {
  disabled?: boolean;
  error?: string | null;
  isInitialPrompt?: boolean;
  isSubmitting: boolean;
  onChange: (value: string) => void;
  onCreateBubble?: () => void;
  onMentionSourceSelect?: (source: DiscussionSourceCatalogItem) => void;
  onSubmit: () => void;
  onUploadDocument?: () => void;
  onWebSearchChange?: (enabled: boolean) => void;
  sourceCatalog?: DiscussionSourceCatalog;
  value: string;
  webSearchEnabled?: boolean;
  webSearchSupported?: boolean;
}

export function DiscussionComposer({
  disabled = false,
  error,
  isInitialPrompt = false,
  isSubmitting,
  onChange,
  onCreateBubble,
  onMentionSourceSelect,
  onSubmit,
  onUploadDocument,
  onWebSearchChange,
  sourceCatalog,
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
  const dismissedMentionRef = useRef<{
    triggerIndex: number;
    value: string;
  } | null>(null);
  const normalizedValue = value.trim();
  const textareaRef = useAutoGrowTextarea(value, COMPOSER_MAX_ROWS);
  const mentionResults =
    mention && sourceCatalog
      ? filterDiscussionSourceCatalog(sourceCatalog, mention.query)
      : [];
  const selectableSources = mentionResults.filter(
    isDiscussionMentionSourceAttachable,
  );
  const resolvedActiveSourceKey = selectableSources.some(
    (source) => discussionMentionSourceKey(source) === activeSourceKey,
  )
    ? activeSourceKey
    : selectableSources[0]
      ? discussionMentionSourceKey(selectableSources[0])
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

  const selectSource = (source: DiscussionSourceCatalogItem) => {
    if (!isDiscussionMentionSourceAttachable(source)) {
      return;
    }

    closeMention();
    onMentionSourceSelect?.(source);
    textareaRef.current?.focus();
  };

  const moveActiveSource = (direction: 1 | -1) => {
    if (selectableSources.length === 0) {
      return;
    }

    const currentIndex = selectableSources.findIndex(
      (source) =>
        discussionMentionSourceKey(source) === resolvedActiveSourceKey,
    );
    const nextIndex =
      (currentIndex + direction + selectableSources.length) %
      selectableSources.length;
    setActiveSourceKey(
      discussionMentionSourceKey(selectableSources[nextIndex]),
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
        const activeSource = selectableSources.find(
          (source) =>
            discussionMentionSourceKey(source) === resolvedActiveSourceKey,
        );
        if (activeSource) {
          selectSource(activeSource);
        }
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

  return (
    <form
      className="shrink-0 border-t border-[#eef1f5] bg-white p-4.25 sm:p-4.75"
      onSubmit={submit}
    >
      <label className="sr-only" htmlFor={composerId}>
        {isInitialPrompt ? 'Discussion prompt' : 'Discussion message'}
      </label>
      <div className="rounded-xl border border-[#d7dee7] bg-white p-2.5 shadow-[0_1px_2px_rgba(30,39,51,0.04)] focus-within:border-[#3f63a8] focus-within:ring-3 focus-within:ring-[#3f63a8]/10">
        <div className="flex items-end gap-2.5">
          <div className="relative min-w-0 flex-1">
            {mention && sourceCatalog && (
              <DiscussionMentionList
                activeSourceKey={resolvedActiveSourceKey}
                catalog={sourceCatalog}
                listId={mentionListId}
                onCreateBubble={() => {
                  closeMention();
                  onCreateBubble?.();
                }}
                onSelect={selectSource}
                onUploadDocument={() => {
                  closeMention();
                  onUploadDocument?.();
                }}
                optionIdPrefix={mentionOptionIdPrefix}
                query={mention.query}
                results={mentionResults}
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
              className="scrollbar-subtle min-h-[50px] w-full resize-none overflow-y-hidden overscroll-contain border-0 bg-transparent px-2.5 py-2.5 text-[15.5px] leading-[1.5] text-[#1e2733] outline-none placeholder:text-[#a7b1be] disabled:cursor-not-allowed disabled:text-[#7f8b99]"
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
              value={value}
              onChange={(event) => {
                const nextValue = event.target.value;
                dismissedMentionRef.current = null;
                onChange(nextValue);
                updateMentionAtCaret(nextValue, event.target.selectionStart);
              }}
              onClick={handleCaretActivity}
              onKeyDown={handleKeyDown}
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
      <p
        aria-live="polite"
        className="sr-only"
        id={mentionStatusId}
      >
        {mention ? resultCountLabel : ''}
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

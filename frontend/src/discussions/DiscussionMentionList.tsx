import { useId } from 'react';
import {
  CircleAlert,
  Check,
  CirclePlus,
  FileText,
  MessageSquare,
  Upload,
} from 'lucide-react';
import { focusRing } from '../ui/focusRing';
import type {
  DiscussionDocumentSource,
  DiscussionSourceCatalog,
  DiscussionSourceCatalogItem,
} from './discussionSourceCatalog';
import { discussionMentionSourceKey } from './discussionMention';

export interface DiscussionMentionListProps {
  activeSourceKey: string | null;
  catalog: DiscussionSourceCatalog;
  listId: string;
  onCreateBubble?: () => void;
  onSelect: (
    source: DiscussionSourceCatalogItem,
    inputMethod: 'pointer',
  ) => void;
  onUploadDocument?: () => void;
  optionIdPrefix: string;
  query: string;
  results: readonly DiscussionSourceCatalogItem[];
}

function documentAvailability(source: DiscussionDocumentSource): string | null {
  if (source.readiness.status === 'ready') {
    return null;
  }

  return source.readiness.reason === 'failed'
    ? 'Processing failed. Retry it in Documents before attaching.'
    : 'Still processing. It can be attached when it is ready.';
}

function MentionOption({
  active,
  id,
  onSelect,
  source,
}: {
  active: boolean;
  id: string;
  onSelect: (
    source: DiscussionSourceCatalogItem,
    inputMethod: 'pointer',
  ) => void;
  source: DiscussionSourceCatalogItem;
}) {
  const unavailableReason =
    source.kind === 'document' ? documentAvailability(source) : null;
  const Icon = source.kind === 'bubble' ? MessageSquare : FileText;

  return (
    <button
      aria-disabled={unavailableReason ? 'true' : undefined}
      aria-selected={active}
      className={`flex w-full items-start gap-3 px-3.5 py-2.75 text-left transition-colors motion-reduce:transition-none ${
        unavailableReason
          ? 'cursor-not-allowed text-[#8995a3]'
          : active
            ? 'bg-[#eef2fa] text-[#263b62]'
            : 'text-[#344050] hover:bg-[#f6f8fb]'
      }`}
      id={id}
      onClick={() => onSelect(source, 'pointer')}
      onMouseDown={(event) => event.preventDefault()}
      role="option"
      tabIndex={-1}
      type="button"
    >
      <span
        className={`mt-0.25 grid size-8 shrink-0 place-items-center rounded-[9px] ${
          unavailableReason
            ? 'bg-[#f0f2f5] text-[#9aa5b1]'
            : 'bg-[#e5ecf8] text-[#3f63a8]'
        }`}
      >
        <Icon className="size-4" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold">
          {source.title}
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] leading-[1.4] text-[#7d8998]">
          {unavailableReason ?? source.secondaryLine}
        </span>
      </span>
      {source.kind === 'document' && (
        source.readiness.status === 'ready' ? (
          <span className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-[5px] bg-[#edf6ef] px-1.5 py-0.75 text-[9.5px] font-semibold tracking-[0.06em] text-[#568361] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
            <Check className="size-3" strokeWidth={2.2} aria-hidden="true" />
            READY
          </span>
        ) : (
          <span className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-[5px] border border-[#d9dee5] bg-[#f5f6f8] px-1.5 py-0.75 text-[9.5px] font-semibold tracking-[0.06em] text-[#727f8f] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
            <CircleAlert className="size-3" strokeWidth={2} aria-hidden="true" />
            NOT READY
          </span>
        )
      )}
    </button>
  );
}

export function DiscussionMentionList({
  activeSourceKey,
  catalog,
  listId,
  onCreateBubble,
  onSelect,
  onUploadDocument,
  optionIdPrefix,
  query,
  results,
}: DiscussionMentionListProps) {
  const bubbleGroupLabelId = useId();
  const documentGroupLabelId = useId();
  const bubbleResults = results.filter((source) => source.kind === 'bubble');
  const documentResults = results.filter(
    (source) => source.kind === 'document',
  );
  const isCatalogEmpty = catalog.sources.length === 0;

  return (
    <div
      className="absolute right-0 bottom-[calc(100%+10px)] left-0 z-30 max-h-[340px] overflow-hidden rounded-[13px] border border-[#d7dee7] bg-white shadow-[0_18px_44px_-18px_rgba(30,39,51,0.38)]"
      data-discussion-mention-list
    >
      <div className="flex items-center justify-between gap-3 border-b border-[#eef1f5] px-3.5 py-2.5">
        <span className="min-w-0 truncate text-[12.5px] font-medium text-[#5f6f82]">
          Sources matching{' '}
          <span className="font-semibold text-[#344f80]">@{query}</span>
        </span>
        <span className="shrink-0 text-[9.5px] font-semibold tracking-[0.08em] text-[#8b97a6] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
          {results.length} {results.length === 1 ? 'MATCH' : 'MATCHES'}
        </span>
      </div>
      <div
        aria-label={isCatalogEmpty ? 'No project sources yet' : 'Project sources'}
        className="scrollbar-subtle max-h-[250px] overflow-y-auto py-1.5"
        id={listId}
        role={isCatalogEmpty ? 'dialog' : 'listbox'}
      >
        {isCatalogEmpty ? (
          <div className="px-5 py-5 text-center">
            <p className="text-[14px] font-semibold text-[#344050]">
              Your project knowledge starts here
            </p>
            <p className="mx-auto mt-1.5 max-w-[360px] text-[12.5px] leading-[1.5] text-[#7d8998]">
              The project description is already included. You can keep
              writing, upload a document, or create a bubble.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                className={`inline-flex min-h-9 items-center gap-1.75 rounded-[9px] border border-[#cdd8ea] bg-white px-3 text-[12px] font-semibold text-[#3f63a8] hover:bg-[#f6f8fc] ${focusRing}`}
                onClick={onUploadDocument}
                onMouseDown={(event) => event.preventDefault()}
                type="button"
              >
                <Upload className="size-3.75" aria-hidden="true" />
                Upload a document
              </button>
              <button
                className={`inline-flex min-h-9 items-center gap-1.75 rounded-[9px] border border-[#cdd8ea] bg-white px-3 text-[12px] font-semibold text-[#3f63a8] hover:bg-[#f6f8fc] ${focusRing}`}
                onClick={onCreateBubble}
                onMouseDown={(event) => event.preventDefault()}
                type="button"
              >
                <CirclePlus className="size-3.75" aria-hidden="true" />
                Create a bubble
              </button>
            </div>
          </div>
        ) : results.length === 0 ? (
          <div className="px-5 py-6 text-center">
            <p className="text-[13.5px] font-semibold text-[#566476]">
              No project sources match @{query}
            </p>
            <p className="mt-1.5 text-[12px] text-[#8b97a6]">
              Try another title or keyword.
            </p>
          </div>
        ) : (
          <>
            {bubbleResults.length > 0 && (
              <div aria-labelledby={bubbleGroupLabelId} role="group">
                <p
                  className="px-3.5 pt-2 pb-1 text-[9.5px] font-semibold tracking-[0.12em] text-[#8b97a6] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]"
                  id={bubbleGroupLabelId}
                >
                  BUBBLES
                </p>
                {bubbleResults.map((source) => {
                  const resultIndex = results.indexOf(source);
                  return (
                    <MentionOption
                      active={discussionMentionSourceKey(source) === activeSourceKey}
                      id={`${optionIdPrefix}-${resultIndex}`}
                      key={discussionMentionSourceKey(source)}
                      onSelect={onSelect}
                      source={source}
                    />
                  );
                })}
              </div>
            )}
            {documentResults.length > 0 && (
              <div
                aria-labelledby={documentGroupLabelId}
                className={
                  bubbleResults.length > 0
                    ? 'mt-1 border-t border-[#eef1f5] pt-1'
                    : undefined
                }
                role="group"
              >
                <p
                  className="px-3.5 pt-2 pb-1 text-[9.5px] font-semibold tracking-[0.12em] text-[#8b97a6] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]"
                  id={documentGroupLabelId}
                >
                  DOCUMENTS
                </p>
                {documentResults.map((source) => {
                  const resultIndex = results.indexOf(source);
                  return (
                    <MentionOption
                      active={discussionMentionSourceKey(source) === activeSourceKey}
                      id={`${optionIdPrefix}-${resultIndex}`}
                      key={discussionMentionSourceKey(source)}
                      onSelect={onSelect}
                      source={source}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
      <div className="border-t border-[#eef1f5] px-3.5 py-2 text-[10px] font-medium tracking-[0.04em] text-[#8b97a6] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
        ↑↓ move · ⏎ attach · esc dismiss
      </div>
    </div>
  );
}

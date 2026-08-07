import { useId, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleDot,
  FileText,
  LockKeyhole,
  MessageSquare,
  X,
} from 'lucide-react';
import { focusRing } from '../ui/focusRing';
import type { DiscussionSourceCatalogItem } from './discussionSourceCatalog';
import { discussionMentionSourceKey } from './discussionMention';
import {
  discussionCreationSourceIssueMessage,
  type DiscussionCreationSourceIssue,
} from './discussionCreationFailure';

const compactChipLimit = 3;

interface ExitingMentionSource {
  source: DiscussionSourceCatalogItem;
}

export interface DiscussionMentionChipsProps {
  exitingSources?: readonly ExitingMentionSource[];
  onRemove: (source: DiscussionSourceCatalogItem) => void;
  sourceIssues?: readonly DiscussionCreationSourceIssue[];
  sources: readonly DiscussionSourceCatalogItem[];
}

const chipClasses =
  'inline-flex h-8.5 max-w-62.5 shrink-0 items-center gap-1.75 rounded-lg border px-3 text-[12.5px] font-medium';

export function DiscussionMentionChips({
  exitingSources = [],
  onRemove,
  sourceIssues = [],
  sources,
}: DiscussionMentionChipsProps) {
  const completeListId = useId();
  const [isExpanded, setIsExpanded] = useState(false);
  const hasOverflow = sources.length + 1 > compactChipLimit;
  const visibleSources =
    hasOverflow && !isExpanded
      ? sources.slice(0, compactChipLimit - 1)
      : sources;

  return (
    <div
      aria-label={`${sources.length + 1} pending context ${
        sources.length === 0 ? 'source' : 'sources'
      }`}
      className="flex min-w-0 items-start gap-2"
    >
      <div
        className={`flex min-w-0 flex-1 gap-1.75 ${
          isExpanded ? 'flex-wrap' : 'overflow-hidden'
        }`}
        id={completeListId}
        role="list"
      >
        <span className="contents" role="listitem">
          <span
            aria-label="Project description, always included"
            className={`${chipClasses} border-[#cad7ec] bg-[#f0f4fb] text-[#48618d]`}
            title="The latest project description is always included"
          >
            <CircleDot className="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            <span className="truncate">Project description</span>
            <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold tracking-[0.07em] text-[#6880aa] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
              <LockKeyhole className="size-3" strokeWidth={1.9} aria-hidden="true" />
              ALWAYS
            </span>
          </span>
        </span>
        {visibleSources.map((source) => {
          const Icon = source.kind === 'bubble' ? MessageSquare : FileText;
          const issue = sourceIssues.find(
            (candidate) =>
              candidate.sourceKind === source.kind &&
              candidate.sourceId === source.id,
          );
          const issueId = issue
            ? `discussion-mention-source-issue-${source.kind}-${source.id}`
            : undefined;

          return (
            <span
              aria-describedby={issueId}
              className={`${chipClasses} ${
                issue
                  ? 'border-[#d9aaa5] bg-[#fffafa] text-[#9b514b]'
                  : 'border-[#dce3eb] bg-[#f7f9fc] text-[#5d6b7d]'
              }`}
              data-context-source-issue={issue?.reason}
              data-discussion-mention-chip={discussionMentionSourceKey(source)}
              key={discussionMentionSourceKey(source)}
              role="listitem"
            >
              {issue ? (
                <CircleAlert
                  className="size-4 shrink-0 text-[#a95f57]"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              ) : (
                <Icon className="size-4 shrink-0 text-[#71829a]" strokeWidth={1.7} aria-hidden="true" />
              )}
              <span className="truncate">{source.title}</span>
              {issue && (
                <span className="sr-only" id={issueId}>
                  {discussionCreationSourceIssueMessage(issue)}
                </span>
              )}
              <button
                aria-label={`Remove ${source.kind}: ${source.title}`}
                className={`-mr-1 grid size-5 shrink-0 place-items-center rounded text-[#8a97a6] hover:bg-[#e7ebf1] hover:text-[#9d443f] ${focusRing}`}
                onClick={() => onRemove(source)}
                title="Remove from pending context"
                type="button"
              >
                <X className="size-3.5" strokeWidth={2} aria-hidden="true" />
              </button>
            </span>
          );
        })}
        {exitingSources.map(({ source }) => {
          const Icon = source.kind === 'bubble' ? MessageSquare : FileText;

          return (
            <span
              aria-hidden="true"
              className={`${chipClasses} pointer-events-none border-[#dce3eb] bg-[#f7f9fc] text-[#5d6b7d] animate-[discussion-mention-chip-exit_160ms_ease-in_forwards] motion-reduce:animate-none`}
              data-discussion-mention-chip-exiting={discussionMentionSourceKey(source)}
              key={`exiting:${discussionMentionSourceKey(source)}`}
            >
              <Icon className="size-4 shrink-0 text-[#71829a]" strokeWidth={1.7} aria-hidden="true" />
              <span className="truncate">{source.title}</span>
              <X className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            </span>
          );
        })}
      </div>
      {hasOverflow && (
        <button
          aria-controls={completeListId}
          aria-expanded={isExpanded}
          aria-label={
            isExpanded
              ? 'Show fewer pending context sources'
              : `Show all ${sources.length + 1} pending context sources`
          }
          className={`inline-flex h-8.5 shrink-0 items-center gap-1.25 rounded-lg border border-[#dce3eb] bg-white px-2.5 text-[12.5px] font-semibold text-[#617187] hover:border-[#bac7d7] hover:bg-[#f6f8fc] ${focusRing}`}
          onClick={() => setIsExpanded((expanded) => !expanded)}
          type="button"
        >
          {isExpanded ? (
            <>
              Less
              <ChevronUp className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
            </>
          ) : (
            <>
              +{sources.length + 1 - compactChipLimit}
              <ChevronDown className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

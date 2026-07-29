import { useId, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  CircleDot,
  FileText,
  LockKeyhole,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react';
import type {
  DiscussionContextBadge,
  DiscussionContextInspection,
  DiscussionContextKind,
} from './discussionContextModel';

interface DiscussionContextBadgesProps {
  badges: readonly DiscussionContextBadge[];
  discussionId: string;
  onInspect?: (
    inspection: DiscussionContextInspection,
    trigger: HTMLButtonElement,
  ) => void;
}

const kindIcons: Record<DiscussionContextKind, LucideIcon> = {
  project_description: CircleDot,
  bubble: MessageSquare,
  document: FileText,
};

const badgeClasses =
  'inline-flex h-7 max-w-52 shrink-0 items-center gap-1.5 rounded-lg border border-[#dce3eb] bg-[#f7f9fc] px-2.5 text-[10.5px] font-medium text-[#5d6b7d]';
const compactBadgeLimit = 3;

export function DiscussionContextBadges({
  badges,
  discussionId,
  onInspect,
}: DiscussionContextBadgesProps) {
  const completeListId = useId();
  const [isExpanded, setIsExpanded] = useState(false);

  if (badges.length === 0) {
    return null;
  }

  const hasOverflow = badges.length > compactBadgeLimit;
  const visibleBadges =
    hasOverflow && !isExpanded
      ? badges.slice(0, compactBadgeLimit)
      : badges;

  return (
    <div
      className="flex min-w-0 items-start gap-2"
      aria-label={`${badges.length} frozen context ${
        badges.length === 1 ? 'item' : 'items'
      }`}
    >
      <span className="mt-2 inline-flex shrink-0 items-center gap-1 text-[9.5px] font-semibold tracking-[0.06em] text-[#8a96a5] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
        <LockKeyhole className="size-3" strokeWidth={1.8} aria-hidden="true" />
        Frozen
      </span>
      <div className="flex min-w-0 flex-1 items-start gap-1.5">
        <div
          className={`flex min-w-0 flex-1 gap-1.5 py-0.5 ${
            isExpanded ? 'flex-wrap' : 'overflow-hidden'
          }`}
          id={completeListId}
          role="list"
        >
          {visibleBadges.map((badge) => {
            const Icon = kindIcons[badge.kind];
            const content = (
              <>
                <Icon
                  className="size-3.25 shrink-0 text-[#71829a]"
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
                <span className="truncate">{badge.label}</span>
              </>
            );

            return (
              <span className="contents" key={badge.id} role="listitem">
                {onInspect ? (
                  <button
                    className={`${badgeClasses} cursor-pointer hover:border-[#bac7d7] hover:bg-[#eef3f9] hover:text-[#40516a] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/25`}
                    type="button"
                    aria-label={`Inspect frozen context: ${badge.label}`}
                    data-frozen-context-badge={badge.id}
                    onClick={(event) =>
                      onInspect({
                        discussionId,
                        item: badge.item,
                      }, event.currentTarget)
                    }
                  >
                    {content}
                  </button>
                ) : (
                  <span
                    className={badgeClasses}
                    title={`${badge.label} is frozen for this discussion`}
                  >
                    {content}
                  </span>
                )}
              </span>
            );
          })}
        </div>
        {hasOverflow && (
          <button
            className="mt-0.5 inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-[#dce3eb] bg-white px-2 text-[10.5px] font-semibold text-[#617187] hover:border-[#bac7d7] hover:bg-[#f6f8fc] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/25"
            type="button"
            aria-controls={completeListId}
            aria-expanded={isExpanded}
            aria-label={
              isExpanded
                ? 'Show fewer frozen context items'
                : `Show all ${badges.length} frozen context items`
            }
            onClick={() => setIsExpanded((expanded) => !expanded)}
          >
            {isExpanded ? (
              <>
                Less
                <ChevronUp
                  className="size-3"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              </>
            ) : (
              <>
                +{badges.length - compactBadgeLimit}
                <ChevronDown
                  className="size-3"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

import {
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
  onInspect?: (inspection: DiscussionContextInspection) => void;
}

const kindIcons: Record<DiscussionContextKind, LucideIcon> = {
  project_description: CircleDot,
  bubble: MessageSquare,
  document: FileText,
};

const badgeClasses =
  'inline-flex h-7 max-w-52 shrink-0 items-center gap-1.5 rounded-lg border border-[#dce3eb] bg-[#f7f9fc] px-2.5 text-[10.5px] font-medium text-[#5d6b7d]';

export function DiscussionContextBadges({
  badges,
  discussionId,
  onInspect,
}: DiscussionContextBadgesProps) {
  if (badges.length === 0) {
    return null;
  }

  return (
    <div
      className="flex min-w-0 items-center gap-2"
      aria-label={`${badges.length} frozen context ${
        badges.length === 1 ? 'item' : 'items'
      }`}
    >
      <span className="inline-flex shrink-0 items-center gap-1 text-[9.5px] font-semibold tracking-[0.06em] text-[#8a96a5] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
        <LockKeyhole className="size-3" strokeWidth={1.8} aria-hidden="true" />
        Frozen
      </span>
      <div className="flex min-w-0 gap-1.5 overflow-x-auto py-0.5">
        {badges.map((badge) => {
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

          return onInspect ? (
            <button
              className={`${badgeClasses} cursor-pointer hover:border-[#bac7d7] hover:bg-[#eef3f9] hover:text-[#40516a] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/25`}
              type="button"
              aria-label={`Inspect frozen context: ${badge.label}`}
              key={badge.id}
              onClick={() =>
                onInspect({
                  contextId: badge.id,
                  discussionId,
                })
              }
            >
              {content}
            </button>
          ) : (
            <span
              className={badgeClasses}
              key={badge.id}
              title={`${badge.label} is frozen for this discussion`}
            >
              {content}
            </span>
          );
        })}
      </div>
    </div>
  );
}

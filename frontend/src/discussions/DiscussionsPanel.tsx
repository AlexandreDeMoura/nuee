import {
  CircleAlert,
  LoaderCircle,
  MessageSquare,
  Plus,
  RotateCcw,
} from 'lucide-react';
import type { DiscussionSummary } from '../api';
import { formatUpdatedAt } from '../utils/date';
import type { ProjectDiscussions } from './useProjectDiscussions';
import { isTemporaryDiscussionTitle } from './discussionModel';

const focusRing =
  '[-webkit-tap-highlight-color:transparent] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/30';

export interface DiscussionsPanelProps {
  discussions: DiscussionSummary[];
  error: string | null;
  onOpen: (discussion: DiscussionSummary) => void;
  onRetry: () => void;
  onStart: () => void;
  openingDiscussionId: string | null;
  openError: string | null;
  status: ProjectDiscussions['status'];
}

function EmptyDiscussions({ onStart }: { onStart: () => void }) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center px-7 text-center"
      data-panel-empty="discussions"
    >
      <span className="mb-3 grid size-9 place-items-center rounded-[10px] bg-[#f2f5f9] text-[#7f8ea0]">
        <MessageSquare
          className="size-[17px]"
          strokeWidth={1.7}
          aria-hidden="true"
        />
      </span>
      <h3 className="text-[13px] font-semibold text-[#344050]">
        No discussions yet
      </h3>
      <p className="mt-1.5 max-w-[230px] text-xs leading-[1.55] text-[#8b97a6]">
        Each discussion is a focused thread. Its full history is kept — even
        after you extract a bubble.
      </p>
      <button
        className={`mt-4 cursor-pointer rounded-lg border border-[#cdd8ea] bg-[#f6f8fc] px-3.5 py-2 text-xs font-semibold text-[#3f63a8] hover:border-[#aebed8] hover:bg-[#eef2fa] ${focusRing}`}
        type="button"
        onClick={onStart}
      >
        Start a discussion
      </button>
    </div>
  );
}

function DiscussionListError({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center px-7 text-center"
      role="alert"
    >
      <span className="mb-3 grid size-9 place-items-center rounded-[10px] bg-[#f9eeee] text-[#a95f57]">
        <CircleAlert
          className="size-[16px]"
          strokeWidth={1.7}
          aria-hidden="true"
        />
      </span>
      <h3 className="text-[13px] font-semibold text-[#344050]">
        Couldn’t load discussions
      </h3>
      <p className="mt-1.5 max-w-[240px] text-xs leading-[1.55] text-[#8b97a6]">
        {error}
      </p>
      <button
        className={`mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#cdd8ea] bg-[#f6f8fc] px-3.5 py-2 text-xs font-semibold text-[#3f63a8] hover:border-[#aebed8] hover:bg-[#eef2fa] ${focusRing}`}
        type="button"
        onClick={onRetry}
      >
        <RotateCcw className="size-[13px]" strokeWidth={1.8} aria-hidden="true" />
        Try again
      </button>
    </div>
  );
}

export function DiscussionsPanel({
  discussions,
  error,
  onOpen,
  onRetry,
  onStart,
  openingDiscussionId,
  openError,
  status,
}: DiscussionsPanelProps) {
  if ((status === 'idle' || status === 'loading') && discussions.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center gap-2 text-xs text-[#8b97a6]"
        role="status"
      >
        <LoaderCircle
          className="size-4 animate-spin motion-reduce:animate-none"
          strokeWidth={1.8}
          aria-hidden="true"
        />
        Loading discussions…
      </div>
    );
  }

  if (status === 'error' && discussions.length === 0) {
    return (
      <DiscussionListError
        error={error ?? 'The discussions could not be loaded.'}
        onRetry={onRetry}
      />
    );
  }

  if (discussions.length === 0) {
    return <EmptyDiscussions onStart={onStart} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(openError || (status === 'error' && error)) && (
        <p
          className="mx-3 mt-3 rounded-lg border border-[#efd4d1] bg-[#fdf6f5] px-3 py-2 text-[11.5px] leading-[1.45] text-[#9a514c]"
          role="alert"
        >
          {openError ?? error} Select a discussion to try again.
        </p>
      )}

      <ul
        className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
        aria-label="Project discussions"
      >
        {discussions.map((discussion) => {
          const isOpening = openingDiscussionId === discussion.id;
          const hasTemporaryTitle = isTemporaryDiscussionTitle(
            discussion.title,
          );

          return (
            <li key={discussion.id}>
              <button
                className={`group flex w-full cursor-pointer items-start gap-3 rounded-[10px] px-3 py-3 text-left hover:bg-[#f6f8fc] disabled:cursor-wait ${focusRing}`}
                type="button"
                aria-label={`Open discussion: ${discussion.title}`}
                aria-busy={isOpening ? 'true' : undefined}
                disabled={openingDiscussionId !== null}
                onClick={() => onOpen(discussion)}
              >
                <span
                  className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-[8px] ${
                    discussion.is_active
                      ? 'bg-[#e8eef9] text-[#3f63a8]'
                      : 'bg-[#f2f5f9] text-[#8491a0]'
                  }`}
                >
                  {isOpening ? (
                    <LoaderCircle
                      className="size-[14px] animate-spin motion-reduce:animate-none"
                      strokeWidth={1.8}
                      aria-hidden="true"
                    />
                  ) : (
                    <MessageSquare
                      className="size-[14px]"
                      strokeWidth={1.7}
                      aria-hidden="true"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span
                      className={`min-w-0 flex-1 truncate text-[12.5px] font-semibold ${
                        hasTemporaryTitle
                          ? 'italic text-[#8793a2]'
                          : 'text-[#344050]'
                      }`}
                      data-temporary-title={
                        hasTemporaryTitle ? 'true' : undefined
                      }
                      title={
                        hasTemporaryTitle
                          ? 'Temporary title — a concise title will be generated'
                          : discussion.title
                      }
                    >
                      {discussion.title}
                    </span>
                    {discussion.is_active && (
                      <span className="shrink-0 rounded-[5px] bg-[#e8eef9] px-1.5 py-0.5 text-[8.5px] font-semibold tracking-[0.08em] text-[#3f63a8] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
                        ACTIVE
                      </span>
                    )}
                  </span>
                  <time
                    className="mt-1 block text-[10px] text-[#9aa6b4] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]"
                    dateTime={discussion.last_activity_at}
                  >
                    {formatUpdatedAt(discussion.last_activity_at)}
                  </time>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="shrink-0 border-t border-[#eef1f5] p-3">
        <button
          className={`inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-[#cdd8ea] bg-[#f6f8fc] px-3 py-2 text-xs font-semibold text-[#3f63a8] hover:border-[#aebed8] hover:bg-[#eef2fa] ${focusRing}`}
          type="button"
          onClick={onStart}
        >
          <Plus className="size-[14px]" strokeWidth={1.8} aria-hidden="true" />
          New discussion
        </button>
      </div>
    </div>
  );
}

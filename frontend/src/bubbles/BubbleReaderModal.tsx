import { useId } from 'react';
import { FilePenLine, Link2, MessageSquare, Pencil, X } from 'lucide-react';
import type { Bubble } from '../api';
import { focusRing } from '../ui/focusRing';
import { RichResponse } from '../ui/RichResponse';
import { useModalShell } from '../ui/useModalShell';
import { extractionSourceDetails, formatBubbleDate } from './bubbleReadingModel';

export interface BubbleReaderModalProps {
  bubble: Bubble;
  /** Titles of the bubbles manually linked to this one, shown read-only. */
  linkedTitles?: readonly string[];
  onClose: () => void;
  onEdit?: () => void;
}

const metaLabelClasses =
  "text-[9.5px] font-semibold tracking-[0.1em] text-[#9aa6b4] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]";

/**
 * The bubble's reading view at full size. It presents what the inspector
 * already persisted — editing, linking, and deletion stay with the inspector.
 */
export function BubbleReaderModal({
  bubble,
  linkedTitles = [],
  onClose,
  onEdit,
}: BubbleReaderModalProps) {
  const titleId = useId();
  const linksId = useId();
  const isExtracted =
    bubble.source_kind === 'discussion' && bubble.source_discussion_id !== null;
  const { containerRef: dialogRef } = useModalShell<HTMLDivElement>({
    onEscape: onClose,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1e2733]/45 p-3.5 backdrop-blur-[1.5px] sm:p-7.25"
      data-canvas-overlay
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="flex max-h-[min(912px,calc(100vh-56px))] w-full max-w-[912px] flex-col overflow-hidden rounded-2xl border border-[#d9e0e8] bg-white shadow-[0_28px_72px_-24px_rgba(20,28,40,0.58)]"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-bubble-reader-bubble-id={bubble.id}
        tabIndex={-1}
      >
        <header className="shrink-0 border-b border-[#eef1f5] px-5 py-4.5 sm:px-7.25 sm:py-5">
          <div className="flex items-start gap-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="inline-flex rounded-[5px] bg-[#eef2fa] px-1.75 py-0.5 text-[9.5px] font-semibold tracking-[0.1em] text-[#3f63a8] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
                  BUBBLE
                </span>
                <span className="text-[12px] text-[#9aa6b4]">
                  Updated{' '}
                  <time dateTime={bubble.updated_at}>
                    {formatBubbleDate(bubble.updated_at)}
                  </time>
                </span>
              </div>
              <h2
                className="mt-2 text-[24px] leading-[1.25] font-semibold tracking-[-0.35px] text-balance text-[#1e2733]"
                id={titleId}
              >
                {bubble.title}
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              {onEdit && (
                <button
                  className={`inline-flex min-h-9.5 cursor-pointer items-center gap-1.75 rounded-[11px] border border-[#dbe1e9] bg-white px-3.5 text-[13px] font-semibold text-[#4b5a6d] hover:border-[#c7d2df] hover:bg-[#f6f8fc] hover:text-[#33538f] ${focusRing}`}
                  type="button"
                  title="Edit bubble"
                  onClick={onEdit}
                >
                  <Pencil
                    className="size-[15px]"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                  Edit
                </button>
              )}
              <button
                className={`grid size-9.5 cursor-pointer place-items-center rounded-[11px] border border-[#e1e6ec] bg-white text-[#6f7d8e] hover:border-[#c7d2df] hover:bg-[#f6f8fc] hover:text-[#40516a] ${focusRing}`}
                type="button"
                aria-label="Close expanded bubble"
                title="Close expanded bubble"
                onClick={onClose}
              >
                <X className="size-[19px]" strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        <div
          className={`scrollbar-subtle min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#f5f7fa] px-5 py-6 sm:px-7.25 sm:py-7 ${focusRing}`}
          aria-label="Bubble content"
          role="region"
          tabIndex={0}
        >
          <div className="mx-auto flex w-full max-w-[736px] flex-col gap-5">
            {bubble.summary && (
              <p className="rounded-r-[10px] border-l-[3px] border-[#a9bde0] bg-[#f1f5fb] px-5 py-4 text-[15.5px] leading-[1.6] text-[#41506a] italic">
                {bubble.summary}
              </p>
            )}

            <div className="rounded-2xl border border-[#e4eaf1] bg-white px-5 py-5 shadow-[0_2px_6px_-2px_rgba(30,39,51,0.07)] sm:px-7 sm:py-6">
              <RichResponse content={bubble.content} />
            </div>

            {linkedTitles.length > 0 && (
              <section aria-labelledby={linksId}>
                <div className="flex items-center gap-2">
                  <Link2
                    className="size-[14px] text-[#6681b5]"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                  <h3 className={metaLabelClasses} id={linksId}>
                    MANUAL LINKS
                  </h3>
                </div>
                <ul className="mt-2.5 flex flex-wrap gap-2">
                  {linkedTitles.map((title, index) => (
                    <li
                      className="max-w-full truncate rounded-lg border border-[#dce3eb] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#5d6b7d]"
                      key={`${title}:${index}`}
                    >
                      {title}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-[#eef1f5] bg-[#fafbfc] px-5 py-3.5 sm:px-7.25">
          <p className="flex min-w-0 items-start gap-1.75 text-[12px] text-[#5c6a7a]">
            {isExtracted ? (
              <MessageSquare
                className="mt-px size-[14px] shrink-0 text-[#3f63a8]"
                strokeWidth={1.8}
                aria-hidden="true"
              />
            ) : (
              <FilePenLine
                className="mt-px size-[14px] shrink-0 text-[#8b97a6]"
                strokeWidth={1.8}
                aria-hidden="true"
              />
            )}
            <span className="min-w-0 break-words">
              {isExtracted
                ? extractionSourceDetails(bubble)
                : 'Created directly on the canvas'}
            </span>
          </p>
          <p className="shrink-0 text-[11.5px] text-[#9aa6b4]">
            Created{' '}
            <time dateTime={bubble.created_at}>
              {formatBubbleDate(bubble.created_at)}
            </time>
          </p>
        </footer>
      </div>
    </div>
  );
}

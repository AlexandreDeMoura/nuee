import { useEffect, useId, useRef } from 'react';
import {
  CircleDot,
  FileText,
  LockKeyhole,
  MessageSquare,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { FrozenContextItem } from '../api';
import type { DiscussionContextKind } from './discussionContextModel';

interface FrozenContextInspectorProps {
  item: FrozenContextItem;
  onClose: () => void;
}

const kindLabels: Record<DiscussionContextKind, string> = {
  project_description: 'Project description',
  bubble: 'Bubble',
  document: 'Document',
};

const kindIcons: Record<DiscussionContextKind, LucideIcon> = {
  project_description: CircleDot,
  bubble: MessageSquare,
  document: FileText,
};

function formatCapturedAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function FrozenContextInspector({
  item,
  onClose,
}: FrozenContextInspectorProps) {
  const titleId = useId();
  const descriptionId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const Icon = kindIcons[item.source_kind];

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, [item.id]);

  return (
    <aside
      className="flex h-[280px] max-h-[45%] min-h-0 w-full shrink-0 flex-col border-t border-[#d9e0e8] bg-white md:h-auto md:max-h-none md:w-[320px] md:border-t-0 md:border-l"
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      data-frozen-context-id={item.id}
      role="region"
    >
      <header className="shrink-0 border-b border-[#eef1f5] px-4 py-3.5">
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[9px] bg-[#eef2fa] text-[#3f63a8]"
            aria-hidden="true"
          >
            <Icon className="size-4" strokeWidth={1.7} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 text-[9.5px] font-semibold tracking-[0.06em] text-[#77869a] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
              <LockKeyhole
                className="size-3 shrink-0"
                strokeWidth={1.8}
                aria-hidden="true"
              />
              Frozen discussion context
            </p>
            <h3
              className="mt-1 break-words text-[13.5px] leading-[1.35] font-semibold text-[#1e2733]"
              id={titleId}
            >
              {item.source_title}
            </h3>
          </div>
          <button
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-[9px] border border-[#e1e6ec] bg-white text-[#6f7d8e] hover:border-[#c7d2df] hover:bg-[#f6f8fc] hover:text-[#40516a] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/30"
            type="button"
            aria-label="Close frozen context Inspector"
            onClick={onClose}
            ref={closeButtonRef}
          >
            <X className="size-4" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        <p className="sr-only" id={descriptionId}>
          This is the immutable content captured when the discussion started.
          It cannot be edited or refreshed from the live source.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[#fbfcfd] px-4 py-4">
        <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-b border-[#e8edf3] pb-4 text-[10.5px]">
          <dt className="font-medium text-[#8b97a6]">Source</dt>
          <dd className="text-right font-medium text-[#526174]">
            {kindLabels[item.source_kind]}
          </dd>
          <dt className="font-medium text-[#8b97a6]">Captured</dt>
          <dd className="text-right text-[#6f7d8e]">
            <time dateTime={item.created_at}>
              {formatCapturedAt(item.created_at)}
            </time>
          </dd>
        </dl>

        <div
          className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.65] text-[#344050]"
          data-frozen-context-content
        >
          {item.frozen_content || (
            <span className="italic text-[#8b97a6]">
              The project description was empty when this discussion started.
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}

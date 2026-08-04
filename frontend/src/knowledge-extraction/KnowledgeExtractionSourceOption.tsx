import {
  AlertCircle,
  Check,
  CircleDot,
  FileText,
  MessageSquare,
  MousePointer2,
  type LucideIcon,
} from 'lucide-react';
import type {
  DiscussionMessage,
  FrozenContextItem,
} from '../api';
import { focusRing } from '../ui/focusRing';
import type { KnowledgeExtractionSourceIssue } from './knowledgeExtractionStateMachine';
import type { KnowledgeExtractionController } from './useKnowledgeExtraction';

const frozenContextKindLabels: Record<
  FrozenContextItem['source_kind'],
  string
> = {
  project_description: 'Project description snapshot',
  bubble: 'Bubble snapshot',
  document: 'Document snapshot',
};

const frozenContextKindIcons: Record<
  FrozenContextItem['source_kind'],
  LucideIcon
> = {
  project_description: CircleDot,
  bubble: MessageSquare,
  document: FileText,
};

const sourceIssueLabels: Record<
  KnowledgeExtractionSourceIssue['reason'],
  string
> = {
  missing: 'This source no longer exists.',
  cross_project: 'This source belongs to another project.',
  cross_discussion: 'This source belongs to another discussion.',
  inaccessible: 'This source is no longer accessible.',
};

function SelectionIndicator({ selected }: { selected: boolean }) {
  return (
    <span
      className={`grid size-6 shrink-0 place-items-center rounded-md border ${
        selected
          ? 'border-[#3f63a8] bg-[#3f63a8] text-white'
          : 'border-[#cbd4df] bg-white text-transparent'
      }`}
      aria-hidden="true"
    >
      <Check className="size-4" strokeWidth={2.4} />
    </span>
  );
}

function SourceIssue({
  issue,
}: {
  issue: KnowledgeExtractionSourceIssue;
}) {
  return (
    <span className="mt-2.5 flex items-center gap-1.75 text-[12.5px] font-semibold text-[#a64540]">
      <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
      {sourceIssueLabels[issue.reason]}
    </span>
  );
}

export function MessageSource({
  controller,
  disabled,
  errorId,
  extractingFrom,
  issue,
  message,
  setSourceRef,
  threadPosition,
}: {
  controller: KnowledgeExtractionController;
  disabled: boolean;
  errorId: string;
  extractingFrom: boolean;
  issue: KnowledgeExtractionSourceIssue | null;
  message: DiscussionMessage;
  setSourceRef: (element: HTMLButtonElement | null) => void;
  threadPosition: number;
}) {
  const selected =
    controller.state.selection.messageIds.includes(message.id);
  const isUser = message.role === 'user';

  return (
    <button
      className={`w-full cursor-pointer border-b border-[#e7ebf1] px-4.75 py-3.5 text-left transition-colors last:border-b-0 motion-reduce:transition-none ${
        selected
          ? 'bg-[#f2f5fb]'
          : 'bg-white hover:bg-[#f8f9fc]'
      } ${issue ? 'bg-[#fff8f7]' : ''} disabled:cursor-not-allowed disabled:opacity-65 ${focusRing}`}
      type="button"
      aria-checked={selected}
      aria-describedby={issue ? errorId : undefined}
      aria-invalid={issue ? 'true' : undefined}
      aria-label={`${isUser ? 'Your message' : 'Nuée response'}, message ${threadPosition}`}
      data-extraction-source-id={message.id}
      data-extraction-source-kind="message"
      data-extraction-start-source={extractingFrom ? 'true' : undefined}
      disabled={disabled}
      onClick={() => controller.toggleMessage(message.id)}
      ref={setSourceRef}
      role="checkbox"
    >
      <span className="flex items-start gap-3.5">
        <SelectionIndicator selected={selected} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.25">
            <span
              className={`text-[11.5px] font-semibold tracking-[0.07em] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${
                isUser ? 'text-[#7c899a]' : 'text-[#4667a8]'
              }`}
            >
              {isUser ? 'You' : 'Nuée'}
            </span>
            <span className="text-[11.5px] font-semibold text-[#a6b0bd] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
              {threadPosition}
            </span>
            {extractingFrom && (
              <span className="inline-flex items-center gap-1.25 rounded-md border border-[#cbd8ee] bg-[#edf3fc] px-1.75 py-0.5 text-[10px] font-semibold tracking-[0.07em] text-[#4f70ae] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
                <MousePointer2
                  className="size-3"
                  strokeWidth={1.9}
                  aria-hidden="true"
                />
                Extracting from
              </span>
            )}
          </span>
          <span className="mt-1.25 block line-clamp-2 whitespace-pre-wrap break-words text-[14.5px] leading-[1.55] text-[#465469]">
            {message.content}
          </span>
          {issue && <SourceIssue issue={issue} />}
        </span>
      </span>
    </button>
  );
}

export function FrozenContextSource({
  controller,
  disabled,
  errorId,
  issue,
  item,
  setSourceRef,
}: {
  controller: KnowledgeExtractionController;
  disabled: boolean;
  errorId: string;
  issue: KnowledgeExtractionSourceIssue | null;
  item: FrozenContextItem;
  setSourceRef: (element: HTMLButtonElement | null) => void;
}) {
  const selected =
    controller.state.selection.frozenContextItemIds.includes(item.id);
  const Icon = frozenContextKindIcons[item.source_kind];

  return (
    <button
      className={`flex w-full cursor-pointer items-start gap-3.5 rounded-xl border px-4.25 py-3.5 text-left transition-[border-color,background-color,box-shadow] motion-reduce:transition-none ${
        selected
          ? 'border-[#7892c0] bg-[#edf3fc] shadow-[0_0_0_2px_rgba(63,99,168,0.09)]'
          : 'border-[#dce3eb] bg-white hover:border-[#b9c7da] hover:bg-[#f7f9fc]'
      } ${issue ? 'border-[#d9918b] bg-[#fff8f7]' : ''} disabled:cursor-not-allowed disabled:opacity-65 ${focusRing}`}
      type="button"
      aria-checked={selected}
      aria-describedby={issue ? errorId : undefined}
      aria-invalid={issue ? 'true' : undefined}
      aria-label={`Select frozen context: ${item.source_title}`}
      data-extraction-source-id={item.id}
      data-extraction-source-kind="frozen_context"
      disabled={disabled}
      onClick={() => controller.toggleFrozenContextItem(item.id)}
      ref={setSourceRef}
      role="checkbox"
    >
      <SelectionIndicator selected={selected} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.75 text-[11.5px] font-semibold tracking-[0.06em] text-[#708098] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
          <Icon
            className="size-4 shrink-0"
            strokeWidth={1.7}
            aria-hidden="true"
          />
          {frozenContextKindLabels[item.source_kind]}
        </span>
        <span className="mt-1.25 block truncate text-[15px] font-semibold text-[#344050]">
          {item.source_title}
        </span>
        <span className="mt-1.25 block text-[12.5px] leading-[1.45] text-[#77869a]">
          Stored when this discussion started. Changes to the live source are
          not included.
        </span>
        {issue && <SourceIssue issue={issue} />}
      </span>
    </button>
  );
}

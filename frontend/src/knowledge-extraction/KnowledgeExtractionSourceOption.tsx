import type { RefObject } from 'react';
import {
  AlertCircle,
  Check,
  CircleDot,
  FileText,
  MessageSquare,
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
      className={`grid size-5 shrink-0 place-items-center rounded-md border ${
        selected
          ? 'border-[#3f63a8] bg-[#3f63a8] text-white'
          : 'border-[#cbd4df] bg-white text-transparent'
      }`}
      aria-hidden="true"
    >
      <Check className="size-3.25" strokeWidth={2.4} />
    </span>
  );
}

function SourceIssue({
  issue,
}: {
  issue: KnowledgeExtractionSourceIssue;
}) {
  return (
    <span className="mt-2 flex items-center gap-1.5 text-[10.5px] font-semibold text-[#a64540]">
      <AlertCircle className="size-3.25 shrink-0" aria-hidden="true" />
      {sourceIssueLabels[issue.reason]}
    </span>
  );
}

export function WholeDiscussionSource({
  buttonRef,
  controller,
  disabled,
  messageIds,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  controller: KnowledgeExtractionController;
  disabled: boolean;
  messageIds: readonly string[];
}) {
  const selected =
    messageIds.length > 0 &&
    controller.state.selection.messageIds.length === messageIds.length &&
    messageIds.every((messageId) =>
      controller.state.selection.messageIds.includes(messageId),
    );

  return (
    <button
      className={`flex w-full cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors motion-reduce:transition-none ${
        selected
          ? 'border-[#7892c0] bg-[#edf3fc] shadow-[0_0_0_2px_rgba(63,99,168,0.09)]'
          : 'border-[#dce3eb] bg-white hover:border-[#b9c7da] hover:bg-[#f7f9fc]'
      } disabled:cursor-not-allowed disabled:opacity-55 ${focusRing}`}
      type="button"
      aria-label="Select complete discussion for extraction"
      aria-pressed={selected}
      disabled={disabled || messageIds.length === 0}
      onClick={() =>
        controller.setMessageIds(selected ? [] : messageIds)
      }
      ref={buttonRef}
    >
      <SelectionIndicator selected={selected} />
      <span className="min-w-0">
        <span className="block text-[12.5px] font-semibold text-[#344050]">
          Complete discussion
        </span>
        <span className="mt-1 block text-[11px] leading-[1.5] text-[#718096]">
          Includes all persisted user and AI messages available when you
          generate the proposal
          {messageIds.length > 0
            ? ` — currently ${messageIds.length}.`
            : '.'}
        </span>
      </span>
    </button>
  );
}

export function MessageSource({
  controller,
  disabled,
  errorId,
  issue,
  message,
  setSourceRef,
}: {
  controller: KnowledgeExtractionController;
  disabled: boolean;
  errorId: string;
  issue: KnowledgeExtractionSourceIssue | null;
  message: DiscussionMessage;
  setSourceRef: (element: HTMLButtonElement | null) => void;
}) {
  const selected =
    controller.state.selection.messageIds.includes(message.id);
  const isUser = message.role === 'user';

  return (
    <button
      className={`w-full cursor-pointer rounded-2xl border p-3.5 text-left transition-[border-color,background-color,box-shadow] motion-reduce:transition-none ${
        selected
          ? 'border-[#7892c0] bg-[#edf3fc] shadow-[0_0_0_2px_rgba(63,99,168,0.09)]'
          : isUser
            ? 'border-[#d6dfec] bg-[#f7f9fc] hover:border-[#b9c7da]'
            : 'border-[#dfe5ec] bg-white hover:border-[#bbc8d8]'
      } ${issue ? 'border-[#d9918b] bg-[#fff8f7]' : ''} disabled:cursor-not-allowed disabled:opacity-65 ${focusRing}`}
      type="button"
      aria-describedby={issue ? errorId : undefined}
      aria-invalid={issue ? 'true' : undefined}
      aria-label={
        isUser
          ? 'Select your message for extraction'
          : 'Select AI response for extraction'
      }
      aria-pressed={selected}
      data-extraction-source-id={message.id}
      data-extraction-source-kind="message"
      disabled={disabled}
      onClick={() => controller.toggleMessage(message.id)}
      ref={setSourceRef}
    >
      <span className="flex items-start gap-3">
        <SelectionIndicator selected={selected} />
        <span className="min-w-0 flex-1">
          <span
            className={`block text-[9.5px] font-semibold tracking-[0.07em] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${
              isUser ? 'text-[#5873a7]' : 'text-[#7a8798]'
            }`}
          >
            {isUser ? 'Your message' : 'AI response'}
          </span>
          <span className="mt-1.5 block whitespace-pre-wrap break-words text-[12.5px] leading-[1.6] text-[#344050]">
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
      className={`flex w-full cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-[border-color,background-color,box-shadow] motion-reduce:transition-none ${
        selected
          ? 'border-[#7892c0] bg-[#edf3fc] shadow-[0_0_0_2px_rgba(63,99,168,0.09)]'
          : 'border-[#dce3eb] bg-white hover:border-[#b9c7da] hover:bg-[#f7f9fc]'
      } ${issue ? 'border-[#d9918b] bg-[#fff8f7]' : ''} disabled:cursor-not-allowed disabled:opacity-65 ${focusRing}`}
      type="button"
      aria-describedby={issue ? errorId : undefined}
      aria-invalid={issue ? 'true' : undefined}
      aria-label={`Select frozen context: ${item.source_title}`}
      aria-pressed={selected}
      data-extraction-source-id={item.id}
      data-extraction-source-kind="frozen_context"
      disabled={disabled}
      onClick={() => controller.toggleFrozenContextItem(item.id)}
      ref={setSourceRef}
    >
      <SelectionIndicator selected={selected} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[9.5px] font-semibold tracking-[0.06em] text-[#708098] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
          <Icon
            className="size-3.25 shrink-0"
            strokeWidth={1.7}
            aria-hidden="true"
          />
          {frozenContextKindLabels[item.source_kind]}
        </span>
        <span className="mt-1 block truncate text-[12.5px] font-semibold text-[#344050]">
          {item.source_title}
        </span>
        <span className="mt-1 block text-[10.5px] leading-[1.45] text-[#77869a]">
          Stored when this discussion started. Changes to the live source are
          not included.
        </span>
        {issue && <SourceIssue issue={issue} />}
      </span>
    </button>
  );
}

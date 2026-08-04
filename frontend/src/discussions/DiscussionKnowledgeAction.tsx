import { Sparkles } from 'lucide-react';
import { focusRing } from '../ui/focusRing';

export interface DiscussionKnowledgeSource {
  discussionId: string;
  messageId?: string;
}

export type DiscussionKnowledgeActionHandler = (
  source: DiscussionKnowledgeSource,
  trigger: HTMLButtonElement,
) => void;

interface DiscussionKnowledgeActionProps {
  disabled?: boolean;
  disabledReason?: string;
  onExtract?: DiscussionKnowledgeActionHandler;
  source: DiscussionKnowledgeSource;
  variant: 'header' | 'message';
}

export function DiscussionKnowledgeAction({
  disabled = false,
  disabledReason,
  onExtract,
  source,
  variant,
}: DiscussionKnowledgeActionProps) {
  const isHeader = variant === 'header';
  const isDisabled = disabled || !onExtract;

  return (
    <button
      className={
        isHeader
          ? `inline-flex h-9.5 cursor-pointer items-center gap-1.75 rounded-[11px] border border-[#d5dfed] bg-[#f6f8fc] px-3 text-[12.5px] font-semibold text-[#3f63a8] hover:border-[#b8c7dc] hover:bg-[#edf2fa] disabled:cursor-not-allowed disabled:border-[#e4e8ed] disabled:bg-[#f8f9fb] disabled:text-[#a5aeba] ${focusRing}`
          : `inline-flex cursor-pointer items-center gap-1.75 rounded-lg border border-[#d9e2ef] bg-[#f8faff] px-3 py-1.75 text-[12.5px] font-semibold text-[#4b67a0] hover:border-[#bdcbe0] hover:bg-[#eef3fb] disabled:cursor-not-allowed disabled:border-[#e7eaf0] disabled:bg-[#fafbfc] disabled:text-[#a8b0bb] ${focusRing}`
      }
      type="button"
      aria-label={
        source.messageId
          ? 'Extract knowledge from this response'
          : 'Extract knowledge from discussion'
      }
      data-knowledge-extraction-entry={variant}
      data-knowledge-extraction-message-id={source.messageId}
      disabled={isDisabled}
      title={
        isDisabled
          ? (disabledReason ?? 'Knowledge extraction is not available')
          : 'Extract knowledge'
      }
      onClick={(event) => onExtract?.(source, event.currentTarget)}
    >
      <Sparkles
        className={isHeader ? 'size-4.25' : 'size-4'}
        strokeWidth={1.8}
        aria-hidden="true"
      />
      Extract knowledge
    </button>
  );
}

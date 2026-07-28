import { Sparkles } from 'lucide-react';

export interface DiscussionKnowledgeSource {
  discussionId: string;
  messageId?: string;
}

interface DiscussionKnowledgeActionProps {
  onExtract?: (source: DiscussionKnowledgeSource) => void;
  source: DiscussionKnowledgeSource;
  variant: 'header' | 'message';
}

const focusRing =
  'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/25';

export function DiscussionKnowledgeAction({
  onExtract,
  source,
  variant,
}: DiscussionKnowledgeActionProps) {
  const isHeader = variant === 'header';

  return (
    <button
      className={
        isHeader
          ? `inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[9px] border border-[#d5dfed] bg-[#f6f8fc] px-2.5 text-[10.5px] font-semibold text-[#3f63a8] hover:border-[#b8c7dc] hover:bg-[#edf2fa] disabled:cursor-not-allowed disabled:border-[#e4e8ed] disabled:bg-[#f8f9fb] disabled:text-[#a5aeba] ${focusRing}`
          : `inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#d9e2ef] bg-[#f8faff] px-2.5 py-1.5 text-[10.5px] font-semibold text-[#4b67a0] hover:border-[#bdcbe0] hover:bg-[#eef3fb] disabled:cursor-not-allowed disabled:border-[#e7eaf0] disabled:bg-[#fafbfc] disabled:text-[#a8b0bb] ${focusRing}`
      }
      type="button"
      aria-label={
        source.messageId
          ? 'Extract knowledge from this response'
          : 'Extract knowledge from discussion'
      }
      disabled={!onExtract}
      title={
        onExtract
          ? 'Extract knowledge'
          : 'Knowledge extraction is not available yet'
      }
      onClick={() => onExtract?.(source)}
    >
      <Sparkles
        className={isHeader ? 'size-3.5' : 'size-3.25'}
        strokeWidth={1.8}
        aria-hidden="true"
      />
      Extract knowledge
    </button>
  );
}

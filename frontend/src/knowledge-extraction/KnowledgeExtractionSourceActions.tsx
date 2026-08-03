import { LoaderCircle, Sparkles } from 'lucide-react';
import type { DiscussionDetails } from '../api';
import { focusRing } from '../ui/focusRing';
import { hasKnowledgeExtractionSources } from './knowledgeExtractionStateMachine';
import { eligibleKnowledgeExtractionMessages } from './knowledgeExtractionSources';
import type { KnowledgeExtractionController } from './useKnowledgeExtraction';

export interface KnowledgeExtractionSourceActionsProps {
  controller: KnowledgeExtractionController;
  discussion: DiscussionDetails;
  onCancel: () => void;
}

export function KnowledgeExtractionSourceActions({
  controller,
  discussion,
  onCancel,
}: KnowledgeExtractionSourceActionsProps) {
  const messages = eligibleKnowledgeExtractionMessages(discussion);
  const selectedMessageCount =
    controller.state.selection.messageSelection.kind ===
    'whole_discussion'
      ? messages.length
      : controller.state.selection.messageSelection.message_ids.length;
  const selectedContextCount =
    controller.state.selection.frozenContextItemIds.length;
  const selectedCount = selectedMessageCount + selectedContextCount;
  const hasSources = hasKnowledgeExtractionSources(
    controller.state.selection,
  );
  const isGenerating = controller.state.status === 'generating';
  const isReviewing = controller.state.status === 'reviewing';
  const requiresSelectionChange =
    controller.state.status === 'source_invalid';
  const generateLabel =
    controller.state.status === 'generation_failed'
      ? 'Retry generation'
      : isGenerating
        ? 'Generating proposal…'
        : isReviewing
          ? 'Proposal ready'
          : 'Generate proposal';

  return (
    <div className="shrink-0 border-t border-[#e2e7ee] bg-white px-4 py-3.5 sm:px-5">
      <div className="mx-auto flex w-full max-w-[650px] items-center gap-3">
        <p
          className="min-w-0 flex-1 text-[10.5px] leading-[1.45] text-[#77869a]"
          aria-live="polite"
          role="status"
        >
          {isGenerating
            ? `Generating knowledge proposal from ${selectedCount} selected ${
                selectedCount === 1 ? 'source' : 'sources'
              }.`
            : selectedCount === 0
            ? 'Select at least one eligible source.'
            : `${
                controller.state.selection.messageSelection.kind ===
                'whole_discussion'
                  ? `Complete discussion (${messages.length} messages)`
                  : `${selectedMessageCount} ${
                      selectedMessageCount === 1 ? 'message' : 'messages'
                    }`
              }${
                selectedContextCount > 0
                  ? ` and ${selectedContextCount} frozen ${
                      selectedContextCount === 1 ? 'snapshot' : 'snapshots'
                    }`
                  : ''
              } selected.`}
        </p>
        <button
          className={`min-h-9 shrink-0 cursor-pointer rounded-[9px] border border-[#d3dae2] bg-white px-3.5 text-xs font-semibold text-[#5c6a7a] hover:bg-[#f6f8fc] hover:text-[#344050] ${focusRing}`}
          type="button"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className={`inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-2 rounded-[9px] bg-[#3f63a8] px-3.5 text-xs font-semibold text-white shadow-[0_6px_16px_-8px_rgba(63,99,168,0.7)] hover:bg-[#33538f] disabled:cursor-not-allowed disabled:bg-[#aebbd1] disabled:shadow-none ${focusRing}`}
          type="button"
          disabled={
            !hasSources ||
            isGenerating ||
            isReviewing ||
            requiresSelectionChange
          }
          onClick={() => {
            void controller.generateProposal();
          }}
        >
          {isGenerating ? (
            <LoaderCircle
              className="size-3.5 animate-spin motion-reduce:animate-none"
              strokeWidth={1.9}
              aria-hidden="true"
            />
          ) : (
            <Sparkles
              className="size-3.5"
              strokeWidth={1.9}
              aria-hidden="true"
            />
          )}
          {generateLabel}
        </button>
      </div>
    </div>
  );
}

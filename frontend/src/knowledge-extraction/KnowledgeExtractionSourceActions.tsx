import { LoaderCircle, Sparkles } from 'lucide-react';
import { focusRing } from '../ui/focusRing';
import { hasKnowledgeExtractionSources } from './knowledgeExtractionStateMachine';
import type { KnowledgeExtractionController } from './useKnowledgeExtraction';

export interface KnowledgeExtractionSourceActionsProps {
  controller: KnowledgeExtractionController;
  onCancel: () => void;
}

export function KnowledgeExtractionSourceActions({
  controller,
  onCancel,
}: KnowledgeExtractionSourceActionsProps) {
  const selectedMessageCount =
    controller.state.selection.messageIds.length;
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
    isGenerating
        ? 'Generating bubble…'
        : isReviewing
          ? 'Bubble ready'
          : 'Generate bubble';
  const detailLabel = controller.state.selection.detailLevel.toUpperCase();

  return (
    <div className="shrink-0 border-t border-[#e2e7ee] bg-white px-4 py-3.5 sm:px-5">
      <div className="mx-auto flex w-full max-w-[900px] flex-wrap items-center gap-3">
        <div
          className="min-w-0 flex-1 text-[9.5px] leading-[1.45] tracking-[0.04em] text-[#9aa6b6] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace]"
          aria-live="polite"
          role="status"
        >
          <p>
            {isGenerating
              ? `Generating from ${selectedCount} selected ${
                  selectedCount === 1 ? 'source' : 'sources'
                } · ${detailLabel}`
              : selectedCount === 0
                ? `No sources selected · ${detailLabel}`
                : `${selectedMessageCount} ${
                selectedMessageCount === 1 ? 'message' : 'messages'
                  }${
                    selectedContextCount > 0
                      ? ` + ${selectedContextCount} ${
                          selectedContextCount === 1
                            ? 'snapshot'
                            : 'snapshots'
                        }`
                      : ''
                  } · ${detailLabel}`}
          </p>
          <p className="mt-0.5 text-[#a7b1bf]">
            You&apos;ll review the draft before it lands
          </p>
        </div>
        <button
          className={`min-h-10 shrink-0 cursor-pointer rounded-[10px] border border-[#d3dae2] bg-white px-5 text-xs font-semibold text-[#5c6a7a] hover:bg-[#f6f8fc] hover:text-[#344050] ${focusRing}`}
          type="button"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className={`inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-2 rounded-[10px] bg-[#4267ad] px-5 text-xs font-semibold text-white shadow-[0_6px_16px_-8px_rgba(63,99,168,0.7)] hover:bg-[#33538f] disabled:cursor-not-allowed disabled:bg-[#aebbd1] disabled:shadow-none ${focusRing}`}
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

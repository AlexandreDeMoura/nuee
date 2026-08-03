import { useEffect, useId, useMemo, useRef } from 'react';
import {
  AlertCircle,
  LockKeyhole,
  Sparkles,
} from 'lucide-react';
import type { DiscussionDetails } from '../api';
import type { KnowledgeExtractionSourceIssue } from './knowledgeExtractionStateMachine';
import {
  eligibleKnowledgeExtractionContextItems,
  eligibleKnowledgeExtractionMessages,
  knowledgeExtractionSourceRefKey,
} from './knowledgeExtractionSources';
import {
  FrozenContextSource,
  MessageSource,
  WholeDiscussionSource,
} from './KnowledgeExtractionSourceOption';
import type { KnowledgeExtractionController } from './useKnowledgeExtraction';

function sourceIssue(
  issues: readonly KnowledgeExtractionSourceIssue[],
  sourceKind: KnowledgeExtractionSourceIssue['sourceKind'],
  sourceId: string,
): KnowledgeExtractionSourceIssue | null {
  return (
    issues.find(
      (issue) =>
        issue.sourceKind === sourceKind && issue.sourceId === sourceId,
    ) ?? null
  );
}

export interface KnowledgeExtractionSourceSelectionProps {
  controller: KnowledgeExtractionController;
  discussion: DiscussionDetails;
}

export function KnowledgeExtractionSourceSelection({
  controller,
  discussion,
}: KnowledgeExtractionSourceSelectionProps) {
  const errorId = useId();
  const initialFocusAppliedRef = useRef(false);
  const sourceRefs = useRef(new Map<string, HTMLButtonElement>());
  const wholeDiscussionRef = useRef<HTMLButtonElement>(null);
  const messages = useMemo(
    () => eligibleKnowledgeExtractionMessages(discussion),
    [discussion],
  );
  const contextItems = useMemo(
    () => eligibleKnowledgeExtractionContextItems(discussion),
    [discussion],
  );
  const failure =
    controller.state.failure?.kind === 'source_validation' ||
    controller.state.failure?.kind === 'generation'
      ? controller.state.failure
      : null;
  const issues = useMemo(
    () =>
      failure?.kind === 'source_validation'
        ? failure.sourceIssues
        : [],
    [failure],
  );
  const controlsDisabled =
    controller.state.status === 'generating' ||
    controller.state.status === 'reviewing';

  useEffect(() => {
    if (
      initialFocusAppliedRef.current ||
      controller.state.status !== 'selecting'
    ) {
      return;
    }

    const selectedMessageId =
      controller.state.selection.messageIds[0];
    const selectedContextId =
      controller.state.selection.frozenContextItemIds[0];
    const initialTarget = selectedMessageId
      ? sourceRefs.current.get(
          knowledgeExtractionSourceRefKey(
            'message',
            selectedMessageId,
          ),
        )
      : selectedContextId
        ? sourceRefs.current.get(
            knowledgeExtractionSourceRefKey(
              'frozen_context',
              selectedContextId,
            ),
          )
        : messages.length > 0
          ? wholeDiscussionRef.current
          : sourceRefs.current.get(
              knowledgeExtractionSourceRefKey(
                'frozen_context',
                contextItems[0]?.id ?? '',
              ),
            );

    if (initialTarget) {
      initialFocusAppliedRef.current = true;
      initialTarget.focus();
    }
  }, [
    contextItems,
    controller.state.selection.frozenContextItemIds,
    controller.state.selection.messageIds,
    controller.state.status,
    messages.length,
  ]);

  useEffect(() => {
    if (
      controller.state.status !== 'source_invalid' ||
      issues.length === 0
    ) {
      return;
    }

    const firstIssue = issues[0];
    const affectedSource = sourceRefs.current.get(
      knowledgeExtractionSourceRefKey(
        firstIssue.sourceKind,
        firstIssue.sourceId,
      ),
    );

    affectedSource?.focus();
  }, [controller.state.status, issues]);

  const registerSource =
    (
      sourceKind: KnowledgeExtractionSourceIssue['sourceKind'],
      sourceId: string,
    ) =>
    (element: HTMLButtonElement | null) => {
      const key = knowledgeExtractionSourceRefKey(
        sourceKind,
        sourceId,
      );

      if (element) {
        sourceRefs.current.set(key, element);
      } else {
        sourceRefs.current.delete(key);
      }
    };

  return (
    <section
      className="mx-auto flex w-full max-w-[650px] flex-col gap-5"
      aria-labelledby="knowledge-extraction-source-title"
      data-knowledge-extraction-status={controller.state.status}
    >
      <header className="rounded-2xl border border-[#ced9e8] bg-[linear-gradient(145deg,#f4f7fc,#edf2fa)] px-4 py-4">
        <span className="mb-2 inline-flex items-center gap-1.5 text-[9.5px] font-semibold tracking-[0.08em] text-[#5e78aa] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
          <Sparkles
            className="size-3.5"
            strokeWidth={1.8}
            aria-hidden="true"
          />
          Knowledge extraction
        </span>
        <h3
          className="text-[16px] font-semibold text-[#273446]"
          id="knowledge-extraction-source-title"
        >
          Choose source material
        </h3>
        <p className="mt-1.5 text-[11.5px] leading-[1.55] text-[#68778b]">
          Select only what the proposal should synthesize. Nothing is added to
          the canvas until you review and approve it.
        </p>
      </header>

      {failure && (
        <div
          className="rounded-xl border border-[#e8c4c0] bg-[#fff8f7] px-3.5 py-3 text-[#8f3f3a]"
          id={errorId}
          role="alert"
        >
          <span className="flex items-start gap-2">
            <AlertCircle
              className="mt-0.5 size-4 shrink-0"
              strokeWidth={1.8}
              aria-hidden="true"
            />
            <span>
              <span className="block text-[12px] font-semibold">
                {failure.kind === 'generation'
                  ? 'Proposal generation failed'
                  : 'Review the selected sources'}
              </span>
              <span className="mt-0.5 block text-[11px] leading-[1.5] text-[#a25a55]">
                {failure.message}
              </span>
            </span>
          </span>
        </div>
      )}

      <div
        className="space-y-2"
        aria-label="Discussion scope"
        role="group"
      >
        <div>
          <h4 className="text-[11px] font-semibold text-[#465568]">
            Discussion messages
          </h4>
          <p className="mt-0.5 text-[10.5px] leading-[1.45] text-[#8490a0]">
            Choose the complete persisted discussion or any individual
            messages.
          </p>
        </div>
        <WholeDiscussionSource
          buttonRef={wholeDiscussionRef}
          controller={controller}
          disabled={controlsDisabled}
          messageIds={messages.map((message) => message.id)}
        />
      </div>

      <div
        className="space-y-3"
        aria-label="Individual message sources"
        role="group"
      >
        {messages.map((message) => (
          <MessageSource
            controller={controller}
            disabled={controlsDisabled}
            errorId={errorId}
            issue={sourceIssue(issues, 'message', message.id)}
            key={message.id}
            message={message}
            setSourceRef={registerSource('message', message.id)}
          />
        ))}
      </div>

      {contextItems.length > 0 && (
        <div
          className="space-y-2.5 border-t border-[#e3e8ef] pt-5"
          aria-label="Frozen context sources"
          role="group"
        >
          <div>
            <h4 className="flex items-center gap-1.5 text-[11px] font-semibold text-[#465568]">
              <LockKeyhole
                className="size-3.5 text-[#6f80a0]"
                strokeWidth={1.8}
                aria-hidden="true"
              />
              Frozen context snapshots
            </h4>
            <p className="mt-1 text-[10.5px] leading-[1.45] text-[#8490a0]">
              These are the stored copies attached to this discussion, not
              current live project content.
            </p>
          </div>
          {contextItems.map((item) => (
            <FrozenContextSource
              controller={controller}
              disabled={controlsDisabled}
              errorId={errorId}
              issue={sourceIssue(issues, 'frozen_context', item.id)}
              item={item}
              key={item.id}
              setSourceRef={registerSource('frozen_context', item.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

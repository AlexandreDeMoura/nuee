import { useCallback, useEffect, useRef, useState } from 'react';
import { DiscussionModal } from './DiscussionModal';
import { DiscussionComposer } from './DiscussionComposer';
import { DiscussionContextBadges } from './DiscussionContextBadges';
import { DiscussionContextSelection } from './DiscussionContextSelection';
import {
  findFrozenContextItem,
  getDiscussionContextBadges,
  type DiscussionContextInspection,
} from './discussionContextModel';
import { FrozenContextInspector } from './FrozenContextInspector';
import {
  DiscussionKnowledgeAction,
  type DiscussionKnowledgeSource,
} from './DiscussionKnowledgeAction';
import { DiscussionMessages } from './DiscussionMessages';
import type {
  DiscussionDetails,
  KnowledgeExtractionResolutionResponse,
} from '../api';
import {
  hasEligibleKnowledgeExtractionSource,
  KnowledgeExtractionDiscardDialog,
  KnowledgeExtractionProposalReview,
  KnowledgeExtractionSourceActions,
  KnowledgeExtractionSourceSelection,
  useKnowledgeExtraction,
  type KnowledgeExtractionRequests,
  type KnowledgeExtractionTargetSelectionRequest,
} from '../knowledge-extraction';
import {
  useDiscussionLifecycle,
  type DiscussionLifecycleRequests,
} from './useDiscussionLifecycle';
import type { DiscussionVisibilityController } from './useDiscussionVisibility';
import type { RecoveredDiscussionTurn } from './discussionModel';
import type { DiscussionDeleteTarget } from './DiscussionDeleteDialog';
import {
  analytics,
  trackAnalytics,
  type AnalyticsClient,
} from '../analytics';
import type { DiscussionContextSelectionController } from './useDiscussionContextSelection';

export interface DiscussionExperienceProps {
  analyticsClient?: AnalyticsClient;
  canSelectBubbleContext?: boolean;
  canSelectDocumentContext?: boolean;
  contextSelection?: DiscussionContextSelectionController;
  controller: DiscussionVisibilityController;
  createExtractionAttemptId?: () => string;
  extractionRequests?: KnowledgeExtractionRequests;
  isObscured?: boolean;
  onExtractKnowledge?: (source: DiscussionKnowledgeSource) => void;
  onKnowledgeExtractionResolved?: (
    response: KnowledgeExtractionResolutionResponse,
  ) => void;
  onKnowledgeExtractionTargetSelectionChange?: (
    selection: KnowledgeExtractionTargetSelectionRequest | null,
  ) => void;
  onInspectContext?: (inspection: DiscussionContextInspection) => void;
  onDiscussionChanged?: (discussion: DiscussionDetails) => void;
  onDelete?: (discussion: DiscussionDeleteTarget) => void;
  onMinimize?: () => void;
  projectId: string;
  requests?: DiscussionLifecycleRequests;
}

export function DiscussionExperience({
  analyticsClient,
  canSelectBubbleContext,
  canSelectDocumentContext,
  contextSelection,
  controller,
  createExtractionAttemptId,
  extractionRequests,
  isObscured,
  onExtractKnowledge,
  onKnowledgeExtractionResolved,
  onKnowledgeExtractionTargetSelectionChange,
  onInspectContext,
  onDiscussionChanged,
  onDelete,
  onMinimize,
  projectId,
  requests,
}: DiscussionExperienceProps) {
  const visibleDiscussion = controller.visibleDiscussion;

  if (!visibleDiscussion) {
    return null;
  }

  const identity =
    visibleDiscussion.kind === 'draft'
      ? `draft:${visibleDiscussion.key}`
      : `persisted:${visibleDiscussion.discussionId}`;

  return (
    <DiscussionExperienceModal
      controller={controller}
      analyticsClient={analyticsClient}
      canSelectBubbleContext={canSelectBubbleContext}
      canSelectDocumentContext={canSelectDocumentContext}
      contextSelection={contextSelection}
      createExtractionAttemptId={createExtractionAttemptId}
      extractionRequests={extractionRequests}
      isObscured={isObscured}
      onExtractKnowledge={onExtractKnowledge}
      onKnowledgeExtractionResolved={onKnowledgeExtractionResolved}
      onKnowledgeExtractionTargetSelectionChange={
        onKnowledgeExtractionTargetSelectionChange
      }
      onInspectContext={onInspectContext}
      key={identity}
      onDiscussionChanged={onDiscussionChanged}
      onDelete={onDelete}
      onMinimize={onMinimize}
      projectId={projectId}
      requests={requests}
      visibleDiscussion={visibleDiscussion}
    />
  );
}

function DiscussionExperienceModal({
  analyticsClient,
  canSelectBubbleContext,
  canSelectDocumentContext,
  contextSelection,
  controller,
  createExtractionAttemptId,
  extractionRequests,
  isObscured,
  onExtractKnowledge,
  onKnowledgeExtractionResolved,
  onKnowledgeExtractionTargetSelectionChange,
  onInspectContext,
  onDiscussionChanged,
  onDelete,
  onMinimize,
  projectId,
  requests,
  visibleDiscussion,
}: DiscussionExperienceProps & {
  visibleDiscussion: NonNullable<
    DiscussionVisibilityController['visibleDiscussion']
  >;
}) {
  const [inspectedContextId, setInspectedContextId] = useState<string | null>(
    null,
  );
  const [isDiscardConfirmationOpen, setIsDiscardConfirmationOpen] =
    useState(false);
  const [isRejectingExtraction, setIsRejectingExtraction] =
    useState(false);
  const inspectionTriggerRef = useRef<HTMLElement | null>(null);
  const extractionTriggerRef = useRef<{
    element: HTMLButtonElement;
    source: DiscussionKnowledgeSource;
  } | null>(null);
  const rejectInFlightRef = useRef(false);
  const resolvedAnalyticsClient = analyticsClient ?? analytics;
  const handleDiscussionCreated = useCallback(
    (discussion: {
      id: string;
      recoveredTurn?: RecoveredDiscussionTurn;
      title: string;
    }) => {
      contextSelection?.complete();
      controller.openDiscussion(discussion);
    },
    [contextSelection, controller],
  );
  const lifecycle = useDiscussionLifecycle({
    analyticsClient,
    onDiscussionCreated: handleDiscussionCreated,
    onDiscussionChanged,
    onDraftPromptChange: controller.updateDraftPrompt,
    projectId,
    requests,
    visibleDiscussion,
  });
  const extractionDiscussionId =
    visibleDiscussion.kind === 'persisted'
      ? visibleDiscussion.discussionId
      : (lifecycle.details?.id ?? '');
  const extraction = useKnowledgeExtraction({
    analyticsClient: resolvedAnalyticsClient,
    analyticsDiscussion: lifecycle.details,
    createAttemptId: createExtractionAttemptId,
    discussionId: extractionDiscussionId,
    onResolved: onKnowledgeExtractionResolved,
    projectId,
    requests: extractionRequests,
  });
  useEffect(
    () => () => {
      onKnowledgeExtractionTargetSelectionChange?.(null);
    },
    [onKnowledgeExtractionTargetSelectionChange],
  );
  const isDraft = visibleDiscussion.kind === 'draft';
  const isSelectingSources =
    isDraft &&
    (contextSelection?.phase === 'selecting_bubbles' ||
      contextSelection?.phase === 'selecting_documents');
  const isChoosingContext =
    isDraft &&
    contextSelection !== undefined &&
    (contextSelection.phase === 'invitation' ||
      contextSelection.phase === 'review' ||
      contextSelection.phase === 'error');

  useEffect(() => {
    if (
      contextSelection?.phase === 'submitting' &&
      !lifecycle.isSubmitting &&
      lifecycle.creationFailure
    ) {
      contextSelection.submissionFailed(lifecycle.creationFailure);
    }
  }, [
    contextSelection,
    lifecycle.creationFailure,
    lifecycle.isSubmitting,
  ]);
  const inspectContext = useCallback(
    (
      inspection: DiscussionContextInspection,
      trigger: HTMLButtonElement,
    ) => {
      inspectionTriggerRef.current = trigger;
      setInspectedContextId(inspection.item.id);
      onInspectContext?.(inspection);

      trackAnalytics(resolvedAnalyticsClient, 'discussion_context_inspected', {
        project_id: projectId,
        discussion_id: inspection.discussionId,
        context_id: inspection.item.id,
        source_kind: inspection.item.source_kind,
        occurred_at: new Date().toISOString(),
      });
    },
    [onInspectContext, projectId, resolvedAnalyticsClient],
  );
  const closeContextInspector = useCallback(() => {
    setInspectedContextId(null);

    queueMicrotask(() => {
      if (inspectionTriggerRef.current?.isConnected) {
        inspectionTriggerRef.current.focus();
      }
    });
  }, []);

  const unresolvedMessage = lifecycle.details?.messages.some(
    (message) =>
      message.role === 'user' &&
      (message.status === 'pending' || message.status === 'failed'),
  );
  const composerDisabled =
    lifecycle.loadStatus === 'loading' ||
    lifecycle.loadStatus === 'error' ||
    lifecycle.pendingTurn !== null ||
    unresolvedMessage === true;
  const title =
    lifecycle.details &&
    visibleDiscussion.kind === 'persisted' &&
    lifecycle.details.id === visibleDiscussion.discussionId
      ? lifecycle.details.title
      : visibleDiscussion.title;
  const presentedDiscussion =
    visibleDiscussion.kind === 'persisted'
      ? { ...visibleDiscussion, title }
      : visibleDiscussion;
  const contextBadges = lifecycle.details
    ? getDiscussionContextBadges(lifecycle.details)
    : [];
  const discussionId = lifecycle.details?.id;
  const inspectedContextItem = findFrozenContextItem(
    lifecycle.details,
    inspectedContextId,
  );
  const isExtractionFlowActive =
    extraction.state.status !== 'idle' &&
    extraction.state.status !== 'resolved' &&
    extraction.state.status !== 'discarded';
  const isReviewingExtraction =
    extraction.state.proposal !== null &&
    (extraction.state.status === 'reviewing' ||
      extraction.state.status === 'saving_new' ||
      extraction.state.status === 'saving_update');
  const isExtractionRequestActive =
    extraction.state.status === 'selecting' ||
    extraction.state.status === 'generating' ||
    extraction.state.status === 'generation_failed' ||
    extraction.state.status === 'source_invalid';
  const canStartExtraction =
    !isExtractionFlowActive &&
    hasEligibleKnowledgeExtractionSource(lifecycle.details);
  const startExtraction = useCallback(
    (
      source: DiscussionKnowledgeSource,
      trigger: HTMLButtonElement,
    ) => {
      const details = lifecycle.details;

      if (
        !details ||
        details.id !== source.discussionId ||
        !hasEligibleKnowledgeExtractionSource(details)
      ) {
        return;
      }

      if (
        source.messageId &&
        !details.messages.some(
          (message) =>
            message.id === source.messageId &&
            message.status === 'completed' &&
            message.content.trim().length > 0,
        )
      ) {
        return;
      }

      if (!extraction.start(source.messageId)) {
        return;
      }

      extractionTriggerRef.current = { element: trigger, source };
      setInspectedContextId(null);
      onExtractKnowledge?.(source);
      trackAnalytics(
        resolvedAnalyticsClient,
        'knowledge_extraction_started',
        {
          project_id: projectId,
          discussion_id: source.discussionId,
          entry_point: source.messageId
            ? 'assistant_response'
            : 'discussion_header',
          occurred_at: new Date().toISOString(),
        },
      );
    },
    [
      extraction,
      lifecycle.details,
      onExtractKnowledge,
      projectId,
      resolvedAnalyticsClient,
    ],
  );
  const restoreExtractionTriggerFocus = useCallback(() => {
    window.setTimeout(() => {
      const launch = extractionTriggerRef.current;

      if (!launch) {
        return;
      }

      if (launch.element.isConnected) {
        launch.element.focus();
        return;
      }

      const restoredTrigger = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '[data-knowledge-extraction-entry]',
        ),
      ).find((candidate) =>
        launch.source.messageId
          ? candidate.dataset.knowledgeExtractionEntry === 'message' &&
            candidate.dataset.knowledgeExtractionMessageId ===
              launch.source.messageId
          : candidate.dataset.knowledgeExtractionEntry === 'header',
      );

      restoredTrigger?.focus();
    }, 0);
  }, []);
  const cancelExtraction = useCallback(async () => {
    await extraction.discard();
    extraction.reset();
    restoreExtractionTriggerFocus();
  }, [extraction, restoreExtractionTriggerFocus]);
  const rejectExtraction = useCallback(async () => {
    if (rejectInFlightRef.current) {
      return;
    }

    rejectInFlightRef.current = true;
    setIsRejectingExtraction(true);

    try {
      const response = await extraction.reject();

      if (response?.resolution.kind !== 'reject') {
        return;
      }

      extraction.reset();
      restoreExtractionTriggerFocus();
    } finally {
      rejectInFlightRef.current = false;
      setIsRejectingExtraction(false);
    }
  }, [extraction, restoreExtractionTriggerFocus]);
  const approveExtractionAsNewBubble = useCallback(async () => {
    const response = await extraction.approveAsNewBubble();

    if (response?.resolution.kind !== 'new_bubble') {
      return;
    }

    extraction.reset();
    restoreExtractionTriggerFocus();
  }, [extraction, restoreExtractionTriggerFocus]);
  const beginExtractionUpdateTargetSelection = useCallback(() => {
    if (!onKnowledgeExtractionTargetSelectionChange) {
      return;
    }

    extraction.beginUpdateTargetSelection();
    onKnowledgeExtractionTargetSelectionChange({
      initialBubbleId: extraction.state.target?.id ?? null,
      onCancel: () => {
        extraction.cancelUpdateTargetSelection();
        onKnowledgeExtractionTargetSelectionChange(null);
      },
      onConfirm: (bubble) => {
        if (bubble.project_id !== projectId) {
          return;
        }

        extraction.selectUpdateTarget(bubble);
        onKnowledgeExtractionTargetSelectionChange(null);
      },
      projectId,
    });
  }, [
    extraction,
    onKnowledgeExtractionTargetSelectionChange,
    projectId,
  ]);
  const approveExtractionBubbleUpdate = useCallback(async () => {
    const response = await extraction.approveBubbleUpdate();

    if (response?.resolution.kind !== 'update_bubble') {
      return;
    }

    extraction.reset();
    restoreExtractionTriggerFocus();
  }, [extraction, restoreExtractionTriggerFocus]);
  const closeDiscussion = onMinimize ?? controller.minimize;
  const minimize = useCallback(() => {
    if (extraction.state.proposal) {
      setIsDiscardConfirmationOpen(true);
      return;
    }

    if (isExtractionFlowActive) {
      void extraction.discard();
    }

    closeDiscussion();
  }, [
    closeDiscussion,
    extraction,
    isExtractionFlowActive,
  ]);
  const confirmDiscardAndMinimize = useCallback(() => {
    setIsDiscardConfirmationOpen(false);
    void extraction.discard();
    closeDiscussion();
  }, [closeDiscussion, extraction]);
  const submit = () => {
    if (
      isDraft &&
      contextSelection &&
      contextSelection.phase === 'idle'
    ) {
      contextSelection.invite(lifecycle.composerValue.trim());
      return;
    }

    lifecycle.submit(
      isDraft && contextSelection
        ? contextSelection.selection
        : undefined,
    );
  };

  if (
    isSelectingSources ||
    extraction.state.status === 'selecting_update_target'
  ) {
    return null;
  }

  return (
    <>
      <DiscussionModal
      actionsSlot={
        discussionId && !isExtractionRequestActive ? (
          <DiscussionKnowledgeAction
            disabled={!canStartExtraction}
            disabledReason={
              isExtractionFlowActive
                ? 'Finish or cancel the current extraction first'
                : 'Complete a message or add non-empty frozen context first'
            }
            onExtract={startExtraction}
            source={{ discussionId }}
            variant="header"
          />
        ) : undefined
      }
      composerSlot={
        isReviewingExtraction ? (
          <></>
        ) : isExtractionFlowActive && lifecycle.details ? (
          <KnowledgeExtractionSourceActions
            controller={extraction}
            onCancel={() => {
              void cancelExtraction();
            }}
          />
        ) : isChoosingContext ? (
          <></>
        ) : (
          <DiscussionComposer
            disabled={composerDisabled}
            error={lifecycle.composerError}
            isInitialPrompt={visibleDiscussion.kind === 'draft'}
            isSubmitting={lifecycle.isSubmitting}
            onChange={lifecycle.onComposerChange}
            onSubmit={submit}
            onWebSearchChange={lifecycle.setWebSearchEnabled}
            value={lifecycle.composerValue}
            webSearchEnabled={lifecycle.webSearchEnabled}
            webSearchSupported={lifecycle.webSearchSupported}
          />
        )
      }
      inspectorSlot={
        inspectedContextItem ? (
          <FrozenContextInspector
            item={inspectedContextItem}
            onClose={closeContextInspector}
          />
        ) : undefined
      }
      isObscured={isObscured || isDiscardConfirmationOpen}
      presentation={
        isExtractionRequestActive ? 'extraction_request' : 'discussion'
      }
      presentationSubtitle={
        isExtractionRequestActive ? `from “${title}”` : undefined
      }
      presentationTitle={
        isExtractionRequestActive ? 'Extract as bubble' : undefined
      }
      contextSlot={
        !isExtractionFlowActive &&
        discussionId &&
        contextBadges.length > 0 ? (
          <DiscussionContextBadges
            badges={contextBadges}
            discussionId={discussionId}
            onInspect={inspectContext}
          />
        ) : undefined
      }
      messagesSlot={
        isReviewingExtraction ? (
          <KnowledgeExtractionProposalReview
            controller={extraction}
            isRejecting={isRejectingExtraction}
            onApproveAsNewBubble={approveExtractionAsNewBubble}
            onApproveBubbleUpdate={approveExtractionBubbleUpdate}
            onReject={rejectExtraction}
            onUpdateExistingBubble={
              onKnowledgeExtractionTargetSelectionChange
                ? beginExtractionUpdateTargetSelection
                : undefined
            }
          />
        ) : isExtractionFlowActive && lifecycle.details ? (
          <KnowledgeExtractionSourceSelection
            controller={extraction}
            discussion={lifecycle.details}
          />
        ) : isChoosingContext && contextSelection ? (
          <DiscussionContextSelection
            canSelectBubbles={canSelectBubbleContext}
            canSelectDocuments={canSelectDocumentContext}
            controller={contextSelection}
            onSubmit={(selection, selectionRevision) =>
              lifecycle.submit(selection, selectionRevision)
            }
          />
        ) : (
          <DiscussionMessages
            details={lifecycle.details}
            loadError={lifecycle.loadError}
            loadStatus={lifecycle.loadStatus}
            onExtractKnowledge={
              canStartExtraction ? startExtraction : undefined
            }
            onRetry={lifecycle.retryFailedTurn}
            pendingTurn={lifecycle.pendingTurn}
          />
        )
      }
      onDelete={
        visibleDiscussion.kind === 'persisted' && onDelete
          ? () =>
              onDelete({
                id: visibleDiscussion.discussionId,
                title,
              })
          : undefined
      }
      onCloseInspector={
        inspectedContextItem ? closeContextInspector : undefined
      }
      onDraftPromptChange={controller.updateDraftPrompt}
      onMinimize={
        isExtractionRequestActive
          ? () => {
              void cancelExtraction();
            }
          : minimize
      }
      visibleDiscussion={presentedDiscussion}
      />
      {isDiscardConfirmationOpen && (
        <KnowledgeExtractionDiscardDialog
          onCancel={() => setIsDiscardConfirmationOpen(false)}
          onConfirm={confirmDiscardAndMinimize}
        />
      )}
    </>
  );
}

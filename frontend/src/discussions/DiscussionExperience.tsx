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
import type { DiscussionDetails } from '../api';
import {
  useDiscussionLifecycle,
  type DiscussionLifecycleRequests,
} from './useDiscussionLifecycle';
import type { DiscussionVisibilityController } from './useDiscussionVisibility';
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
  isObscured?: boolean;
  onExtractKnowledge?: (source: DiscussionKnowledgeSource) => void;
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
  isObscured,
  onExtractKnowledge,
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
      isObscured={isObscured}
      onExtractKnowledge={onExtractKnowledge}
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
  isObscured,
  onExtractKnowledge,
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
  const inspectionTriggerRef = useRef<HTMLElement | null>(null);
  const resolvedAnalyticsClient = analyticsClient ?? analytics;
  const handleDiscussionCreated = useCallback(
    (discussion: { id: string; title: string }) => {
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

  if (isSelectingSources) {
    return null;
  }

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

  return (
    <DiscussionModal
      actionsSlot={
        discussionId ? (
          <DiscussionKnowledgeAction
            onExtract={onExtractKnowledge}
            source={{ discussionId }}
            variant="header"
          />
        ) : undefined
      }
      composerSlot={
        isChoosingContext ? (
          <></>
        ) : (
          <DiscussionComposer
            disabled={composerDisabled}
            error={lifecycle.composerError}
            isInitialPrompt={visibleDiscussion.kind === 'draft'}
            isSubmitting={lifecycle.isSubmitting}
            onChange={lifecycle.onComposerChange}
            onSubmit={submit}
            value={lifecycle.composerValue}
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
      isObscured={isObscured}
      contextSlot={
        discussionId && contextBadges.length > 0 ? (
          <DiscussionContextBadges
            badges={contextBadges}
            discussionId={discussionId}
            onInspect={inspectContext}
          />
        ) : undefined
      }
      messagesSlot={
        isChoosingContext && contextSelection ? (
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
            onExtractKnowledge={onExtractKnowledge}
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
      onMinimize={onMinimize ?? controller.minimize}
      visibleDiscussion={presentedDiscussion}
    />
  );
}

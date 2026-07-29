import { useCallback, useEffect } from 'react';
import { DiscussionModal } from './DiscussionModal';
import { DiscussionComposer } from './DiscussionComposer';
import { DiscussionContextBadges } from './DiscussionContextBadges';
import { DiscussionContextSelection } from './DiscussionContextSelection';
import {
  defaultDiscussionContextBadges,
  type DiscussionContextBadgeResolver,
  type DiscussionContextInspection,
} from './discussionContextModel';
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
import type { AnalyticsClient } from '../analytics';
import type { DiscussionContextSelectionController } from './useDiscussionContextSelection';

export interface DiscussionExperienceProps {
  analyticsClient?: AnalyticsClient;
  canSelectBubbleContext?: boolean;
  canSelectDocumentContext?: boolean;
  contextSelection?: DiscussionContextSelectionController;
  contextBadgeResolver?: DiscussionContextBadgeResolver;
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
  contextBadgeResolver,
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
      contextBadgeResolver={contextBadgeResolver}
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
  contextBadgeResolver,
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
    ? (contextBadgeResolver ?? defaultDiscussionContextBadges)(
        lifecycle.details,
      )
    : [];
  const discussionId = lifecycle.details?.id;
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
      isObscured={isObscured}
      contextSlot={
        discussionId && contextBadges.length > 0 ? (
          <DiscussionContextBadges
            badges={contextBadges}
            discussionId={discussionId}
            onInspect={onInspectContext}
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
      onDraftPromptChange={controller.updateDraftPrompt}
      onMinimize={onMinimize ?? controller.minimize}
      visibleDiscussion={presentedDiscussion}
    />
  );
}

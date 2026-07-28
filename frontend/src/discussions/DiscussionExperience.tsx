import { DiscussionModal } from './DiscussionModal';
import { DiscussionComposer } from './DiscussionComposer';
import { DiscussionContextBadges } from './DiscussionContextBadges';
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

export interface DiscussionExperienceProps {
  analyticsClient?: AnalyticsClient;
  contextBadgeResolver?: DiscussionContextBadgeResolver;
  controller: DiscussionVisibilityController;
  isObscured?: boolean;
  onExtractKnowledge?: (source: DiscussionKnowledgeSource) => void;
  onInspectContext?: (inspection: DiscussionContextInspection) => void;
  onDiscussionChanged?: (discussion: DiscussionDetails) => void;
  onDelete?: (discussion: DiscussionDeleteTarget) => void;
  onMinimize?: () => void;
  projectDescription: string;
  projectId: string;
  requests?: DiscussionLifecycleRequests;
}

export function DiscussionExperience({
  analyticsClient,
  contextBadgeResolver,
  controller,
  isObscured,
  onExtractKnowledge,
  onInspectContext,
  onDiscussionChanged,
  onDelete,
  onMinimize,
  projectDescription,
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
      contextBadgeResolver={contextBadgeResolver}
      isObscured={isObscured}
      onExtractKnowledge={onExtractKnowledge}
      onInspectContext={onInspectContext}
      key={identity}
      onDiscussionChanged={onDiscussionChanged}
      onDelete={onDelete}
      onMinimize={onMinimize}
      projectDescription={projectDescription}
      projectId={projectId}
      requests={requests}
      visibleDiscussion={visibleDiscussion}
    />
  );
}

function DiscussionExperienceModal({
  analyticsClient,
  contextBadgeResolver,
  controller,
  isObscured,
  onExtractKnowledge,
  onInspectContext,
  onDiscussionChanged,
  onDelete,
  onMinimize,
  projectDescription,
  projectId,
  requests,
  visibleDiscussion,
}: DiscussionExperienceProps & {
  visibleDiscussion: NonNullable<
    DiscussionVisibilityController['visibleDiscussion']
  >;
}) {
  const lifecycle = useDiscussionLifecycle({
    analyticsClient,
    onDiscussionCreated: controller.openDiscussion,
    onDiscussionChanged,
    onDraftPromptChange: controller.updateDraftPrompt,
    projectDescription,
    projectId,
    requests,
    visibleDiscussion,
  });
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
        <DiscussionComposer
          disabled={composerDisabled}
          error={lifecycle.composerError}
          isInitialPrompt={visibleDiscussion.kind === 'draft'}
          isSubmitting={lifecycle.isSubmitting}
          onChange={lifecycle.onComposerChange}
          onSubmit={lifecycle.submit}
          value={lifecycle.composerValue}
        />
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
        <DiscussionMessages
          details={lifecycle.details}
          loadError={lifecycle.loadError}
          loadStatus={lifecycle.loadStatus}
          onExtractKnowledge={onExtractKnowledge}
          onRetry={lifecycle.retryFailedTurn}
          pendingTurn={lifecycle.pendingTurn}
        />
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

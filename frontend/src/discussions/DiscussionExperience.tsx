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

export interface DiscussionExperienceProps {
  contextBadgeResolver?: DiscussionContextBadgeResolver;
  controller: DiscussionVisibilityController;
  onExtractKnowledge?: (source: DiscussionKnowledgeSource) => void;
  onInspectContext?: (inspection: DiscussionContextInspection) => void;
  onDiscussionChanged?: (discussion: DiscussionDetails) => void;
  projectDescription: string;
  projectId: string;
  requests?: DiscussionLifecycleRequests;
}

export function DiscussionExperience({
  contextBadgeResolver,
  controller,
  onExtractKnowledge,
  onInspectContext,
  onDiscussionChanged,
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
      contextBadgeResolver={contextBadgeResolver}
      onExtractKnowledge={onExtractKnowledge}
      onInspectContext={onInspectContext}
      key={identity}
      onDiscussionChanged={onDiscussionChanged}
      projectDescription={projectDescription}
      projectId={projectId}
      requests={requests}
      visibleDiscussion={visibleDiscussion}
    />
  );
}

function DiscussionExperienceModal({
  contextBadgeResolver,
  controller,
  onExtractKnowledge,
  onInspectContext,
  onDiscussionChanged,
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
      onDraftPromptChange={controller.updateDraftPrompt}
      onMinimize={controller.minimize}
      visibleDiscussion={presentedDiscussion}
    />
  );
}

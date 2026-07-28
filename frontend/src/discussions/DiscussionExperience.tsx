import { DiscussionModal } from './DiscussionModal';
import { DiscussionComposer } from './DiscussionComposer';
import { DiscussionMessages } from './DiscussionMessages';
import type { DiscussionDetails } from '../api';
import {
  useDiscussionLifecycle,
  type DiscussionLifecycleRequests,
} from './useDiscussionLifecycle';
import type { DiscussionVisibilityController } from './useDiscussionVisibility';

export interface DiscussionExperienceProps {
  controller: DiscussionVisibilityController;
  onDiscussionChanged?: (discussion: DiscussionDetails) => void;
  projectDescription: string;
  projectId: string;
  requests?: DiscussionLifecycleRequests;
}

export function DiscussionExperience({
  controller,
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
  controller,
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

  return (
    <DiscussionModal
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
      messagesSlot={
        <DiscussionMessages
          details={lifecycle.details}
          loadError={lifecycle.loadError}
          loadStatus={lifecycle.loadStatus}
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

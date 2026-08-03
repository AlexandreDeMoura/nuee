import { useCallback, useMemo, useRef, useState } from 'react';
import {
  TEMPORARY_DISCUSSION_TITLE,
  type RecoveredDiscussionTurn,
} from './discussionModel';

export interface DraftDiscussionTarget {
  key: number;
  kind: 'draft';
  prompt: string;
  title: 'New discussion';
}

export interface PersistedDiscussionTarget {
  discussionId: string;
  kind: 'persisted';
  recoveredTurn?: RecoveredDiscussionTurn;
  title: string;
}

interface OpenDiscussionTarget {
  id: string;
  recoveredTurn?: PersistedDiscussionTarget['recoveredTurn'];
  title: string;
}

export type VisibleDiscussion =
  DraftDiscussionTarget | PersistedDiscussionTarget;

interface ProjectDiscussionVisibility {
  projectId: string;
  target: VisibleDiscussion | null;
}

export interface DiscussionVisibilityController {
  minimize: () => void;
  openDiscussion: (discussion: OpenDiscussionTarget) => void;
  openDraft: () => void;
  updateDraftPrompt: (prompt: string) => void;
  visibleDiscussion: VisibleDiscussion | null;
}

/**
 * Owns presentation state only. Replacing or minimizing the visible target does
 * not mutate a persisted discussion or any project content.
 */
export function useDiscussionVisibility(
  projectId: string,
): DiscussionVisibilityController {
  const [visibility, setVisibility] = useState<ProjectDiscussionVisibility>({
    projectId,
    target: null,
  });
  const nextDraftKey = useRef(0);
  const visibleDiscussion =
    visibility.projectId === projectId ? visibility.target : null;

  if (visibility.projectId !== projectId) {
    setVisibility({ projectId, target: null });
  }

  const openDraft = useCallback(() => {
    nextDraftKey.current += 1;
    setVisibility({
      projectId,
      target: {
        key: nextDraftKey.current,
        kind: 'draft',
        prompt: '',
        title: TEMPORARY_DISCUSSION_TITLE,
      },
    });
  }, [projectId]);

  const openDiscussion = useCallback(
    ({ id, recoveredTurn, title }: OpenDiscussionTarget) => {
      setVisibility({
        projectId,
        target: {
          discussionId: id,
          kind: 'persisted',
          ...(recoveredTurn ? { recoveredTurn } : {}),
          title,
        },
      });
    },
    [projectId],
  );

  const updateDraftPrompt = useCallback(
    (prompt: string) => {
      setVisibility((current) => {
        if (
          current.projectId !== projectId ||
          current.target?.kind !== 'draft'
        ) {
          return current;
        }

        return {
          projectId,
          target: {
            ...current.target,
            prompt,
          },
        };
      });
    },
    [projectId],
  );

  const minimize = useCallback(() => {
    setVisibility((current) =>
      current.projectId === projectId ? { projectId, target: null } : current,
    );
  }, [projectId]);

  return useMemo(
    () => ({
      minimize,
      openDiscussion,
      openDraft,
      updateDraftPrompt,
      visibleDiscussion,
    }),
    [minimize, openDiscussion, openDraft, updateDraftPrompt, visibleDiscussion],
  );
}

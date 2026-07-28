import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteDiscussion as requestDiscussionDelete,
  getProjectDiscussions,
  recordDiscussionOpen,
  type DiscussionDetails,
  type DiscussionSummary,
} from '../api';
import {
  analytics,
  trackAnalytics,
  type AnalyticsClient,
} from '../analytics';
import { assertDiscussionDetails } from './discussionModel';
import {
  discussionSummaryFromDetails,
  mergeDiscussionLists,
  normalizeDiscussionList,
} from './discussionListModel';

export type DiscussionListRequest = typeof getProjectDiscussions;
export type DiscussionOpenRequest = typeof recordDiscussionOpen;
export type DiscussionDeleteRequest = typeof requestDiscussionDelete;

export interface ProjectDiscussionRequests {
  delete?: DiscussionDeleteRequest;
  list?: DiscussionListRequest;
  recordOpen?: DiscussionOpenRequest;
}

type DiscussionListStatus = 'idle' | 'loading' | 'ready' | 'error';

interface ProjectDiscussionStore {
  discussions: DiscussionSummary[];
  error: string | null;
  projectId: string;
  status: DiscussionListStatus;
}

interface DiscussionDeleteState {
  deletingDiscussionId: string | null;
  error: string | null;
  projectId: string;
}

export interface ProjectDiscussions {
  clearDeleteError: () => void;
  deleteDiscussion: (
    discussion: Pick<DiscussionSummary, 'id'>,
  ) => Promise<boolean>;
  deleteError: string | null;
  deletingDiscussionId: string | null;
  discussions: DiscussionSummary[];
  error: string | null;
  openDiscussion: (
    discussion: Pick<DiscussionSummary, 'id'>,
  ) => Promise<DiscussionDetails | null>;
  openingDiscussionId: string | null;
  openError: string | null;
  refresh: () => void;
  status: DiscussionListStatus;
  updateDiscussion: (discussion: DiscussionDetails) => void;
}

interface UseProjectDiscussionsOptions {
  analyticsClient?: AnalyticsClient;
  enabled: boolean;
  projectId: string;
  requests?: ProjectDiscussionRequests;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback;
}

export function useProjectDiscussions({
  analyticsClient = analytics,
  enabled,
  projectId,
  requests,
}: UseProjectDiscussionsOptions): ProjectDiscussions {
  const deleteRequest = requests?.delete ?? requestDiscussionDelete;
  const listRequest = requests?.list ?? getProjectDiscussions;
  const openRequest = requests?.recordOpen ?? recordDiscussionOpen;
  const [store, setStore] = useState<ProjectDiscussionStore>({
    discussions: [],
    error: null,
    projectId,
    status: 'idle',
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [openingDiscussionId, setOpeningDiscussionId] = useState<string | null>(
    null,
  );
  const [openError, setOpenError] = useState<string | null>(null);
  const [deleteState, setDeleteState] = useState<DiscussionDeleteState>({
    deletingDiscussionId: null,
    error: null,
    projectId,
  });
  const listOperationRef = useRef(0);
  const mutationRevisionRef = useRef(0);
  const openOperationRef = useRef(0);
  const openControllerRef = useRef<AbortController | null>(null);
  const deleteOperationRef = useRef(0);
  const deleteControllerRef = useRef<AbortController | null>(null);
  const deletedDiscussionIdsRef = useRef<Map<string, Set<string>>>(new Map());
  const discussionListsRef = useRef<Map<string, DiscussionSummary[]>>(new Map());
  const activeDiscussionIdsRef = useRef<Map<string, string | null>>(new Map());
  const currentStore =
    store.projectId === projectId
      ? store
      : {
          discussions: [],
          error: null,
          projectId,
          status: 'idle' as const,
        };
  const currentDeleteState =
    deleteState.projectId === projectId
      ? deleteState
      : {
          deletingDiscussionId: null,
          error: null,
          projectId,
        };

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const controller = new AbortController();
    listOperationRef.current += 1;
    const operation = listOperationRef.current;
    const mutationRevision = mutationRevisionRef.current;

    listRequest(projectId, controller.signal)
      .then((response) => {
        if (
          controller.signal.aborted ||
          operation !== listOperationRef.current
        ) {
          return;
        }

        const loaded = normalizeDiscussionList(response, projectId);
        const deletedIds = deletedDiscussionIdsRef.current.get(projectId);
        const availableLoaded = normalizeDiscussionList(
          deletedIds
            ? loaded.filter((discussion) => !deletedIds.has(discussion.id))
            : loaded,
          projectId,
        );
        const discussions =
          mutationRevision === mutationRevisionRef.current
            ? availableLoaded
            : mergeDiscussionLists(
                projectId,
                availableLoaded,
                (discussionListsRef.current.get(projectId) ?? []).filter(
                  (discussion) => !deletedIds?.has(discussion.id),
                ),
              );
        discussionListsRef.current.set(projectId, discussions);
        activeDiscussionIdsRef.current.set(
          projectId,
          discussions.find((discussion) => discussion.is_active)?.id ?? null,
        );

        setStore({
          discussions,
          error: null,
          projectId,
          status: 'ready',
        });
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          operation !== listOperationRef.current ||
          isAbort(error)
        ) {
          return;
        }

        setStore((current) => ({
          discussions:
            current.projectId === projectId ? current.discussions : [],
          error: message(error, 'The discussions could not be loaded.'),
          projectId,
          status: 'error',
        }));
      });

    return () => controller.abort();
  }, [enabled, listRequest, projectId, refreshKey]);

  useEffect(() => {
    return () => {
      listOperationRef.current += 1;
      openOperationRef.current += 1;
      openControllerRef.current?.abort();
      openControllerRef.current = null;
      deleteOperationRef.current += 1;
      deleteControllerRef.current?.abort();
      deleteControllerRef.current = null;
    };
  }, [projectId]);

  const refresh = useCallback(() => {
    setStore((current) => ({
      discussions:
        current.projectId === projectId ? current.discussions : [],
      error: null,
      projectId,
      status: 'loading',
    }));
    setRefreshKey((key) => key + 1);
  }, [projectId]);

  const updateDiscussion = useCallback(
    (discussion: DiscussionDetails) => {
      if (
        discussion.project_id !== projectId ||
        deletedDiscussionIdsRef.current
          .get(projectId)
          ?.has(discussion.id)
      ) {
        return;
      }

      const summary = discussionSummaryFromDetails(discussion);
      mutationRevisionRef.current += 1;
      const previousActiveDiscussionId =
        activeDiscussionIdsRef.current.get(projectId) ?? null;
      const discussions = mergeDiscussionLists(
        projectId,
        discussionListsRef.current.get(projectId) ?? [],
        [summary],
      );
      discussionListsRef.current.set(projectId, discussions);
      activeDiscussionIdsRef.current.set(
        projectId,
        discussions.find((candidate) => candidate.is_active)?.id ?? null,
      );
      const nextActiveDiscussionId =
        activeDiscussionIdsRef.current.get(projectId) ?? null;

      setStore((current) => ({
        discussions,
        error: current.projectId === projectId ? current.error : null,
        projectId,
        status:
          current.projectId === projectId && current.status === 'loading'
            ? 'loading'
            : 'ready',
      }));

      if (previousActiveDiscussionId !== nextActiveDiscussionId) {
        trackAnalytics(analyticsClient, 'discussion_active_changed', {
          project_id: projectId,
          previous_discussion_id: previousActiveDiscussionId,
          discussion_id: nextActiveDiscussionId,
          occurred_at: discussion.last_activity_at,
        });
      }
    },
    [analyticsClient, projectId],
  );

  const openDiscussion = useCallback(
    async (
      discussion: Pick<DiscussionSummary, 'id'>,
    ): Promise<DiscussionDetails | null> => {
      openControllerRef.current?.abort();
      const controller = new AbortController();
      openControllerRef.current = controller;
      openOperationRef.current += 1;
      const operation = openOperationRef.current;

      setOpeningDiscussionId(discussion.id);
      setOpenError(null);

      try {
        const response = await openRequest(
          projectId,
          discussion.id,
          controller.signal,
        );

        if (
          controller.signal.aborted ||
          operation !== openOperationRef.current
        ) {
          return null;
        }

        const opened = assertDiscussionDetails(
          response,
          projectId,
          discussion.id,
        );
        trackAnalytics(analyticsClient, 'discussion_opened', {
          project_id: projectId,
          discussion_id: opened.id,
          occurred_at: opened.last_activity_at,
        });
        updateDiscussion(opened);
        setOpeningDiscussionId(null);

        return opened;
      } catch (error: unknown) {
        if (
          controller.signal.aborted ||
          operation !== openOperationRef.current ||
          isAbort(error)
        ) {
          return null;
        }

        setOpeningDiscussionId(null);
        setOpenError(
          message(error, 'The discussion could not be opened. Try again.'),
        );
        return null;
      }
    },
    [analyticsClient, openRequest, projectId, updateDiscussion],
  );

  const clearDeleteError = useCallback(() => {
    setDeleteState({
      deletingDiscussionId: null,
      error: null,
      projectId,
    });
  }, [projectId]);

  const deleteDiscussion = useCallback(
    async (
      discussion: Pick<DiscussionSummary, 'id'>,
    ): Promise<boolean> => {
      if (deleteControllerRef.current) {
        return false;
      }

      const controller = new AbortController();
      deleteControllerRef.current = controller;
      deleteOperationRef.current += 1;
      const operation = deleteOperationRef.current;

      setDeleteState({
        deletingDiscussionId: discussion.id,
        error: null,
        projectId,
      });
      const previousActiveDiscussionId =
        activeDiscussionIdsRef.current.get(projectId) ?? null;

      try {
        await deleteRequest(projectId, discussion.id, controller.signal);

        if (
          controller.signal.aborted ||
          operation !== deleteOperationRef.current
        ) {
          return false;
        }

        const deletedIds =
          deletedDiscussionIdsRef.current.get(projectId) ?? new Set<string>();
        deletedIds.add(discussion.id);
        deletedDiscussionIdsRef.current.set(projectId, deletedIds);
        mutationRevisionRef.current += 1;

        const discussions = normalizeDiscussionList(
          (discussionListsRef.current.get(projectId) ?? []).filter(
            (candidate) => candidate.id !== discussion.id,
          ),
          projectId,
        );
        const nextActiveDiscussionId =
          discussions.find((candidate) => candidate.is_active)?.id ?? null;
        discussionListsRef.current.set(projectId, discussions);
        activeDiscussionIdsRef.current.set(
          projectId,
          nextActiveDiscussionId,
        );

        setStore((current) => ({
          discussions,
          error: current.projectId === projectId ? current.error : null,
          projectId,
          status: 'ready',
        }));

        const deletedAt = new Date().toISOString();
        trackAnalytics(analyticsClient, 'discussion_deleted', {
          project_id: projectId,
          discussion_id: discussion.id,
          occurred_at: deletedAt,
        });

        if (previousActiveDiscussionId === discussion.id) {
          trackAnalytics(analyticsClient, 'discussion_active_changed', {
            project_id: projectId,
            previous_discussion_id: previousActiveDiscussionId,
            discussion_id: nextActiveDiscussionId,
            occurred_at: deletedAt,
          });
        }

        return true;
      } catch (error: unknown) {
        if (
          controller.signal.aborted ||
          operation !== deleteOperationRef.current ||
          isAbort(error)
        ) {
          return false;
        }

        setDeleteState({
          deletingDiscussionId: discussion.id,
          error: message(
            error,
            'The discussion could not be deleted. Try again.',
          ),
          projectId,
        });
        return false;
      } finally {
        if (
          operation === deleteOperationRef.current &&
          deleteControllerRef.current === controller
        ) {
          deleteControllerRef.current = null;
          setDeleteState((current) =>
            current.projectId === projectId &&
            current.deletingDiscussionId === discussion.id
              ? {
                  ...current,
                  deletingDiscussionId: null,
                }
              : current,
          );
        }
      }
    },
    [analyticsClient, deleteRequest, projectId],
  );

  return useMemo(
    () => ({
      clearDeleteError,
      deleteDiscussion,
      deleteError: currentDeleteState.error,
      deletingDiscussionId: currentDeleteState.deletingDiscussionId,
      discussions: currentStore.discussions,
      error: currentStore.error,
      openDiscussion,
      openingDiscussionId,
      openError,
      refresh,
      status:
        enabled && currentStore.status === 'idle'
          ? 'loading'
          : currentStore.status,
      updateDiscussion,
    }),
    [
      clearDeleteError,
      currentStore.discussions,
      currentStore.error,
      currentStore.status,
      currentDeleteState.deletingDiscussionId,
      currentDeleteState.error,
      deleteDiscussion,
      enabled,
      openDiscussion,
      openingDiscussionId,
      openError,
      refresh,
      updateDiscussion,
    ],
  );
}

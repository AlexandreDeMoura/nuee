import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteDiscussion as requestDiscussionDelete,
  getProjectDiscussions,
  recordDiscussionOpen,
  type DiscussionDetails,
  type DiscussionSummary,
} from '../api';
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

        setStore((current) => ({
          discussions:
            mutationRevision === mutationRevisionRef.current
              ? availableLoaded
              : mergeDiscussionLists(
                  projectId,
                  availableLoaded,
                  current.projectId === projectId
                    ? current.discussions.filter(
                        (discussion) => !deletedIds?.has(discussion.id),
                      )
                    : [],
                ),
          error: null,
          projectId,
          status: 'ready',
        }));
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

      setStore((current) => ({
        discussions: mergeDiscussionLists(
          projectId,
          current.projectId === projectId ? current.discussions : [],
          [summary],
        ),
        error: current.projectId === projectId ? current.error : null,
        projectId,
        status:
          current.projectId === projectId && current.status === 'loading'
            ? 'loading'
            : 'ready',
      }));
    },
    [projectId],
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
    [openRequest, projectId, updateDiscussion],
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

        setStore((current) => ({
          discussions: normalizeDiscussionList(
            current.projectId === projectId
              ? current.discussions.filter(
                  (candidate) => candidate.id !== discussion.id,
                )
              : [],
            projectId,
          ),
          error: current.projectId === projectId ? current.error : null,
          projectId,
          status: 'ready',
        }));

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
    [deleteRequest, projectId],
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

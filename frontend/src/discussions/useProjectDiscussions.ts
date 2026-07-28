import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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

export interface ProjectDiscussionRequests {
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

export interface ProjectDiscussions {
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
  const listOperationRef = useRef(0);
  const mutationRevisionRef = useRef(0);
  const openOperationRef = useRef(0);
  const openControllerRef = useRef<AbortController | null>(null);
  const currentStore =
    store.projectId === projectId
      ? store
      : {
          discussions: [],
          error: null,
          projectId,
          status: 'idle' as const,
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

        setStore((current) => ({
          discussions:
            mutationRevision === mutationRevisionRef.current
              ? loaded
              : mergeDiscussionLists(
                  projectId,
                  loaded,
                  current.projectId === projectId
                    ? current.discussions
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

  useEffect(
    () => () => {
      listOperationRef.current += 1;
      openOperationRef.current += 1;
      openControllerRef.current?.abort();
    },
    [],
  );

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
      if (discussion.project_id !== projectId) {
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

  return useMemo(
    () => ({
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
      currentStore.discussions,
      currentStore.error,
      currentStore.status,
      enabled,
      openDiscussion,
      openingDiscussionId,
      openError,
      refresh,
      updateDiscussion,
    ],
  );
}

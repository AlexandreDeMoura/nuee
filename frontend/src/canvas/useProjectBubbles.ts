import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Bubble } from '../api';
import {
  isRenderableBubble,
  mergeBubbles,
  renderableBubbles,
  renderableTerritories,
} from './canvasModel';
import type {
  BubbleListRequest,
  CanvasLoadState,
  ProjectBubbleCollection,
  TerritoryListRequest,
} from './canvasTypes';

interface UseProjectBubblesOptions {
  enabled?: boolean;
  projectId: string;
  requestBubbles: BubbleListRequest;
  requestTerritories: TerritoryListRequest;
}

type BubbleCollectionMutation =
  | {
      bubble: Bubble;
      kind: 'add' | 'replace';
    }
  | {
      bubbleId: string;
      kind: 'remove';
    };

function replaceBubble(bubbles: Bubble[], replacement: Bubble) {
  return bubbles.map((bubble) =>
    bubble.id === replacement.id ? replacement : bubble,
  );
}

function applyMutations(
  bubbles: Bubble[],
  mutations: readonly BubbleCollectionMutation[],
) {
  return mutations.reduce((current, mutation) => {
    switch (mutation.kind) {
      case 'add':
        return mergeBubbles(current, [mutation.bubble]);
      case 'replace':
        return replaceBubble(current, mutation.bubble);
      case 'remove':
        return current.filter((bubble) => bubble.id !== mutation.bubbleId);
    }
  }, bubbles);
}

export function useProjectBubbles({
  enabled = true,
  projectId,
  requestBubbles,
  requestTerritories,
}: UseProjectBubblesOptions): ProjectBubbleCollection {
  const [loadState, setLoadState] = useState<CanvasLoadState>({
    status: 'loading',
    bubbles: [],
    territories: [],
  });
  const [requestKey, setRequestKey] = useState(0);
  const loadedProjectIdRef = useRef(projectId);
  const mutationsRef = useRef<BubbleCollectionMutation[]>([]);
  const removedBubbleIdsRef = useRef(new Set<string>());

  const recordMutation = useCallback(
    (mutation: BubbleCollectionMutation) => {
      mutationsRef.current.push(mutation);
    },
    [],
  );

  const addBubble = useCallback(
    (bubble: Bubble) => {
      if (!isRenderableBubble(bubble, projectId)) {
        return;
      }

      removedBubbleIdsRef.current.delete(bubble.id);
      recordMutation({ bubble, kind: 'add' });
      setLoadState((current) => ({
        ...current,
        status: current.status === 'partial' ? 'partial' : 'ready',
        bubbles: mergeBubbles(current.bubbles, [bubble]),
      }));
    },
    [projectId, recordMutation],
  );

  const replacePersistedBubble = useCallback(
    (bubble: Bubble) => {
      if (!isRenderableBubble(bubble, projectId)) {
        return;
      }

      recordMutation({ bubble, kind: 'replace' });
      setLoadState((current) => ({
        ...current,
        bubbles: replaceBubble(current.bubbles, bubble),
      }));
    },
    [projectId, recordMutation],
  );

  const removeBubble = useCallback(
    (bubbleId: string) => {
      removedBubbleIdsRef.current.add(bubbleId);
      recordMutation({ bubbleId, kind: 'remove' });
      setLoadState((current) => ({
        ...current,
        bubbles: current.bubbles.filter((bubble) => bubble.id !== bubbleId),
      }));
    },
    [recordMutation],
  );

  const isBubbleRemoved = useCallback(
    (bubbleId: string) => removedBubbleIdsRef.current.has(bubbleId),
    [],
  );

  const retry = useCallback(() => {
    setLoadState((current) => ({
      ...current,
      status: 'loading',
    }));
    setRequestKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const controller = new AbortController();
    const isNewProject = loadedProjectIdRef.current !== projectId;

    if (isNewProject) {
      loadedProjectIdRef.current = projectId;
      mutationsRef.current = [];
      removedBubbleIdsRef.current = new Set();
    }

    setLoadState((current) => ({
      status: 'loading',
      bubbles: isNewProject ? [] : current.bubbles,
      territories: isNewProject ? [] : current.territories,
    }));

    Promise.all([
      requestBubbles(projectId, controller.signal),
      requestTerritories(projectId, controller.signal),
    ])
      .then(([bubbleRecords, territoryRecords]) => {
        if (controller.signal.aborted) {
          return;
        }

        const bubbleResult = renderableBubbles(bubbleRecords, projectId);
        const territoryResult = renderableTerritories(
          territoryRecords,
          projectId,
        );
        const hasInvalidRecords =
          bubbleResult.invalidCount > 0 ||
          territoryResult.invalidCount > 0;

        setLoadState((current) => {
          const loadedBubbles = hasInvalidRecords
            ? mergeBubbles(current.bubbles, bubbleResult.bubbles)
            : bubbleResult.bubbles;

          return {
            status: hasInvalidRecords ? 'partial' : 'ready',
            bubbles: applyMutations(loadedBubbles, mutationsRef.current),
            territories: territoryResult.territories,
          };
        });
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return;
        }

        setLoadState((current) => ({
          ...current,
          status: 'failed',
        }));
      });

    return () => controller.abort();
  }, [
    enabled,
    projectId,
    requestBubbles,
    requestKey,
    requestTerritories,
  ]);

  return useMemo(
    () => ({
      addBubble,
      isBubbleRemoved,
      loadState,
      projectId,
      removeBubble,
      replaceBubble: replacePersistedBubble,
      retry,
    }),
    [
      addBubble,
      isBubbleRemoved,
      loadState,
      projectId,
      removeBubble,
      replacePersistedBubble,
      retry,
    ],
  );
}

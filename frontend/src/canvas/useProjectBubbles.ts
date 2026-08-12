import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Bubble, Territory } from '../api';
import {
  isRenderableBubble,
  isRenderableTerritory,
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

type TerritoryCollectionMutation =
  | {
      kind: 'add' | 'replace';
      territory: Territory;
    }
  | {
      kind: 'remove';
      territoryId: string;
    };

function mergeTerritories(current: Territory[], incoming: Territory[]) {
  const currentIds = new Set(current.map(({ id }) => id));

  return [
    ...current,
    ...incoming.filter(({ id }) => !currentIds.has(id)),
  ];
}

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

function applyTerritoryMutations(
  territories: Territory[],
  mutations: readonly TerritoryCollectionMutation[],
) {
  return mutations.reduce((current, mutation) => {
    switch (mutation.kind) {
      case 'add':
        return mergeTerritories(current, [mutation.territory]);
      case 'replace':
        return current.map((territory) =>
          territory.id === mutation.territory.id
            ? mutation.territory
            : territory,
        );
      case 'remove':
        return current.filter(
          (territory) => territory.id !== mutation.territoryId,
        );
    }
  }, territories);
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
  const territoryMutationsRef = useRef<TerritoryCollectionMutation[]>([]);
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

  const addTerritory = useCallback(
    (territory: Territory) => {
      if (!isRenderableTerritory(territory, projectId)) {
        return;
      }

      territoryMutationsRef.current.push({ kind: 'add', territory });
      setLoadState((current) => ({
        ...current,
        status: current.status === 'partial' ? 'partial' : 'ready',
        territories: mergeTerritories(current.territories, [territory]),
      }));
    },
    [projectId],
  );

  const replaceTerritory = useCallback(
    (territory: Territory) => {
      if (!isRenderableTerritory(territory, projectId)) {
        return;
      }

      territoryMutationsRef.current.push({ kind: 'replace', territory });
      setLoadState((current) => ({
        ...current,
        territories: current.territories.map((candidate) =>
          candidate.id === territory.id ? territory : candidate,
        ),
      }));
    },
    [projectId],
  );

  const removeTerritory = useCallback((territoryId: string) => {
    territoryMutationsRef.current.push({ kind: 'remove', territoryId });
    setLoadState((current) => ({
      ...current,
      territories: current.territories.filter(
        (territory) => territory.id !== territoryId,
      ),
    }));
  }, []);

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

  const replaceCollection = useCallback(
    (bubbles: Bubble[], territories: CanvasLoadState['territories']) => {
      mutationsRef.current = [];
      territoryMutationsRef.current = [];
      removedBubbleIdsRef.current = new Set();
      setLoadState({ status: 'ready', bubbles, territories });
    },
    [],
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

  const refresh = useCallback(() => {
    mutationsRef.current = [];
    territoryMutationsRef.current = [];
    removedBubbleIdsRef.current = new Set();
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
      territoryMutationsRef.current = [];
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
            territories: applyTerritoryMutations(
              territoryResult.territories,
              territoryMutationsRef.current,
            ),
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
      addTerritory,
      isBubbleRemoved,
      loadState,
      projectId,
      refresh,
      removeBubble,
      removeTerritory,
      replaceCollection,
      replaceBubble: replacePersistedBubble,
      replaceTerritory,
      retry,
    }),
    [
      addBubble,
      addTerritory,
      isBubbleRemoved,
      loadState,
      projectId,
      refresh,
      removeBubble,
      removeTerritory,
      replaceCollection,
      replacePersistedBubble,
      replaceTerritory,
      retry,
    ],
  );
}

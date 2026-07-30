import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  Bubble,
  BubblePositionUpdate,
} from '../api';
import {
  isRenderableBubble,
  mergeBubbles,
  renderableBubbles,
} from './canvasModel';
import type {
  BubbleListRequest,
  CanvasLoadState,
  ProjectBubbleCollection,
} from './canvasTypes';

interface UseProjectBubblesOptions {
  enabled?: boolean;
  projectId: string;
  requestBubbles: BubbleListRequest;
}

type BubbleCollectionMutation =
  | {
      bubble: Bubble;
      kind: 'add' | 'replace';
    }
  | {
      bubbleId: string;
      kind: 'remove';
    }
  | {
      kind: 'positions';
      positions: readonly BubblePositionUpdate[];
    };

function replaceBubblePreservingPosition(
  bubbles: Bubble[],
  replacement: Bubble,
) {
  return bubbles.map((bubble) =>
    bubble.id === replacement.id
      ? {
          ...replacement,
          position_x: bubble.position_x,
          position_y: bubble.position_y,
        }
      : bubble,
  );
}

function updateBubblePositions(
  bubbles: Bubble[],
  positions: readonly BubblePositionUpdate[],
) {
  const positionsById = new Map(
    positions.map((position) => [position.bubble_id, position]),
  );

  return bubbles.map((bubble) => {
    const position = positionsById.get(bubble.id);

    return position
      ? {
          ...bubble,
          position_x: position.position_x,
          position_y: position.position_y,
        }
      : bubble;
  });
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
        return replaceBubblePreservingPosition(current, mutation.bubble);
      case 'remove':
        return current.filter((bubble) => bubble.id !== mutation.bubbleId);
      case 'positions':
        return updateBubblePositions(current, mutation.positions);
    }
  }, bubbles);
}

export function useProjectBubbles({
  enabled = true,
  projectId,
  requestBubbles,
}: UseProjectBubblesOptions): ProjectBubbleCollection {
  const [loadState, setLoadState] = useState<CanvasLoadState>({
    status: 'loading',
    bubbles: [],
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
        status: current.status === 'partial' ? 'partial' : 'ready',
        bubbles: mergeBubbles(current.bubbles, [bubble]),
      }));
    },
    [projectId, recordMutation],
  );

  const replaceBubble = useCallback(
    (bubble: Bubble) => {
      if (!isRenderableBubble(bubble, projectId)) {
        return;
      }

      recordMutation({ bubble, kind: 'replace' });
      setLoadState((current) => ({
        ...current,
        bubbles: replaceBubblePreservingPosition(current.bubbles, bubble),
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

  const applyBubblePositions = useCallback(
    (positions: readonly BubblePositionUpdate[]) => {
      const validPositions = positions.filter(
        (position) =>
          typeof position.bubble_id === 'string' &&
          Number.isFinite(position.position_x) &&
          Number.isFinite(position.position_y),
      );

      if (validPositions.length === 0) {
        return;
      }

      recordMutation({ kind: 'positions', positions: validPositions });
      setLoadState((current) => ({
        ...current,
        bubbles: updateBubblePositions(current.bubbles, validPositions),
      }));
    },
    [recordMutation],
  );

  const retry = useCallback(() => {
    setLoadState((current) => ({
      status: 'loading',
      bubbles: current.bubbles,
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
    }));

    requestBubbles(projectId, controller.signal)
      .then((records) => {
        if (controller.signal.aborted) {
          return;
        }

        const result = renderableBubbles(records, projectId);

        setLoadState((current) => {
          const loadedBubbles =
            result.invalidCount === 0
              ? result.bubbles
              : mergeBubbles(current.bubbles, result.bubbles);

          return {
            status: result.invalidCount === 0 ? 'ready' : 'partial',
            bubbles: applyMutations(loadedBubbles, mutationsRef.current),
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
          status: 'failed',
          bubbles: current.bubbles,
        }));
      });

    return () => controller.abort();
  }, [enabled, projectId, requestBubbles, requestKey]);

  return useMemo(
    () => ({
      addBubble,
      isBubbleRemoved,
      loadState,
      projectId,
      removeBubble,
      replaceBubble,
      retry,
      updateBubblePositions: applyBubblePositions,
    }),
    [
      addBubble,
      applyBubblePositions,
      isBubbleRemoved,
      loadState,
      projectId,
      removeBubble,
      replaceBubble,
      retry,
    ],
  );
}

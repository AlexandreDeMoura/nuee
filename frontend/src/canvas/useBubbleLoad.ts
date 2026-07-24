import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
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
  ActiveBubbleDrag,
  BubbleListRequest,
  BubblePosition,
  BubblePositionSave,
  CanvasLoadState,
} from './canvasTypes';

interface UseBubbleLoadOptions {
  activeBubbleDragRef: RefObject<ActiveBubbleDrag | null>;
  deletedBubbleIds: string[];
  onBubblesChange?: (bubbles: Bubble[]) => void;
  positionSavesRef: RefObject<Record<string, BubblePositionSave>>;
  projectId: string;
  requestBubbles: BubbleListRequest;
  selectBubble: (bubble: Bubble | null) => void;
  selectedBubbleIdRef: RefObject<string | null>;
  updatedBubbles: Bubble[];
}

export function useBubbleLoad({
  activeBubbleDragRef,
  deletedBubbleIds,
  onBubblesChange,
  positionSavesRef,
  projectId,
  requestBubbles,
  selectBubble,
  selectedBubbleIdRef,
  updatedBubbles,
}: UseBubbleLoadOptions) {
  const [loadState, setLoadState] = useState<CanvasLoadState>({
    status: 'loading',
    bubbles: [],
  });
  const [requestKey, setRequestKey] = useState(0);
  const loadedProjectIdRef = useRef(projectId);

  const setLocalBubblePosition = useCallback(
    (bubbleId: string, position: BubblePosition) => {
      setLoadState((current) => ({
        ...current,
        bubbles: current.bubbles.map((bubble) =>
          bubble.id === bubbleId
            ? {
                ...bubble,
                position_x: position.x,
                position_y: position.y,
              }
            : bubble,
        ),
      }));
    },
    [],
  );

  const setLocalBubblePositions = useCallback(
    (positions: readonly BubblePositionUpdate[]) => {
      const positionsById = new Map(
        positions.map((position) => [position.bubble_id, position]),
      );

      setLoadState((current) => ({
        ...current,
        bubbles: current.bubbles.map((bubble) => {
          const position = positionsById.get(bubble.id);

          return position
            ? {
                ...bubble,
                position_x: position.position_x,
                position_y: position.position_y,
              }
            : bubble;
        }),
      }));
    },
    [],
  );

  const addBubble = useCallback((bubble: Bubble) => {
    setLoadState((current) => ({
      status: current.status === 'partial' ? 'partial' : 'ready',
      bubbles: mergeBubbles(current.bubbles, [bubble]),
    }));
  }, []);

  const retry = useCallback(() => {
    setLoadState((current) => ({
      status: 'loading',
      bubbles: current.bubbles,
    }));
    setRequestKey((key) => key + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const isNewProject = loadedProjectIdRef.current !== projectId;
    loadedProjectIdRef.current = projectId;

    setLoadState((current) => ({
      status: 'loading',
      bubbles: isNewProject ? [] : current.bubbles,
    }));

    requestBubbles(projectId, controller.signal)
      .then((records) => {
        if (!controller.signal.aborted) {
          const result = renderableBubbles(records, projectId);

          if (
            result.invalidCount === 0 &&
            selectedBubbleIdRef.current &&
            !result.bubbles.some(
              (bubble) => bubble.id === selectedBubbleIdRef.current,
            )
          ) {
            selectBubble(null);
          }

          setLoadState((current) => {
            const localBubbles = new Map(
              current.bubbles.map((bubble) => [bubble.id, bubble]),
            );
            const activeBubbleId = activeBubbleDragRef.current?.bubbleId;
            const loadedBubbles = result.bubbles.map((bubble) => {
              const hasUnsavedPosition =
                bubble.id === activeBubbleId ||
                positionSavesRef.current[bubble.id] !== undefined;
              const localBubble = localBubbles.get(bubble.id);

              return hasUnsavedPosition && localBubble
                ? {
                    ...bubble,
                    position_x: localBubble.position_x,
                    position_y: localBubble.position_y,
                  }
                : bubble;
            });

            return {
              status: result.invalidCount === 0 ? 'ready' : 'partial',
              bubbles:
                result.invalidCount === 0
                  ? loadedBubbles
                  : mergeBubbles(current.bubbles, loadedBubbles),
            };
          });
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        if (!controller.signal.aborted) {
          setLoadState((current) => ({
            status: 'failed',
            bubbles: current.bubbles,
          }));
        }
      });

    return () => controller.abort();
  }, [
    activeBubbleDragRef,
    positionSavesRef,
    projectId,
    requestBubbles,
    requestKey,
    selectBubble,
    selectedBubbleIdRef,
  ]);

  const displayedBubbles = useMemo(() => {
    const deletedBubbleIdSet = new Set(deletedBubbleIds);
    const updatedBubblesById = new Map(
      updatedBubbles
        .filter((bubble) => isRenderableBubble(bubble, projectId))
        .map((bubble) => [bubble.id, bubble]),
    );

    return loadState.bubbles.flatMap((bubble) => {
      if (deletedBubbleIdSet.has(bubble.id)) {
        return [];
      }

      const updatedBubble = updatedBubblesById.get(bubble.id);
      return [
        updatedBubble
          ? {
              ...updatedBubble,
              position_x: bubble.position_x,
              position_y: bubble.position_y,
            }
          : bubble,
      ];
    });
  }, [deletedBubbleIds, loadState.bubbles, projectId, updatedBubbles]);

  useEffect(() => {
    if (
      selectedBubbleIdRef.current &&
      deletedBubbleIds.includes(selectedBubbleIdRef.current)
    ) {
      selectBubble(null);
    }
  }, [deletedBubbleIds, selectBubble, selectedBubbleIdRef]);

  useEffect(() => {
    onBubblesChange?.(displayedBubbles);
  }, [displayedBubbles, onBubblesChange]);

  return {
    addBubble,
    displayedBubbles,
    loadState,
    retry,
    setLocalBubblePosition,
    setLocalBubblePositions,
  };
}

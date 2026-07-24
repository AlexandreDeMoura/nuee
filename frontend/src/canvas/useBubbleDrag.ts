import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Bubble } from '../api';
import {
  trackAnalytics,
  type AnalyticsClient,
} from '../analytics';
import type {
  ActiveBubbleDrag,
  BubblePosition,
  BubblePositionSave,
  BubblePositionUpdateRequest,
  CanvasViewport,
} from './canvasTypes';

interface SharedRef<T> {
  current: T;
}

interface UseBubbleDragOptions {
  activeBubbleDragRef: SharedRef<ActiveBubbleDrag | null>;
  analyticsClient: AnalyticsClient;
  displayedBubbles: Bubble[];
  isMultiSelectionActive: boolean;
  positionSavesRef: SharedRef<Record<string, BubblePositionSave>>;
  projectId: string;
  requestBubblePositionUpdate: BubblePositionUpdateRequest;
  selectBubble: (bubble: Bubble | null) => void;
  setLocalBubblePosition: (
    bubbleId: string,
    position: BubblePosition,
  ) => void;
  surfaceRef: SharedRef<HTMLElement | null>;
  toggleMultiSelectedBubble: (bubbleId: string) => void;
  viewport: CanvasViewport;
}

export function useBubbleDrag({
  activeBubbleDragRef,
  analyticsClient,
  displayedBubbles,
  isMultiSelectionActive,
  positionSavesRef,
  projectId,
  requestBubblePositionUpdate,
  selectBubble,
  setLocalBubblePosition,
  surfaceRef,
  toggleMultiSelectedBubble,
  viewport,
}: UseBubbleDragOptions) {
  const [draggingBubbleId, setDraggingBubbleId] = useState<string | null>(null);
  const [positionSaves, setPositionSaves] = useState<
    Record<string, BubblePositionSave>
  >({});
  const positionSaveAttemptRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const replacePositionSave = useCallback(
    (bubbleId: string, save: BubblePositionSave | null) => {
      const nextSaves = { ...positionSavesRef.current };

      if (save) {
        nextSaves[bubbleId] = save;
      } else {
        delete nextSaves[bubbleId];
      }

      positionSavesRef.current = nextSaves;
      setPositionSaves(nextSaves);
    },
    [positionSavesRef],
  );

  const persistBubblePosition = useCallback(
    async (
      bubbleId: string,
      requestedPosition: BubblePosition,
      persistedPosition: BubblePosition,
    ) => {
      const attempt = ++positionSaveAttemptRef.current;
      replacePositionSave(bubbleId, {
        attempt,
        persistedPosition,
        requestedPosition,
        status: 'saving',
      });

      try {
        const updatedBubble = await requestBubblePositionUpdate(
          projectId,
          bubbleId,
          {
            position_x: requestedPosition.x,
            position_y: requestedPosition.y,
          },
        );

        if (
          updatedBubble.id !== bubbleId ||
          updatedBubble.project_id !== projectId ||
          !Number.isFinite(updatedBubble.position_x) ||
          !Number.isFinite(updatedBubble.position_y)
        ) {
          throw new Error('The saved bubble position response was invalid.');
        }

        if (
          !mountedRef.current ||
          positionSavesRef.current[bubbleId]?.attempt !== attempt
        ) {
          return;
        }

        setLocalBubblePosition(bubbleId, {
          x: updatedBubble.position_x,
          y: updatedBubble.position_y,
        });
        replacePositionSave(bubbleId, null);
        trackAnalytics(analyticsClient, 'bubble_moved', {
          project_id: projectId,
          bubble_id: bubbleId,
        });
      } catch {
        if (
          mountedRef.current &&
          positionSavesRef.current[bubbleId]?.attempt === attempt
        ) {
          replacePositionSave(bubbleId, {
            attempt,
            persistedPosition,
            requestedPosition,
            status: 'error',
          });
        }
      }
    },
    [
      analyticsClient,
      positionSavesRef,
      projectId,
      replacePositionSave,
      requestBubblePositionUpdate,
      setLocalBubblePosition,
    ],
  );

  const releasePointerCapture = useCallback((pointerId: number) => {
    const surface = surfaceRef.current;

    if (
      typeof surface?.hasPointerCapture === 'function' &&
      surface.hasPointerCapture(pointerId)
    ) {
      surface.releasePointerCapture(pointerId);
    }
  }, [surfaceRef]);

  const handleBubblePointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    bubble: Bubble,
  ) => {
    if (isMultiSelectionActive) {
      if (event.button === 0) {
        event.preventDefault();
        event.stopPropagation();
        toggleMultiSelectedBubble(bubble.id);
      }
      return;
    }

    if (
      event.button !== 0 ||
      positionSavesRef.current[bubble.id]?.status === 'saving'
    ) {
      if (event.button === 0) {
        event.preventDefault();
        event.stopPropagation();
        selectBubble(bubble);
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const failedSave = positionSavesRef.current[bubble.id];
    const startPosition = {
      x: bubble.position_x,
      y: bubble.position_y,
    };

    activeBubbleDragRef.current = {
      bubbleId: bubble.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition,
      currentPosition: startPosition,
      persistedPosition: failedSave?.persistedPosition ?? startPosition,
      zoom: viewport.zoom,
    };
    setDraggingBubbleId(bubble.id);

    if (typeof surfaceRef.current?.setPointerCapture === 'function') {
      surfaceRef.current.setPointerCapture(event.pointerId);
    }
  };

  const moveActiveBubble = (event: ReactPointerEvent<HTMLElement>) => {
    const activeDrag = activeBubbleDragRef.current;

    if (activeDrag?.pointerId !== event.pointerId) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();

    const nextPosition = {
      x:
        activeDrag.startPosition.x +
        (event.clientX - activeDrag.startClientX) / activeDrag.zoom,
      y:
        activeDrag.startPosition.y +
        (event.clientY - activeDrag.startClientY) / activeDrag.zoom,
    };

    activeDrag.currentPosition = nextPosition;
    setLocalBubblePosition(activeDrag.bubbleId, nextPosition);
    return true;
  };

  const finishBubbleDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const activeDrag = activeBubbleDragRef.current;

    if (!activeDrag || activeDrag.pointerId !== event.pointerId) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    activeBubbleDragRef.current = null;
    setDraggingBubbleId(null);
    releasePointerCapture(event.pointerId);

    const didMove =
      activeDrag.currentPosition.x !== activeDrag.startPosition.x ||
      activeDrag.currentPosition.y !== activeDrag.startPosition.y;

    if (!didMove) {
      const selectedBubble = displayedBubbles.find(
        (bubble) => bubble.id === activeDrag.bubbleId,
      );

      if (selectedBubble) {
        selectBubble(selectedBubble);
      }

      return true;
    }

    const returnedToPersistedPosition =
      activeDrag.currentPosition.x === activeDrag.persistedPosition.x &&
      activeDrag.currentPosition.y === activeDrag.persistedPosition.y;

    if (returnedToPersistedPosition) {
      replacePositionSave(activeDrag.bubbleId, null);
      return true;
    }

    void persistBubblePosition(
      activeDrag.bubbleId,
      activeDrag.currentPosition,
      activeDrag.persistedPosition,
    );
    return true;
  };

  const cancelBubbleDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const activeDrag = activeBubbleDragRef.current;

    if (activeDrag?.pointerId !== event.pointerId) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    setLocalBubblePosition(activeDrag.bubbleId, activeDrag.startPosition);
    activeBubbleDragRef.current = null;
    setDraggingBubbleId(null);
    releasePointerCapture(event.pointerId);
    return true;
  };

  const cancelActiveBubbleDrag = () => {
    const activeDrag = activeBubbleDragRef.current;

    if (!activeDrag) {
      return;
    }

    setLocalBubblePosition(activeDrag.bubbleId, activeDrag.startPosition);
    activeBubbleDragRef.current = null;
    setDraggingBubbleId(null);
  };

  const retryPositionSave = (
    bubbleId: string,
    save: BubblePositionSave,
  ) => {
    void persistBubblePosition(
      bubbleId,
      save.requestedPosition,
      save.persistedPosition,
    );
  };

  const revertPositionSave = (
    bubbleId: string,
    save: BubblePositionSave,
  ) => {
    setLocalBubblePosition(bubbleId, save.persistedPosition);
    replacePositionSave(bubbleId, null);
  };

  return {
    cancelActiveBubbleDrag,
    cancelBubbleDrag,
    draggingBubbleId,
    finishBubbleDrag,
    handleBubblePointerDown,
    moveActiveBubble,
    positionSaves,
    retryPositionSave,
    revertPositionSave,
  };
}

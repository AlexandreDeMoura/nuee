import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Bubble } from '../api';
import {
  trackAnalytics,
  type AnalyticsClient,
} from '../analytics';
import type { CanvasMultiSelection } from './canvasTypes';

interface UseMultiSelectionOptions {
  analyticsClient: AnalyticsClient;
  displayedBubbles: Bubble[];
  multiSelection: CanvasMultiSelection | null;
  projectId: string;
}

function selectionLimit(
  multiSelection: CanvasMultiSelection | null,
): number | null {
  const candidate = multiSelection?.maximumSelectionCount;

  return typeof candidate === 'number' &&
    Number.isFinite(candidate) &&
    candidate >= 1
    ? Math.floor(candidate)
    : null;
}

function initialSelection(
  multiSelection: CanvasMultiSelection | null,
): string[] {
  const identifiers = [...new Set(multiSelection?.initialBubbleIds ?? [])];
  const limit = selectionLimit(multiSelection);

  return limit === null ? identifiers : identifiers.slice(0, limit);
}

export function useMultiSelection({
  analyticsClient,
  displayedBubbles,
  multiSelection,
  projectId,
}: UseMultiSelectionOptions) {
  const [selectedBubbleIds, setSelectedBubbleIds] = useState<string[]>(
    () => initialSelection(multiSelection),
  );
  const wasActiveRef = useRef(false);
  const outcomeTrackedRef = useRef(false);
  const displayedBubbleIds = useMemo(
    () => new Set(displayedBubbles.map((bubble) => bubble.id)),
    [displayedBubbles],
  );
  const activeSelectedBubbleIds = useMemo(
    () => selectedBubbleIds.filter((id) => displayedBubbleIds.has(id)),
    [displayedBubbleIds, selectedBubbleIds],
  );
  const activeSelectedBubbleIdSet = useMemo(
    () => new Set(activeSelectedBubbleIds),
    [activeSelectedBubbleIds],
  );

  const complete = useCallback(
    (
      event:
        | 'bubble_multi_selection_cancelled'
        | 'bubble_multi_selection_confirmed',
      bubbleIds: string[],
    ) => {
      if (outcomeTrackedRef.current) {
        return false;
      }

      outcomeTrackedRef.current = true;
      trackAnalytics(analyticsClient, event, {
        project_id: projectId,
        bubble_ids: bubbleIds,
      });
      return true;
    },
    [analyticsClient, projectId],
  );

  const cancel = useCallback(() => {
    if (!multiSelection) {
      return;
    }

    if (
      !complete(
        'bubble_multi_selection_cancelled',
        activeSelectedBubbleIds,
      )
    ) {
      return;
    }

    multiSelection.onCancel();
  }, [activeSelectedBubbleIds, complete, multiSelection]);

  const confirm = useCallback(() => {
    if (!multiSelection) {
      return;
    }

    const bubblesById = new Map(
      displayedBubbles.map((bubble) => [bubble.id, bubble]),
    );
    const selectedBubbles = activeSelectedBubbleIds.flatMap((id) => {
      const selectedBubble = bubblesById.get(id);
      return selectedBubble ? [selectedBubble] : [];
    });
    const bubbleIds = selectedBubbles.map((bubble) => bubble.id);

    if (!complete('bubble_multi_selection_confirmed', bubbleIds)) {
      return;
    }

    multiSelection.onConfirm({
      projectId,
      bubbleIds,
      bubbles: selectedBubbles,
    });
  }, [
    activeSelectedBubbleIds,
    complete,
    displayedBubbles,
    multiSelection,
    projectId,
  ]);

  const toggle = useCallback(
    (bubbleId: string) => {
      setSelectedBubbleIds((current) => {
        if (current.includes(bubbleId)) {
          return current.filter((id) => id !== bubbleId);
        }

        const limit = selectionLimit(multiSelection);

        if (limit === 1) {
          return [bubbleId];
        }

        return limit === null
          ? [...current, bubbleId]
          : [...current, bubbleId].slice(-limit);
      });
    },
    [multiSelection],
  );

  useEffect(() => {
    const wasActive = wasActiveRef.current;

    if (multiSelection && !wasActive) {
      setSelectedBubbleIds(initialSelection(multiSelection));
      outcomeTrackedRef.current = false;
      trackAnalytics(analyticsClient, 'bubble_multi_selection_started', {
        project_id: projectId,
      });
    } else if (!multiSelection && wasActive) {
      setSelectedBubbleIds([]);
      outcomeTrackedRef.current = false;
    }

    wasActiveRef.current = multiSelection !== null;
  }, [analyticsClient, multiSelection, projectId]);

  useEffect(() => {
    if (!multiSelection) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      cancel();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cancel, multiSelection]);

  return {
    activeSelectedBubbleIds,
    activeSelectedBubbleIdSet,
    cancel,
    confirm,
    isActive: multiSelection !== null,
    toggle,
  };
}

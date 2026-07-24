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

export function useMultiSelection({
  analyticsClient,
  displayedBubbles,
  multiSelection,
  projectId,
}: UseMultiSelectionOptions) {
  const [selectedBubbleIds, setSelectedBubbleIds] = useState<string[]>(
    () => [...new Set(multiSelection?.initialBubbleIds ?? [])],
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
        return;
      }

      outcomeTrackedRef.current = true;
      trackAnalytics(analyticsClient, event, {
        project_id: projectId,
        bubble_ids: bubbleIds,
      });
    },
    [analyticsClient, projectId],
  );

  const cancel = useCallback(() => {
    if (!multiSelection) {
      return;
    }

    complete(
      'bubble_multi_selection_cancelled',
      activeSelectedBubbleIds,
    );
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

    complete('bubble_multi_selection_confirmed', bubbleIds);
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

  const toggle = useCallback((bubbleId: string) => {
    setSelectedBubbleIds((current) =>
      current.includes(bubbleId)
        ? current.filter((id) => id !== bubbleId)
        : [...current, bubbleId],
    );
  }, []);

  useEffect(() => {
    const wasActive = wasActiveRef.current;

    if (multiSelection && !wasActive) {
      setSelectedBubbleIds([
        ...new Set(multiSelection.initialBubbleIds ?? []),
      ]);
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

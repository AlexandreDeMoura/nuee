import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  getProjectBubbles,
  updateBubblePosition,
  updateBubblePositions,
  updateProjectViewport,
  type Bubble,
  type BubblePlacementInput,
  type BubblePositionUpdate,
} from '../api';
import {
  analytics,
  trackAnalytics,
} from '../analytics';
import {
  CreateBubbleDialog,
} from '../bubbles/CreateBubbleDialog';
import { BubbleCard } from './BubbleCard';
import {
  BubblePositionSaveError,
  CanvasBubbleActions,
  CanvasBubbleLoadNotice,
  CanvasErrorState,
  CanvasLoadingState,
  CanvasMultiSelectionBar,
  CanvasViewportSaveError,
  CanvasZoomControls,
  CompactLayoutSaveError,
} from './CanvasOverlays';
import {
  DEFAULT_VIEWPORT,
  DEFAULT_VIEWPORT_SAVE_DELAY_MS,
  GRID_SIZE,
  ZOOM_STEP,
  clampZoom,
  isRenderableBubble,
  normalizeWheelDelta,
} from './canvasModel';
import type {
  ActiveBubbleDrag,
  ActivePan,
  BubblePositionSave,
  CanvasSurfaceProps,
  CompactLayoutSave,
} from './canvasTypes';
import { getCompactBubblePositions } from './compactLayout';
import { useBubbleDrag } from './useBubbleDrag';
import { useBubbleLoad } from './useBubbleLoad';
import { useMultiSelection } from './useMultiSelection';
import { useViewportPersistence } from './useViewportPersistence';

export type {
  BubbleListRequest,
  BubblePositionUpdateRequest,
  BubblePositionsUpdateRequest,
  CanvasEmptyStateActions,
  CanvasMultiSelection,
  CanvasMultiSelectionResult,
  CanvasSurfaceProps,
  CanvasViewport,
  ProjectViewportUpdateRequest,
} from './canvasTypes';

const EMPTY_DELETED_BUBBLE_IDS: string[] = [];

export function CanvasSurface({
  emptyState,
  initialViewport = DEFAULT_VIEWPORT,
  projectId,
  analyticsClient = analytics,
  requestBubbleCreate,
  requestBubbles = getProjectBubbles,
  requestBubblePlacement,
  requestBubblePositionUpdate = updateBubblePosition,
  requestBubblePositionsUpdate = updateBubblePositions,
  requestViewportUpdate = updateProjectViewport,
  onBubbleSelectionChange,
  onBubblesChange,
  bubbleLinks = [],
  multiSelection = null,
  deletedBubbleIds = EMPTY_DELETED_BUBBLE_IDS,
  updatedBubbles = [],
  viewportSaveDelayMs = DEFAULT_VIEWPORT_SAVE_DELAY_MS,
}: CanvasSurfaceProps) {
  const [selectedBubbleId, setSelectedBubbleId] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [compactLayoutSave, setCompactLayoutSave] =
    useState<CompactLayoutSave | null>(null);
  const [isCreateBubbleDialogOpen, setIsCreateBubbleDialogOpen] = useState(false);
  const [createPlacementInput, setCreatePlacementInput] =
    useState<BubblePlacementInput | null>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const activePanRef = useRef<ActivePan | null>(null);
  const activeBubbleDragRef = useRef<ActiveBubbleDrag | null>(null);
  const positionSavesRef = useRef<Record<string, BubblePositionSave>>({});
  const compactLayoutSaveAttemptRef = useRef(0);
  const compactLayoutSaveRef = useRef<CompactLayoutSave | null>(null);
  const selectedBubbleIdRef = useRef<string | null>(null);
  const onBubbleSelectionChangeRef = useRef(onBubbleSelectionChange);
  const mountedRef = useRef(true);

  useEffect(() => {
    onBubbleSelectionChangeRef.current = onBubbleSelectionChange;
  }, [onBubbleSelectionChange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const selectBubble = useCallback((bubble: Bubble | null) => {
    selectedBubbleIdRef.current = bubble?.id ?? null;
    setSelectedBubbleId(bubble?.id ?? null);
    onBubbleSelectionChangeRef.current?.(bubble);
  }, []);

  const {
    applyViewport,
    retryViewportSave,
    viewport,
    viewportSaveFailed,
  } = useViewportPersistence({
    analyticsClient,
    initialViewport,
    projectId,
    requestViewportUpdate,
    saveDelayMs: viewportSaveDelayMs,
  });

  const {
    addBubble,
    displayedBubbles,
    loadState,
    retry: retryBubbleLoad,
    setLocalBubblePosition,
    setLocalBubblePositions,
  } = useBubbleLoad({
    activeBubbleDragRef,
    deletedBubbleIds,
    onBubblesChange,
    positionSavesRef,
    projectId,
    requestBubbles,
    selectBubble,
    selectedBubbleIdRef,
    updatedBubbles,
  });

  const {
    activeSelectedBubbleIds: activeMultiSelectedBubbleIds,
    activeSelectedBubbleIdSet: activeMultiSelectedBubbleIdSet,
    cancel: cancelMultiSelection,
    confirm: confirmMultiSelection,
    isActive: isMultiSelectionActive,
    toggle: toggleMultiSelectedBubble,
  } = useMultiSelection({
    analyticsClient,
    displayedBubbles,
    multiSelection,
    projectId,
  });

  const {
    cancelActiveBubbleDrag,
    cancelBubbleDrag,
    draggingBubbleId,
    finishBubbleDrag,
    handleBubblePointerDown,
    moveActiveBubble,
    positionSaves,
    retryPositionSave,
    revertPositionSave,
  } = useBubbleDrag({
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
  });

  const replaceCompactLayoutSave = useCallback(
    (save: CompactLayoutSave | null) => {
      compactLayoutSaveRef.current = save;
      setCompactLayoutSave(save);
    },
    [],
  );

  const persistCompactLayout = useCallback(
    async (
      requestedPositions: BubblePositionUpdate[],
      persistedPositions: BubblePositionUpdate[],
    ) => {
      const attempt = ++compactLayoutSaveAttemptRef.current;
      const saving: CompactLayoutSave = {
        attempt,
        persistedPositions,
        requestedPositions,
        status: 'saving',
      };

      setLocalBubblePositions(requestedPositions);
      replaceCompactLayoutSave(saving);

      try {
        const savedBubbles = await requestBubblePositionsUpdate(projectId, {
          positions: requestedPositions,
        });
        const expectedById = new Map(
          requestedPositions.map((position) => [
            position.bubble_id,
            position,
          ]),
        );
        const seenIds = new Set<string>();

        if (
          !Array.isArray(savedBubbles) ||
          savedBubbles.length !== requestedPositions.length ||
          savedBubbles.some((bubble) => {
            const expected = expectedById.get(bubble.id);
            const isInvalid =
              !isRenderableBubble(bubble, projectId) ||
              !expected ||
              seenIds.has(bubble.id) ||
              bubble.position_x !== expected.position_x ||
              bubble.position_y !== expected.position_y;

            seenIds.add(bubble.id);
            return isInvalid;
          })
        ) {
          throw new Error('The saved compact layout response was invalid.');
        }

        if (
          !mountedRef.current ||
          compactLayoutSaveRef.current?.attempt !== attempt
        ) {
          return;
        }

        setLocalBubblePositions(
          savedBubbles.map((bubble) => ({
            bubble_id: bubble.id,
            position_x: bubble.position_x,
            position_y: bubble.position_y,
          })),
        );
        replaceCompactLayoutSave(null);
        trackAnalytics(analyticsClient, 'bubble_compact_layout_applied', {
          project_id: projectId,
          bubble_ids: requestedPositions.map((position) => position.bubble_id),
        });
      } catch {
        if (
          mountedRef.current &&
          compactLayoutSaveRef.current?.attempt === attempt
        ) {
          setLocalBubblePositions(persistedPositions);
          replaceCompactLayoutSave({
            ...saving,
            status: 'error',
          });
        }
      }
    },
    [
      analyticsClient,
      projectId,
      replaceCompactLayoutSave,
      requestBubblePositionsUpdate,
      setLocalBubblePositions,
    ],
  );

  const linkedBubbleIds = new Set<string>();

  if (selectedBubbleId && !isMultiSelectionActive) {
    for (const link of bubbleLinks) {
      if (link.project_id !== projectId) {
        continue;
      }

      if (link.bubble_a_id === selectedBubbleId) {
        linkedBubbleIds.add(link.bubble_b_id);
      } else if (link.bubble_b_id === selectedBubbleId) {
        linkedBubbleIds.add(link.bubble_a_id);
      }
    }
  }

  function isInteractiveTarget(target: EventTarget | null) {
    return (
      target instanceof Element &&
      target.closest('[data-canvas-overlay], [data-canvas-interactive]') !== null
    );
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (
      (event.button !== 0 && event.button !== 1) ||
      isInteractiveTarget(event.target)
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.button === 0 && !isMultiSelectionActive) {
      selectBubble(null);
    }

    activePanRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startViewportX: viewport.x,
      startViewportY: viewport.y,
    };
    setIsPanning(true);

    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (moveActiveBubble(event)) {
      return;
    }

    const activePan = activePanRef.current;

    if (!activePan || activePan.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    applyViewport((current) => ({
      ...current,
      x: activePan.startViewportX + event.clientX - activePan.startClientX,
      y: activePan.startViewportY + event.clientY - activePan.startClientY,
    }));
  }

  function finishPointerPan(event: ReactPointerEvent<HTMLElement>) {
    if (finishBubbleDrag(event)) {
      return;
    }

    if (activePanRef.current?.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    activePanRef.current = null;
    setIsPanning(false);

    if (
      typeof event.currentTarget.hasPointerCapture === 'function' &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function cancelPointerInteraction(event: ReactPointerEvent<HTMLElement>) {
    if (cancelBubbleDrag(event)) {
      return;
    }

    finishPointerPan(event);
  }

  const zoomAt = useCallback(
    (
      nextZoomValue: number | ((currentZoom: number) => number),
      clientX?: number,
      clientY?: number,
    ) => {
      applyViewport((current) => {
        const resolvedZoom =
          typeof nextZoomValue === 'function'
            ? nextZoomValue(current.zoom)
            : nextZoomValue;
        const nextZoom = clampZoom(resolvedZoom);

        if (nextZoom === current.zoom) {
          return current;
        }

        const bounds = surfaceRef.current?.getBoundingClientRect();
        const anchorX =
          clientX === undefined
            ? (bounds?.width ?? 0) / 2
            : clientX - (bounds?.left ?? 0);
        const anchorY =
          clientY === undefined
            ? (bounds?.height ?? 0) / 2
            : clientY - (bounds?.top ?? 0);
        const worldX = (anchorX - current.x) / current.zoom;
        const worldY = (anchorY - current.y) / current.zoom;

        return {
          x: anchorX - worldX * nextZoom,
          y: anchorY - worldY * nextZoom,
          zoom: nextZoom,
        };
      });
    },
    [applyViewport],
  );

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const bounds = surfaceRef.current?.getBoundingClientRect();
      const width = bounds?.width ?? 0;
      const height = bounds?.height ?? 0;
      const deltaX = normalizeWheelDelta(event.deltaX, event.deltaMode, width);
      const deltaY = normalizeWheelDelta(event.deltaY, event.deltaMode, height);

      if (event.ctrlKey || event.metaKey) {
        const zoomFactor = Math.exp(-deltaY * 0.002);
        zoomAt(
          (currentZoom) => currentZoom * zoomFactor,
          event.clientX,
          event.clientY,
        );
        return;
      }

      applyViewport((current) => ({
        ...current,
        x: current.x - deltaX,
        y: current.y - deltaY,
      }));
    },
    [applyViewport, zoomAt],
  );

  useEffect(() => {
    const surface = surfaceRef.current;

    if (!surface) {
      return;
    }

    surface.addEventListener('wheel', handleWheel, { passive: false });
    return () => surface.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const scaledGridSize = GRID_SIZE * viewport.zoom;
  const backgroundPositionX = viewport.x % scaledGridSize;
  const backgroundPositionY = viewport.y % scaledGridSize;

  function openCreateBubbleDialog() {
    setIsCreateBubbleDialogOpen(true);
  }

  function handleBubbleCreated(bubble: Bubble) {
    addBubble(bubble);
    trackAnalytics(analyticsClient, 'bubble_created', {
      project_id: projectId,
      bubble_id: bubble.id,
      source_kind: 'manual',
    });
    setIsCreateBubbleDialogOpen(false);
    setCreatePlacementInput(null);
  }

  useEffect(() => {
    if (!isCreateBubbleDialogOpen) {
      return;
    }

    const bounds = surfaceRef.current?.getBoundingClientRect();
    const width = bounds?.width || surfaceRef.current?.clientWidth || 1024;
    const height = bounds?.height || surfaceRef.current?.clientHeight || 768;

    setCreatePlacementInput({
      strategy: 'viewport',
      viewport_x: -viewport.x / viewport.zoom,
      viewport_y: -viewport.y / viewport.zoom,
      viewport_width: width / viewport.zoom,
      viewport_height: height / viewport.zoom,
    });
  }, [isCreateBubbleDialogOpen, viewport]);

  const renderedEmptyState =
    typeof emptyState === 'function'
      ? emptyState({ onCreateBubble: openCreateBubbleDialog })
      : emptyState;
  const failedPositionSaveEntry = Object.entries(positionSaves).find(
    ([, save]) => save.status === 'error',
  );
  const failedPositionBubble = failedPositionSaveEntry
    ? displayedBubbles.find(
        (bubble) => bubble.id === failedPositionSaveEntry[0],
      )
    : undefined;

  function compactLayout() {
    if (
      displayedBubbles.length < 2 ||
      draggingBubbleId !== null ||
      Object.keys(positionSavesRef.current).length > 0 ||
      compactLayoutSaveRef.current?.status === 'saving'
    ) {
      return;
    }

    const requestedPositions = getCompactBubblePositions(displayedBubbles);
    const bubblesById = new Map(
      displayedBubbles.map((bubble) => [bubble.id, bubble]),
    );
    const changedPositions = requestedPositions.filter((position) => {
      const bubble = bubblesById.get(position.bubble_id);

      return (
        bubble &&
        (bubble.position_x !== position.position_x ||
          bubble.position_y !== position.position_y)
      );
    });

    if (changedPositions.length === 0) {
      replaceCompactLayoutSave(null);
      trackAnalytics(analyticsClient, 'bubble_compact_layout_applied', {
        project_id: projectId,
        bubble_ids: requestedPositions.map((position) => position.bubble_id),
      });
      return;
    }

    const persistedPositions = changedPositions.map((position) => {
      const bubble = bubblesById.get(position.bubble_id)!;

      return {
        bubble_id: bubble.id,
        position_x: bubble.position_x,
        position_y: bubble.position_y,
      };
    });

    void persistCompactLayout(changedPositions, persistedPositions);
  }

  const isCompactLayoutSaving = compactLayoutSave?.status === 'saving';
  const canCompactLayout =
    displayedBubbles.length >= 2 &&
    draggingBubbleId === null &&
    Object.keys(positionSaves).length === 0 &&
    !isCompactLayoutSaving;

  return (
    <section
      className={`relative min-w-0 flex-1 select-none overflow-hidden bg-[#eef1f5] ${
        isPanning ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      aria-label="Project canvas"
      data-canvas-x={viewport.x}
      data-canvas-y={viewport.y}
      data-canvas-zoom={viewport.zoom}
      data-selection-mode={isMultiSelectionActive ? 'multiple' : 'single'}
      onLostPointerCapture={() => {
        cancelActiveBubbleDrag();
        activePanRef.current = null;
        setIsPanning(false);
      }}
      onPointerCancel={cancelPointerInteraction}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerPan}
      ref={surfaceRef}
      style={{
        backgroundImage: 'radial-gradient(#cdd6e0 1.1px, transparent 1.1px)',
        backgroundPosition: `${backgroundPositionX - 1}px ${backgroundPositionY - 1}px`,
        backgroundSize: `${scaledGridSize}px ${scaledGridSize}px`,
        overscrollBehavior: 'contain',
        touchAction: 'none',
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        data-canvas-content
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {displayedBubbles.map((bubble) => {
          const positionSave = positionSaves[bubble.id];
          const status =
            draggingBubbleId === bubble.id
              ? 'dragging'
              : isCompactLayoutSaving
                ? 'saving'
                : (positionSave?.status ?? 'default');

          return (
            <BubbleCard
              bubble={bubble}
              isLinked={
                !isMultiSelectionActive &&
                selectedBubbleId !== bubble.id &&
                linkedBubbleIds.has(bubble.id)
              }
              isMultiSelecting={isMultiSelectionActive}
              isSelected={
                isMultiSelectionActive
                  ? activeMultiSelectedBubbleIdSet.has(bubble.id)
                  : selectedBubbleId === bubble.id
              }
              key={bubble.id}
              onActivate={() =>
                isMultiSelectionActive
                  ? toggleMultiSelectedBubble(bubble.id)
                  : selectBubble(bubble)
              }
              onPointerDown={(event) =>
                handleBubblePointerDown(event, bubble)
              }
              status={status}
            />
          );
        })}
      </div>

      {multiSelection && (
        <CanvasMultiSelectionBar
          confirmLabel={multiSelection.confirmLabel ?? 'Confirm selection'}
          instruction={multiSelection.instruction ?? 'Select bubbles'}
          selectedCount={activeMultiSelectedBubbleIds.length}
          onCancel={cancelMultiSelection}
          onConfirm={confirmMultiSelection}
        />
      )}

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 py-10 lg:px-10">
        {loadState.status === 'loading' && displayedBubbles.length === 0 && (
          <CanvasLoadingState />
        )}
        {loadState.status === 'failed' && displayedBubbles.length === 0 && (
          <CanvasErrorState onRetry={retryBubbleLoad} />
        )}
        {loadState.status === 'partial' && displayedBubbles.length === 0 && (
          <CanvasBubbleLoadNotice
            hasBubbles={false}
            isPartial
            onRetry={retryBubbleLoad}
          />
        )}
        {loadState.status === 'ready' &&
          displayedBubbles.length === 0 &&
          renderedEmptyState}
      </div>

      {(loadState.status === 'partial' || loadState.status === 'failed') &&
        displayedBubbles.length > 0 && (
          <CanvasBubbleLoadNotice
            hasBubbles
            isPartial={loadState.status === 'partial'}
            onRetry={retryBubbleLoad}
          />
        )}

      <CanvasZoomControls
        zoom={viewport.zoom}
        onReset={() => zoomAt(1)}
        onZoomIn={() => zoomAt((currentZoom) => currentZoom * ZOOM_STEP)}
        onZoomOut={() => zoomAt((currentZoom) => currentZoom / ZOOM_STEP)}
      />

      {displayedBubbles.length > 0 && !isMultiSelectionActive && (
        <CanvasBubbleActions
          canCompact={canCompactLayout}
          isCompacting={isCompactLayoutSaving}
          onCompact={compactLayout}
          onCreate={openCreateBubbleDialog}
        />
      )}

      {viewportSaveFailed && (
        <CanvasViewportSaveError
          onRetry={retryViewportSave}
        />
      )}

      {failedPositionSaveEntry && failedPositionBubble && (
        <BubblePositionSaveError
          bubbleTitle={failedPositionBubble.title}
          onRetry={() => {
            const [bubbleId, save] = failedPositionSaveEntry;
            retryPositionSave(bubbleId, save);
          }}
          onRevert={() => {
            const [bubbleId, save] = failedPositionSaveEntry;
            revertPositionSave(bubbleId, save);
          }}
        />
      )}

      {compactLayoutSave?.status === 'error' && (
        <CompactLayoutSaveError
          onRetry={() => {
            void persistCompactLayout(
              compactLayoutSave.requestedPositions,
              compactLayoutSave.persistedPositions,
            );
          }}
        />
      )}

      {createPlacementInput && (
        <CreateBubbleDialog
          onCancel={() => {
            setIsCreateBubbleDialogOpen(false);
            setCreatePlacementInput(null);
          }}
          onCreated={handleBubbleCreated}
          placementInput={createPlacementInput}
          projectId={projectId}
          requestCreate={requestBubbleCreate}
          requestPlacement={requestBubblePlacement}
        />
      )}
    </section>
  );
}

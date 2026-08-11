import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  getProjectBubbles,
  getProjectTerritories,
  updateProjectViewport,
  type Bubble,
  type BubblePlacementInput,
} from '../api';
import { analytics, trackAnalytics } from '../analytics';
import { CreateBubbleDialog } from '../bubbles/CreateBubbleDialog';
import {
  CanvasBubbleActions,
  CanvasBubbleLoadNotice,
  CanvasErrorState,
  CanvasLoadingState,
  CanvasMultiSelectionBar,
  CanvasViewportSaveError,
  CanvasZoomControls,
} from './CanvasOverlays';
import { TerritoryCard } from './TerritoryCard';
import {
  DEFAULT_VIEWPORT,
  DEFAULT_VIEWPORT_SAVE_DELAY_MS,
  GRID_SIZE,
  ZOOM_STEP,
  clampZoom,
  normalizeWheelDelta,
} from './canvasModel';
import type {
  ActivePan,
  CanvasSurfaceProps,
} from './canvasTypes';
import { groupBubblesByTerritory } from './territoryModel';
import { useMultiSelection } from './useMultiSelection';
import { useProjectBubbles } from './useProjectBubbles';
import { useViewportPersistence } from './useViewportPersistence';

export type {
  BubbleListRequest,
  CanvasEmptyStateActions,
  CanvasMultiSelection,
  CanvasMultiSelectionResult,
  CanvasSurfaceProps,
  CanvasViewport,
  ProjectBubbleCollection,
  ProjectViewportUpdateRequest,
  TerritoryListRequest,
} from './canvasTypes';

export function CanvasSurface({
  bubbleCollection,
  createBubbleDialogOpen,
  emptyState,
  initialViewport = DEFAULT_VIEWPORT,
  projectId,
  analyticsClient = analytics,
  requestBubbleCreate,
  requestBubbles = getProjectBubbles,
  requestBubblePlacement,
  requestTerritories = getProjectTerritories,
  requestViewportUpdate = updateProjectViewport,
  onBubbleSelectionChange,
  onCreateBubbleDialogOpenChange,
  onStartDiscussion,
  bubbleLinks = [],
  multiSelection = null,
  viewportSaveDelayMs = DEFAULT_VIEWPORT_SAVE_DELAY_MS,
}: CanvasSurfaceProps) {
  const [selectedBubbleId, setSelectedBubbleId] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [
    isUncontrolledCreateBubbleDialogOpen,
    setIsUncontrolledCreateBubbleDialogOpen,
  ] = useState(false);
  const [createPlacementInput, setCreatePlacementInput] =
    useState<BubblePlacementInput | null>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const activePanRef = useRef<ActivePan | null>(null);
  const onBubbleSelectionChangeRef = useRef(onBubbleSelectionChange);

  useEffect(() => {
    onBubbleSelectionChangeRef.current = onBubbleSelectionChange;
  }, [onBubbleSelectionChange]);

  const selectBubble = useCallback((bubble: Bubble | null) => {
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

  const internalBubbleCollection = useProjectBubbles({
    enabled: bubbleCollection === undefined,
    projectId,
    requestBubbles,
    requestTerritories,
  });
  const activeBubbleCollection =
    bubbleCollection ?? internalBubbleCollection;
  const { loadState } = activeBubbleCollection;
  const displayedBubbles = loadState.bubbles;
  const displayedTerritories = useMemo(
    () =>
      groupBubblesByTerritory(loadState.territories, displayedBubbles),
    [displayedBubbles, loadState.territories],
  );

  const {
    activeSelectedBubbleIds,
    activeSelectedBubbleIdSet,
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

  const effectiveSelectedBubbleId = displayedBubbles.some(
    (bubble) => bubble.id === selectedBubbleId,
  )
    ? selectedBubbleId
    : null;

  const linkedBubbleIds = useMemo(() => {
    const linkedIds = new Set<string>();

    if (!effectiveSelectedBubbleId || isMultiSelectionActive) {
      return linkedIds;
    }

    for (const link of bubbleLinks) {
      if (link.project_id !== projectId) {
        continue;
      }

      if (link.bubble_a_id === effectiveSelectedBubbleId) {
        linkedIds.add(link.bubble_b_id);
      } else if (link.bubble_b_id === effectiveSelectedBubbleId) {
        linkedIds.add(link.bubble_a_id);
      }
    }

    return linkedIds;
  }, [
    bubbleLinks,
    effectiveSelectedBubbleId,
    isMultiSelectionActive,
    projectId,
  ]);

  const selectedBubbleIds = useMemo(
    () =>
      isMultiSelectionActive
        ? activeSelectedBubbleIdSet
        : new Set(
            effectiveSelectedBubbleId ? [effectiveSelectedBubbleId] : [],
          ),
    [
      activeSelectedBubbleIdSet,
      isMultiSelectionActive,
      effectiveSelectedBubbleId,
    ],
  );

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
    if (!isMultiSelectionActive) {
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

  const isCreateBubbleDialogOpen =
    createBubbleDialogOpen ?? isUncontrolledCreateBubbleDialogOpen;

  function setCreateBubbleDialogOpen(open: boolean) {
    if (createBubbleDialogOpen === undefined) {
      setIsUncontrolledCreateBubbleDialogOpen(open);
    }
    onCreateBubbleDialogOpenChange?.(open);
  }

  function openCreateBubbleDialog() {
    setCreateBubbleDialogOpen(true);
  }

  function handleBubbleCreated(bubble: Bubble) {
    activeBubbleCollection.addBubble(bubble);
    trackAnalytics(analyticsClient, 'bubble_created', {
      project_id: projectId,
      bubble_id: bubble.id,
      source_kind: 'manual',
    });
    setCreateBubbleDialogOpen(false);
    setCreatePlacementInput(null);

    if (
      !loadState.territories.some(
        (territory) => territory.id === bubble.territory_id,
      )
    ) {
      activeBubbleCollection.retry();
    }
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
  const hasDisplayedBubbles = displayedTerritories.length > 0;

  return (
    <section
      className={`relative min-w-0 flex-1 select-none overflow-hidden bg-[#eef1f5] ${
        isPanning ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      aria-label="Project canvas"
      data-canvas-x={viewport.x}
      data-canvas-y={viewport.y}
      data-canvas-zoom={viewport.zoom}
      data-selection-mode={
        isMultiSelectionActive && multiSelection?.maximumSelectionCount !== 1
          ? 'multiple'
          : 'single'
      }
      onLostPointerCapture={() => {
        activePanRef.current = null;
        setIsPanning(false);
      }}
      onPointerCancel={finishPointerPan}
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
        {displayedTerritories.map(({ bubbles, territory }) => (
          <TerritoryCard
            bubbles={bubbles}
            isMultiSelecting={isMultiSelectionActive}
            key={territory.id}
            linkedBubbleIds={linkedBubbleIds}
            onBubbleActivate={(bubble) =>
              isMultiSelectionActive
                ? toggleMultiSelectedBubble(bubble.id)
                : selectBubble(bubble)
            }
            selectedBubbleIds={selectedBubbleIds}
            territory={territory}
          />
        ))}
      </div>

      {multiSelection && (
        <CanvasMultiSelectionBar
          allowEmptySelection={multiSelection.allowEmptySelection ?? false}
          confirmLabel={multiSelection.confirmLabel ?? 'Confirm selection'}
          instruction={multiSelection.instruction ?? 'Select bubbles'}
          selectedCount={activeSelectedBubbleIds.length}
          onCancel={cancelMultiSelection}
          onConfirm={confirmMultiSelection}
        />
      )}

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 py-10 lg:px-10">
        {loadState.status === 'loading' && !hasDisplayedBubbles && (
          <CanvasLoadingState />
        )}
        {loadState.status === 'failed' && !hasDisplayedBubbles && (
          <CanvasErrorState onRetry={activeBubbleCollection.retry} />
        )}
        {loadState.status === 'partial' && !hasDisplayedBubbles && (
          <CanvasBubbleLoadNotice
            hasBubbles={false}
            isPartial
            onRetry={activeBubbleCollection.retry}
          />
        )}
        {loadState.status === 'ready' &&
          displayedBubbles.length === 0 &&
          renderedEmptyState}
      </div>

      {(loadState.status === 'partial' || loadState.status === 'failed') &&
        hasDisplayedBubbles && (
          <CanvasBubbleLoadNotice
            hasBubbles
            isPartial={loadState.status === 'partial'}
            onRetry={activeBubbleCollection.retry}
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
          canCompact={false}
          isCompacting={false}
          onCompact={() => undefined}
          onCreate={openCreateBubbleDialog}
          onStartDiscussion={onStartDiscussion}
        />
      )}

      {viewportSaveFailed && (
        <CanvasViewportSaveError onRetry={retryViewportSave} />
      )}

      {isCreateBubbleDialogOpen && createPlacementInput && (
        <CreateBubbleDialog
          onCancel={() => {
            setCreateBubbleDialogOpen(false);
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

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
  deleteTerritory,
  renameTerritory,
  repositionTerritories,
  repositionTerritory,
  updateTerritoryVisibleCount,
  updateProjectViewport,
  type Bubble,
  type Territory,
} from '../api';
import { analytics, trackAnalytics } from '../analytics';
import { CreateBubbleDialog } from '../bubbles/CreateBubbleDialog';
import { CreateTerritoryDialog } from './CreateTerritoryDialog';
import { DeleteTerritoryDialog } from './DeleteTerritoryDialog';
import {
  CanvasBubbleActions,
  CanvasBubbleLoadNotice,
  CompactTerritoryLayoutSaveError,
  CanvasErrorState,
  CanvasLoadingState,
  CanvasMultiSelectionBar,
  CanvasViewportSaveError,
  CanvasZoomControls,
  TerritoryPositionSaveError,
  TerritoryVisibleCountSaveError,
} from './CanvasOverlays';
import { TerritoryCard } from './TerritoryCard';
import { getCompactTerritoryPositions } from './compactTerritoryLayout';
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
  CanvasSaveStatus,
  CanvasSurfaceProps,
} from './canvasTypes';
import { groupBubblesByTerritory } from './territoryModel';
import { getTerritoryCreationPlacement } from './territoryPlacement';
import { trackTerritoryAnalytics } from './territoryAnalytics';
import { useMultiSelection } from './useMultiSelection';
import { useProjectBubbles } from './useProjectBubbles';
import {
  useTerritoryLayoutPersistence,
  type TerritoryPosition,
} from './useTerritoryLayoutPersistence';
import { useTerritoryVisibleCountPersistence } from './useTerritoryVisibleCountPersistence';
import { useViewportPersistence } from './useViewportPersistence';

export type {
  BubbleListRequest,
  CanvasEmptyStateActions,
  CanvasMultiSelection,
  CanvasMultiSelectionResult,
  CanvasSaveStatus,
  CanvasSurfaceProps,
  CanvasViewport,
  ProjectBubbleCollection,
  ProjectViewportUpdateRequest,
  TerritoryListRequest,
  TerritoryPositionsUpdateRequest,
  TerritoryPositionUpdateRequest,
  TerritoryVisibleCountUpdateRequest,
} from './canvasTypes';
export type {
  TerritoryDeleteRequest,
  TerritoryRenameRequest,
} from '../api';

export function CanvasSurface({
  bubbleCollection,
  createBubbleDialogOpen,
  emptyState,
  initialViewport = DEFAULT_VIEWPORT,
  projectId,
  analyticsClient = analytics,
  requestBubbleCreate,
  requestBubbles = getProjectBubbles,
  requestTerritories = getProjectTerritories,
  requestTerritoryCreate,
  requestTerritoryDelete = deleteTerritory,
  requestTerritoryRename = renameTerritory,
  requestTerritoryPositionUpdate = repositionTerritory,
  requestTerritoryPositionsUpdate = repositionTerritories,
  requestTerritoryVisibleCountUpdate = updateTerritoryVisibleCount,
  requestViewportUpdate = updateProjectViewport,
  onBubbleReaderOpen,
  onBubbleSelectionChange,
  onCreateBubbleDialogOpenChange,
  onSaveStatusChange,
  onStartDiscussion,
  onTerritoryCreationPlacementRequestChange,
  bubbleLinks = [],
  multiSelection = null,
  viewportSaveDelayMs = DEFAULT_VIEWPORT_SAVE_DELAY_MS,
  visibleCountSaveDelayMs,
}: CanvasSurfaceProps) {
  const [selectedBubbleId, setSelectedBubbleId] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [draggingTerritoryId, setDraggingTerritoryId] = useState<string | null>(
    null,
  );
  const [territoryCreationPlacement, setTerritoryCreationPlacement] =
    useState<{ position_x: number; position_y: number } | null>(null);
  const [territoryDeleteTarget, setTerritoryDeleteTarget] = useState<{
    bubbleCount: number;
    territory: Territory;
  } | null>(null);
  const [visibleCountSaveStatus, setVisibleCountSaveStatus] =
    useState<CanvasSaveStatus>('saved');
  const [territoryRenameSaveStatuses, setTerritoryRenameSaveStatuses] =
    useState<Record<string, CanvasSaveStatus>>({});
  const [
    isUncontrolledCreateBubbleDialogOpen,
    setIsUncontrolledCreateBubbleDialogOpen,
  ] = useState(false);
  const surfaceRef = useRef<HTMLElement>(null);
  const activePanRef = useRef<ActivePan | null>(null);
  const activeTerritoryDragRef = useRef<{
    territoryId: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPosition: TerritoryPosition;
    currentPosition: TerritoryPosition;
    persistedPosition: TerritoryPosition;
    zoom: number;
  } | null>(null);
  const territoryElementsRef = useRef(new Map<string, HTMLElement>());
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
  const visibleCountTargets = useMemo(
    () =>
      displayedTerritories.flatMap(({ bubbles, territory }) =>
        bubbles.length > 0
          ? [{ territory, total: bubbles.length }]
          : [],
      ),
    [displayedTerritories],
  );
  const {
    changeVisibleCount,
    localCounts,
    retrySave: retryVisibleCountSave,
    revertSave: revertVisibleCountSave,
    saves: visibleCountSaves,
  } = useTerritoryVisibleCountPersistence({
    onSaveStatusChange: setVisibleCountSaveStatus,
    projectId,
    requestUpdate: requestTerritoryVisibleCountUpdate,
    saveDelayMs: visibleCountSaveDelayMs,
    targets: visibleCountTargets,
  });

  useEffect(() => {
    const statuses = [
      visibleCountSaveStatus,
      ...Object.values(territoryRenameSaveStatuses),
    ];
    const status: CanvasSaveStatus = statuses.includes('error')
      ? 'error'
      : statuses.includes('saving')
        ? 'saving'
        : statuses.includes('dirty')
          ? 'dirty'
          : 'saved';

    onSaveStatusChange?.(status);
  }, [
    onSaveStatusChange,
    territoryRenameSaveStatuses,
    visibleCountSaveStatus,
  ]);

  const {
    compactLayoutSave,
    localPositions,
    persistCompactLayout,
    persistPosition,
    positionSaves,
    positionSavesRef,
    replaceCompactLayoutSave,
    replacePositionSave,
    setLocalPosition,
  } = useTerritoryLayoutPersistence({
    onCompactLayoutPersisted: (movedTerritoryCount) => {
      trackTerritoryAnalytics(
        analyticsClient,
        'territory_compact_layout_applied',
        {
          project_id: projectId,
          moved_territory_count: movedTerritoryCount,
        },
      );
    },
    onPositionPersisted: (territoryId) => {
      trackTerritoryAnalytics(analyticsClient, 'territory_moved', {
        project_id: projectId,
        territory_id: territoryId,
      });
    },
    projectId,
    requestPositionUpdate: requestTerritoryPositionUpdate,
    requestPositionsUpdate: requestTerritoryPositionsUpdate,
  });

  const positionedTerritories = useMemo(
    () =>
      displayedTerritories.map(({ bubbles, territory }) => {
        const localPosition = localPositions[territory.id];
        const localVisibleCount = localCounts[territory.id];

        return {
          bubbles,
          territory:
            localPosition || localVisibleCount !== undefined
              ? {
                  ...territory,
                  visible_count:
                    localVisibleCount ?? territory.visible_count,
                  position_x: localPosition?.x ?? territory.position_x,
                  position_y: localPosition?.y ?? territory.position_y,
                }
              : territory,
        };
      }),
    [displayedTerritories, localCounts, localPositions],
  );
  const positionedTerritoryIds = useMemo(
    () => new Set(positionedTerritories.map(({ territory }) => territory.id)),
    [positionedTerritories],
  );
  const activePositionSaves = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(positionSaves).filter(([territoryId]) =>
          positionedTerritoryIds.has(territoryId),
        ),
      ),
    [positionSaves, positionedTerritoryIds],
  );
  const activeCompactLayoutSave =
    compactLayoutSave &&
    compactLayoutSave.requestedPositions.some(({ territory_id }) =>
      positionedTerritoryIds.has(territory_id),
    )
      ? compactLayoutSave
      : null;

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

  function handleTerritoryPointerDown(
    event: ReactPointerEvent<HTMLElement>,
    territory: (typeof positionedTerritories)[number]['territory'],
  ) {
    if (
      event.button !== 0 ||
      isMultiSelectionActive ||
      (event.target instanceof Element && event.target.closest('button')) ||
      positionSavesRef.current[territory.id]?.status === 'saving' ||
      activeCompactLayoutSave?.status === 'saving'
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (activeCompactLayoutSave?.status === 'error') {
      replaceCompactLayoutSave(null);
    }

    const failedSave = positionSavesRef.current[territory.id];
    const startPosition = {
      x: territory.position_x,
      y: territory.position_y,
    };

    activeTerritoryDragRef.current = {
      territoryId: territory.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition,
      currentPosition: startPosition,
      persistedPosition: failedSave?.persistedPosition ?? startPosition,
      zoom: viewport.zoom,
    };
    setDraggingTerritoryId(territory.id);

    if (typeof surfaceRef.current?.setPointerCapture === 'function') {
      surfaceRef.current.setPointerCapture(event.pointerId);
    }
  }

  function moveTerritoryWithKeyboard(
    territory: (typeof positionedTerritories)[number]['territory'],
    unitDelta: TerritoryPosition,
  ) {
    if (
      isMultiSelectionActive ||
      positionSavesRef.current[territory.id]?.status === 'saving' ||
      activeCompactLayoutSave?.status === 'saving'
    ) {
      return false;
    }

    if (activeCompactLayoutSave?.status === 'error') {
      replaceCompactLayoutSave(null);
    }

    const failedSave = positionSavesRef.current[territory.id];
    const persistedPosition = failedSave?.persistedPosition ?? {
      x: territory.position_x,
      y: territory.position_y,
    };
    const requestedPosition = {
      x: territory.position_x + unitDelta.x * GRID_SIZE,
      y: territory.position_y + unitDelta.y * GRID_SIZE,
    };

    setLocalPosition(territory.id, requestedPosition);
    void persistPosition(
      territory.id,
      requestedPosition,
      persistedPosition,
    );
    return true;
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
    const activeDrag = activeTerritoryDragRef.current;

    if (activeDrag?.pointerId === event.pointerId) {
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
      setLocalPosition(activeDrag.territoryId, nextPosition);
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

  function releasePointerCapture(pointerId: number) {
    const surface = surfaceRef.current;

    if (
      typeof surface?.hasPointerCapture === 'function' &&
      surface.hasPointerCapture(pointerId)
    ) {
      surface.releasePointerCapture(pointerId);
    }
  }

  function finishTerritoryDrag(event: ReactPointerEvent<HTMLElement>) {
    const activeDrag = activeTerritoryDragRef.current;

    if (!activeDrag || activeDrag.pointerId !== event.pointerId) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    activeTerritoryDragRef.current = null;
    setDraggingTerritoryId(null);
    releasePointerCapture(event.pointerId);

    const didMove =
      activeDrag.currentPosition.x !== activeDrag.startPosition.x ||
      activeDrag.currentPosition.y !== activeDrag.startPosition.y;

    if (!didMove) {
      return true;
    }

    const returnedToPersistedPosition =
      activeDrag.currentPosition.x === activeDrag.persistedPosition.x &&
      activeDrag.currentPosition.y === activeDrag.persistedPosition.y;

    if (returnedToPersistedPosition) {
      replacePositionSave(activeDrag.territoryId, null);
      return true;
    }

    void persistPosition(
      activeDrag.territoryId,
      activeDrag.currentPosition,
      activeDrag.persistedPosition,
    );
    return true;
  }

  function finishPointerPan(event: ReactPointerEvent<HTMLElement>) {
    if (finishTerritoryDrag(event)) {
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
    const activeDrag = activeTerritoryDragRef.current;

    if (activeDrag?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      setLocalPosition(activeDrag.territoryId, activeDrag.startPosition);
      activeTerritoryDragRef.current = null;
      setDraggingTerritoryId(null);
      releasePointerCapture(event.pointerId);
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
      if (
        event.target instanceof Element &&
        event.target.closest('[data-canvas-scroll-region="true"]')
      ) {
        return;
      }

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

  const requestTerritoryCreationPlacement = useCallback(() => {
    const bounds = surfaceRef.current?.getBoundingClientRect();

    return getTerritoryCreationPlacement({
      surfaceHeight: bounds?.height ?? 0,
      surfaceWidth: bounds?.width ?? 0,
      territories: loadState.territories,
      viewport,
    });
  }, [loadState.territories, viewport]);

  useEffect(() => {
    onTerritoryCreationPlacementRequestChange?.(
      requestTerritoryCreationPlacement,
    );

    return () => onTerritoryCreationPlacementRequestChange?.(null);
  }, [
    onTerritoryCreationPlacementRequestChange,
    requestTerritoryCreationPlacement,
  ]);

  function openCreateTerritoryDialog() {
    setTerritoryCreationPlacement(requestTerritoryCreationPlacement());
  }

  function handleBubbleCreated(bubble: Bubble) {
    activeBubbleCollection.addBubble(bubble);
    trackAnalytics(analyticsClient, 'bubble_created', {
      project_id: projectId,
      bubble_id: bubble.id,
      source_kind: 'manual',
    });
    setCreateBubbleDialogOpen(false);

    if (
      !loadState.territories.some(
        (territory) => territory.id === bubble.territory_id,
      )
    ) {
      activeBubbleCollection.retry();
    }
  }

  const renderedEmptyState =
    typeof emptyState === 'function'
      ? emptyState({ onCreateBubble: openCreateBubbleDialog })
      : emptyState;
  const hasDisplayedTerritories = displayedTerritories.length > 0;
  const failedPositionSaveEntry = Object.entries(activePositionSaves).find(
    ([, save]) => save.status === 'error',
  );
  const failedPositionTerritory = failedPositionSaveEntry
    ? positionedTerritories.find(
        ({ territory }) => territory.id === failedPositionSaveEntry[0],
      )?.territory
    : undefined;
  const failedVisibleCountSaveEntry = Object.entries(visibleCountSaves).find(
    ([, save]) => save.status === 'error',
  );
  const failedVisibleCountTerritory = failedVisibleCountSaveEntry
    ? positionedTerritories.find(
        ({ territory }) => territory.id === failedVisibleCountSaveEntry[0],
      )?.territory
    : undefined;

  function compactLayout() {
    if (
      positionedTerritories.length < 2 ||
      draggingTerritoryId !== null ||
      Object.keys(activePositionSaves).length > 0 ||
      activeCompactLayoutSave?.status === 'saving'
    ) {
      return;
    }

    const spatiallyOrdered = [...positionedTerritories].sort(
      (first, second) =>
        first.territory.position_y - second.territory.position_y ||
        first.territory.position_x - second.territory.position_x ||
        first.territory.created_at.localeCompare(second.territory.created_at) ||
        first.territory.id.localeCompare(second.territory.id),
    );
    const measurements = spatiallyOrdered.map(({ territory }) => {
      const element = territoryElementsRef.current.get(territory.id);
      const rectHeight = element?.getBoundingClientRect().height ?? 0;
      const height = element?.offsetHeight || rectHeight / viewport.zoom;

      return { id: territory.id, height };
    });

    if (
      measurements.some(
        ({ height }) => !Number.isFinite(height) || height <= 0,
      )
    ) {
      return;
    }

    const requestedPositions = getCompactTerritoryPositions(measurements, {
      x: Math.min(
        ...positionedTerritories.map(({ territory }) => territory.position_x),
      ),
      y: Math.min(
        ...positionedTerritories.map(({ territory }) => territory.position_y),
      ),
    });
    const territoriesById = new Map(
      positionedTerritories.map(({ territory }) => [territory.id, territory]),
    );
    const changedPositions = requestedPositions.filter((position) => {
      const territory = territoriesById.get(position.territory_id);

      return (
        territory &&
        (territory.position_x !== position.position_x ||
          territory.position_y !== position.position_y)
      );
    });

    if (changedPositions.length === 0) {
      replaceCompactLayoutSave(null);
      trackTerritoryAnalytics(
        analyticsClient,
        'territory_compact_layout_applied',
        {
          project_id: projectId,
          moved_territory_count: 0,
        },
      );
      return;
    }

    const persistedPositions = changedPositions.map((position) => {
      const territory = territoriesById.get(position.territory_id)!;

      return {
        territory_id: territory.id,
        position_x: territory.position_x,
        position_y: territory.position_y,
      };
    });

    void persistCompactLayout(changedPositions, persistedPositions);
  }

  const isCompactLayoutSaving = activeCompactLayoutSave?.status === 'saving';
  const canCompactLayout =
    positionedTerritories.length >= 2 &&
    draggingTerritoryId === null &&
    Object.keys(activePositionSaves).length === 0 &&
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
      data-selection-mode={
        isMultiSelectionActive && multiSelection?.maximumSelectionCount !== 1
          ? 'multiple'
          : 'single'
      }
      onLostPointerCapture={() => {
        const activeDrag = activeTerritoryDragRef.current;

        if (activeDrag) {
          setLocalPosition(activeDrag.territoryId, activeDrag.startPosition);
          activeTerritoryDragRef.current = null;
          setDraggingTerritoryId(null);
        }
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
        {positionedTerritories.map(({ bubbles, territory }) => (
          <TerritoryCard
            bubbles={bubbles}
            isMultiSelecting={isMultiSelectionActive}
            key={territory.id}
            linkedBubbleIds={linkedBubbleIds}
            onDragPointerDown={(event) =>
              handleTerritoryPointerDown(event, territory)
            }
            onBubbleActivate={(bubble) =>
              isMultiSelectionActive
                ? toggleMultiSelectedBubble(bubble.id)
                : selectBubble(bubble)
            }
            onBubbleReaderOpen={
              onBubbleReaderOpen
                ? (bubble) => {
                    trackTerritoryAnalytics(
                      analyticsClient,
                      'bubble_reader_opened_from_canvas',
                      {
                        project_id: projectId,
                        bubble_id: bubble.id,
                        territory_id: territory.id,
                      },
                    );
                    onBubbleReaderOpen(bubble);
                  }
                : undefined
            }
            onKeyboardMove={(delta) =>
              moveTerritoryWithKeyboard(territory, delta)
            }
            onDeleteRequest={() =>
              setTerritoryDeleteTarget({
                bubbleCount: bubbles.length,
                territory,
              })
            }
            onRename={async (title, signal) => {
              const renamedTerritory = await requestTerritoryRename(
                projectId,
                territory.id,
                { title },
                signal,
              );
              activeBubbleCollection.replaceTerritory(renamedTerritory);
              return renamedTerritory;
            }}
            onRenameSaveStatusChange={(nextStatus) =>
              setTerritoryRenameSaveStatuses((current) => {
                const next = { ...current };

                if (nextStatus === 'saved') {
                  delete next[territory.id];
                } else {
                  next[territory.id] = nextStatus;
                }

                return next;
              })
            }
            onScrollUnlock={(hiddenBubbleCount) =>
              trackTerritoryAnalytics(
                analyticsClient,
                'territory_scroll_unlocked',
                {
                  project_id: projectId,
                  territory_id: territory.id,
                  bubble_count: bubbles.length,
                  hidden_bubble_count: hiddenBubbleCount,
                },
              )
            }
            onVisibleCountChange={(visibleCount) => {
              trackTerritoryAnalytics(
                analyticsClient,
                'territory_visible_count_changed',
                {
                  project_id: projectId,
                  territory_id: territory.id,
                  bubble_count: bubbles.length,
                  previous_visible_count: territory.visible_count,
                  visible_count: visibleCount,
                },
              );
              changeVisibleCount(territory.id, visibleCount);
            }}
            selectedBubbleIds={selectedBubbleIds}
            status={
              draggingTerritoryId === territory.id
                ? 'dragging'
                : isCompactLayoutSaving
                  ? 'saving'
                  : (activePositionSaves[territory.id]?.status ?? 'default')
            }
            territory={territory}
            territoryRef={(element) => {
              if (element) {
                territoryElementsRef.current.set(territory.id, element);
              } else {
                territoryElementsRef.current.delete(territory.id);
              }
            }}
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
        {loadState.status === 'loading' && !hasDisplayedTerritories && (
          <CanvasLoadingState />
        )}
        {loadState.status === 'failed' && !hasDisplayedTerritories && (
          <CanvasErrorState onRetry={activeBubbleCollection.retry} />
        )}
        {loadState.status === 'partial' && !hasDisplayedTerritories && (
          <CanvasBubbleLoadNotice
            hasBubbles={false}
            isPartial
            onRetry={activeBubbleCollection.retry}
          />
        )}
        {loadState.status === 'ready' &&
          !hasDisplayedTerritories &&
          renderedEmptyState}
      </div>

      {(loadState.status === 'partial' || loadState.status === 'failed') &&
        hasDisplayedTerritories && (
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

      {hasDisplayedTerritories && !isMultiSelectionActive && (
        <CanvasBubbleActions
          canCompact={canCompactLayout}
          isCompacting={isCompactLayoutSaving}
          onCompact={compactLayout}
          onCreate={openCreateBubbleDialog}
          onCreateTerritory={openCreateTerritoryDialog}
          onStartDiscussion={onStartDiscussion}
        />
      )}

      {viewportSaveFailed && (
        <CanvasViewportSaveError onRetry={retryViewportSave} />
      )}

      {failedPositionSaveEntry && failedPositionTerritory && (
        <TerritoryPositionSaveError
          territoryTitle={failedPositionTerritory.title}
          onRetry={() => {
            const [territoryId, save] = failedPositionSaveEntry;
            void persistPosition(
              territoryId,
              save.requestedPosition,
              save.persistedPosition,
            );
          }}
          onRevert={() => {
            const [territoryId, save] = failedPositionSaveEntry;
            setLocalPosition(territoryId, save.persistedPosition);
            replacePositionSave(territoryId, null);
          }}
        />
      )}

      {activeCompactLayoutSave?.status === 'error' && (
        <CompactTerritoryLayoutSaveError
          onRetry={() => {
            void persistCompactLayout(
              activeCompactLayoutSave.requestedPositions,
              activeCompactLayoutSave.persistedPositions,
            );
          }}
        />
      )}

      {failedVisibleCountSaveEntry && failedVisibleCountTerritory && (
        <TerritoryVisibleCountSaveError
          territoryTitle={failedVisibleCountTerritory.title}
          onRetry={() =>
            retryVisibleCountSave(failedVisibleCountSaveEntry[0])
          }
          onRevert={() =>
            revertVisibleCountSave(failedVisibleCountSaveEntry[0])
          }
        />
      )}

      {isCreateBubbleDialogOpen && (
        <CreateBubbleDialog
          getTerritoryCreationPlacement={requestTerritoryCreationPlacement}
          onCancel={() => {
            setCreateBubbleDialogOpen(false);
          }}
          onCreated={handleBubbleCreated}
          projectId={projectId}
          requestCreate={requestBubbleCreate}
          territories={loadState.territories}
        />
      )}

      {territoryCreationPlacement && (
        <CreateTerritoryDialog
          onCancel={() => setTerritoryCreationPlacement(null)}
          onCreated={(territory) => {
            activeBubbleCollection.addTerritory(territory);
            setTerritoryCreationPlacement(null);
          }}
          placement={territoryCreationPlacement}
          projectId={projectId}
          requestCreate={requestTerritoryCreate}
        />
      )}

      {territoryDeleteTarget && (
        <DeleteTerritoryDialog
          bubbleCount={territoryDeleteTarget.bubbleCount}
          onCancel={() => setTerritoryDeleteTarget(null)}
          onDeleted={() => {
            const deletedTerritoryId = territoryDeleteTarget.territory.id;
            setTerritoryDeleteTarget(null);
            activeBubbleCollection.removeTerritory(deletedTerritoryId);
            activeBubbleCollection.refresh();
          }}
          requestDelete={requestTerritoryDelete}
          territory={territoryDeleteTarget.territory}
        />
      )}
    </section>
  );
}

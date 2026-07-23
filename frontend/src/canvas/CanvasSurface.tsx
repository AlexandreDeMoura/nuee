import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  CircleAlert,
  CircleDot,
  CirclePlus,
  Minus,
  Plus,
  RotateCcw,
} from 'lucide-react';
import {
  getProjectBubbles,
  updateBubblePosition,
  updateProjectViewport,
  type Bubble,
  type BubblePlacementInput,
  type Project,
  type ProjectViewportUpdateOptions,
  type UpdateBubblePositionInput,
  type UpdateProjectViewportInput,
} from '../api';
import {
  analytics,
  trackAnalytics,
  type AnalyticsClient,
} from '../analytics';
import {
  CreateBubbleDialog,
  type BubbleCreateRequest,
  type BubblePlacementRequest,
} from '../bubbles/CreateBubbleDialog';
import { BubbleCard } from './BubbleCard';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const ZOOM_STEP = 1.2;
const GRID_SIZE = 24;
const DEFAULT_VIEWPORT_SAVE_DELAY_MS = 500;

const focusRing =
  '[-webkit-tap-highlight-color:transparent] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/30';

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export type BubbleListRequest = (
  projectId: string,
  signal?: AbortSignal,
) => Promise<Bubble[]>;

export type ProjectViewportUpdateRequest = (
  projectId: string,
  input: UpdateProjectViewportInput,
  options?: ProjectViewportUpdateOptions,
) => Promise<Project>;

export type BubblePositionUpdateRequest = (
  projectId: string,
  bubbleId: string,
  input: UpdateBubblePositionInput,
) => Promise<Bubble>;

export interface CanvasEmptyStateActions {
  onCreateBubble: () => void;
}

export interface CanvasSurfaceProps {
  emptyState:
    | ReactNode
    | ((actions: CanvasEmptyStateActions) => ReactNode);
  initialViewport?: CanvasViewport;
  projectId: string;
  analyticsClient?: AnalyticsClient;
  requestBubbleCreate?: BubbleCreateRequest;
  requestBubbles?: BubbleListRequest;
  requestBubblePlacement?: BubblePlacementRequest;
  requestBubblePositionUpdate?: BubblePositionUpdateRequest;
  requestViewportUpdate?: ProjectViewportUpdateRequest;
  viewportSaveDelayMs?: number;
}

type CanvasLoadState =
  | { status: 'loading'; bubbles: Bubble[] }
  | { status: 'ready'; bubbles: Bubble[] }
  | { status: 'partial'; bubbles: Bubble[] }
  | { status: 'failed'; bubbles: Bubble[] };

interface ActivePan {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startViewportX: number;
  startViewportY: number;
}

interface BubblePosition {
  x: number;
  y: number;
}

interface ActiveBubbleDrag {
  bubbleId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPosition: BubblePosition;
  currentPosition: BubblePosition;
  persistedPosition: BubblePosition;
  zoom: number;
}

interface BubblePositionSave {
  attempt: number;
  persistedPosition: BubblePosition;
  requestedPosition: BubblePosition;
  status: 'saving' | 'error';
}

function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function isSameViewport(first: CanvasViewport, second: CanvasViewport) {
  return first.x === second.x && first.y === second.y && first.zoom === second.zoom;
}

function projectViewport(project: Project): CanvasViewport {
  return {
    x: project.canvas_viewport_x,
    y: project.canvas_viewport_y,
    zoom: project.canvas_zoom,
  };
}

function viewportInput(viewport: CanvasViewport): UpdateProjectViewportInput {
  return {
    canvas_viewport_x: viewport.x,
    canvas_viewport_y: viewport.y,
    canvas_zoom: viewport.zoom,
  };
}

function normalizeWheelDelta(delta: number, deltaMode: number, pageSize: number) {
  if (deltaMode === 1) {
    return delta * 16;
  }

  if (deltaMode === 2) {
    return delta * pageSize;
  }

  return delta;
}

function isRenderableBubble(value: unknown, projectId: string): value is Bubble {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const bubble = value as Partial<Bubble>;

  return (
    typeof bubble.id === 'string' &&
    bubble.id.length > 0 &&
    bubble.project_id === projectId &&
    typeof bubble.title === 'string' &&
    bubble.title.trim().length > 0 &&
    (bubble.summary === null || typeof bubble.summary === 'string') &&
    typeof bubble.content === 'string' &&
    bubble.content.trim().length > 0 &&
    typeof bubble.position_x === 'number' &&
    Number.isFinite(bubble.position_x) &&
    typeof bubble.position_y === 'number' &&
    Number.isFinite(bubble.position_y) &&
    typeof bubble.created_at === 'string' &&
    typeof bubble.updated_at === 'string' &&
    (bubble.source_kind === 'manual' || bubble.source_kind === 'discussion') &&
    (bubble.source_discussion_id === null ||
      typeof bubble.source_discussion_id === 'string') &&
    Array.isArray(bubble.source_message_ids) &&
    bubble.source_message_ids.every((id) => typeof id === 'string')
  );
}

function renderableBubbles(records: unknown, projectId: string) {
  if (!Array.isArray(records)) {
    throw new Error('The bubble response was not a list.');
  }

  const seenIds = new Set<string>();
  const bubbles: Bubble[] = [];
  let invalidCount = 0;

  for (const record of records) {
    if (!isRenderableBubble(record, projectId) || seenIds.has(record.id)) {
      invalidCount += 1;
      continue;
    }

    seenIds.add(record.id);
    bubbles.push(record);
  }

  return { bubbles, invalidCount };
}

function mergeBubbles(current: Bubble[], incoming: Bubble[]) {
  const incomingById = new Map(incoming.map((bubble) => [bubble.id, bubble]));
  const merged = current.map((bubble) => incomingById.get(bubble.id) ?? bubble);
  const currentIds = new Set(current.map((bubble) => bubble.id));

  for (const bubble of incoming) {
    if (!currentIds.has(bubble.id)) {
      merged.push(bubble);
    }
  }

  return merged;
}

function CanvasLoadingState() {
  return (
    <div
      className="pointer-events-none flex flex-col items-center justify-center text-center"
      role="status"
      aria-label="Loading canvas"
    >
      <span className="mb-3 grid size-10 place-items-center rounded-[11px] bg-white/75 text-[#6681b5] shadow-[0_1px_3px_rgba(30,39,51,0.06)]">
        <CircleDot
          className="size-[18px] animate-pulse motion-reduce:animate-none"
          strokeWidth={1.7}
          aria-hidden="true"
        />
      </span>
      <p className="text-xs font-medium text-[#7b8899]">Loading canvas…</p>
    </div>
  );
}

function CanvasErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="pointer-events-auto flex max-w-[360px] flex-col items-center rounded-[14px] border border-[#e1e6ec] bg-white/95 px-7 py-6 text-center shadow-[0_12px_32px_-18px_rgba(30,39,51,0.35)]"
      data-canvas-overlay
      role="alert"
    >
      <span className="mb-3 grid size-10 place-items-center rounded-[11px] bg-[#f9eeee] text-[#a95f57]">
        <CircleAlert className="size-[17px]" strokeWidth={1.7} aria-hidden="true" />
      </span>
      <h2 className="text-[14px] font-semibold text-[#1e2733]">
        We couldn’t load this canvas
      </h2>
      <p className="mt-1.5 text-xs leading-[1.55] text-[#7b8899]">
        Your saved bubbles are still safe. Check your connection and try again.
      </p>
      <button
        className={`mt-4 inline-flex min-h-9 cursor-pointer items-center justify-center gap-[7px] rounded-[9px] border border-[#cdd8ea] bg-[#f6f8fc] px-3.5 py-2 text-[12.5px] font-semibold text-[#33538f] hover:border-[#aebed8] hover:bg-[#eef2fa] ${focusRing}`}
        type="button"
        onClick={onRetry}
      >
        <RotateCcw className="size-[15px]" strokeWidth={1.8} aria-hidden="true" />
        Try again
      </button>
    </div>
  );
}

function CanvasBubbleLoadNotice({
  hasBubbles,
  isPartial,
  onRetry,
}: {
  hasBubbles: boolean;
  isPartial: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      className={`${
        hasBubbles
          ? 'pointer-events-auto absolute top-4 right-4 max-w-[350px]'
          : 'pointer-events-auto max-w-[360px]'
      } flex items-start gap-3 rounded-[12px] border border-[#ead5d2] bg-white/95 px-4 py-3.5 text-left shadow-[0_10px_28px_-16px_rgba(30,39,51,0.4)] backdrop-blur-sm`}
      data-canvas-overlay
      role="alert"
    >
      <CircleAlert
        className="mt-0.5 size-[16px] shrink-0 text-[#b4544e]"
        strokeWidth={1.8}
        aria-hidden="true"
      />
      <div>
        <p className="text-xs font-semibold text-[#704944]">
          {isPartial
            ? 'Some bubbles couldn’t be displayed.'
            : 'We couldn’t refresh your bubbles.'}
        </p>
        <p className="mt-1 text-[11.5px] leading-[1.45] text-[#8b6864]">
          {hasBubbles
            ? 'The bubbles already shown remain available.'
            : 'Your saved bubble data is still safe.'}
        </p>
        <button
          className={`mt-2.5 cursor-pointer text-[11.5px] font-semibold text-[#8f4843] hover:text-[#6f3531] ${focusRing}`}
          type="button"
          onClick={onRetry}
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function CanvasViewportSaveError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="pointer-events-auto absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-[10px] border border-[#ead5d2] bg-white/95 px-3.5 py-2.5 text-xs text-[#79504c] shadow-[0_8px_24px_-14px_rgba(30,39,51,0.4)] backdrop-blur-sm"
      data-canvas-overlay
      role="alert"
    >
      <CircleAlert className="size-[15px] shrink-0 text-[#b4544e]" strokeWidth={1.8} aria-hidden="true" />
      <span>Couldn’t save this canvas view.</span>
      <button
        className={`cursor-pointer font-semibold text-[#8f4843] hover:text-[#6f3531] ${focusRing}`}
        type="button"
        onClick={onRetry}
      >
        Retry save
      </button>
    </div>
  );
}

function BubblePositionSaveError({
  bubbleTitle,
  onRetry,
  onRevert,
}: {
  bubbleTitle: string;
  onRetry: () => void;
  onRevert: () => void;
}) {
  return (
    <div
      className="pointer-events-auto absolute top-4 left-4 flex max-w-[380px] items-center gap-3 rounded-[10px] border border-[#ead5d2] bg-white/95 px-3.5 py-2.5 text-xs text-[#79504c] shadow-[0_8px_24px_-14px_rgba(30,39,51,0.4)] backdrop-blur-sm"
      data-canvas-overlay
      role="alert"
    >
      <CircleAlert
        className="size-[15px] shrink-0 text-[#b4544e]"
        strokeWidth={1.8}
        aria-hidden="true"
      />
      <span>Couldn’t save “{bubbleTitle}” position.</span>
      <button
        className={`shrink-0 cursor-pointer font-semibold text-[#8f4843] hover:text-[#6f3531] ${focusRing}`}
        type="button"
        onClick={onRetry}
      >
        Retry
      </button>
      <button
        className={`shrink-0 cursor-pointer font-semibold text-[#6f7782] hover:text-[#414c59] ${focusRing}`}
        type="button"
        onClick={onRevert}
      >
        Revert
      </button>
    </div>
  );
}

function CanvasZoomControls({
  zoom,
  onReset,
  onZoomIn,
  onZoomOut,
}: {
  zoom: number;
  onReset: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  return (
    <div
      className="pointer-events-auto absolute bottom-4 left-4 flex items-center overflow-hidden rounded-[10px] border border-[#d7dee7] bg-white/95 shadow-[0_5px_18px_-10px_rgba(30,39,51,0.35)] backdrop-blur-sm"
      data-canvas-overlay
      aria-label="Canvas zoom controls"
      role="group"
    >
      <button
        className={`grid size-9 cursor-pointer place-items-center text-[#687789] hover:bg-[#f4f6f9] hover:text-[#33538f] disabled:cursor-default disabled:text-[#c4cdd8] ${focusRing}`}
        type="button"
        aria-label="Zoom out"
        disabled={zoom <= MIN_ZOOM}
        onClick={onZoomOut}
      >
        <Minus className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
      </button>
      <button
        className={`h-9 min-w-[58px] cursor-pointer border-x border-[#e5e9ef] px-2 text-[10.5px] font-medium text-[#687789] hover:bg-[#f4f6f9] hover:text-[#33538f] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${focusRing}`}
        type="button"
        aria-label="Reset zoom to 100%"
        onClick={onReset}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        className={`grid size-9 cursor-pointer place-items-center text-[#687789] hover:bg-[#f4f6f9] hover:text-[#33538f] disabled:cursor-default disabled:text-[#c4cdd8] ${focusRing}`}
        type="button"
        aria-label="Zoom in"
        disabled={zoom >= MAX_ZOOM}
        onClick={onZoomIn}
      >
        <Plus className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
      </button>
    </div>
  );
}

function CanvasBubbleAction({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      className="pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2 rounded-[13px] border border-[#e1e6ec] bg-white p-1.5 shadow-[0_8px_24px_-8px_rgba(30,39,51,0.28)]"
      data-canvas-overlay
    >
      <button
        className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-[9px] px-[13px] py-2 text-[12.5px] font-medium text-[#5c6a7a] hover:bg-[#f4f6f9] hover:text-[#33538f] ${focusRing}`}
        type="button"
        aria-haspopup="dialog"
        onClick={onCreate}
      >
        <CirclePlus className="size-[15px]" strokeWidth={1.8} aria-hidden="true" />
        Bubble
      </button>
    </div>
  );
}

export function CanvasSurface({
  emptyState,
  initialViewport = { x: 0, y: 0, zoom: 1 },
  projectId,
  analyticsClient = analytics,
  requestBubbleCreate,
  requestBubbles = getProjectBubbles,
  requestBubblePlacement,
  requestBubblePositionUpdate = updateBubblePosition,
  requestViewportUpdate = updateProjectViewport,
  viewportSaveDelayMs = DEFAULT_VIEWPORT_SAVE_DELAY_MS,
}: CanvasSurfaceProps) {
  const [loadState, setLoadState] = useState<CanvasLoadState>({
    status: 'loading',
    bubbles: [],
  });
  const [requestKey, setRequestKey] = useState(0);
  const [viewport, setViewport] = useState<CanvasViewport>(initialViewport);
  const [viewportSaveFailed, setViewportSaveFailed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [draggingBubbleId, setDraggingBubbleId] = useState<string | null>(null);
  const [positionSaves, setPositionSaves] = useState<
    Record<string, BubblePositionSave>
  >({});
  const [isCreateBubbleDialogOpen, setIsCreateBubbleDialogOpen] = useState(false);
  const [createPlacementInput, setCreatePlacementInput] =
    useState<BubblePlacementInput | null>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const activePanRef = useRef<ActivePan | null>(null);
  const activeBubbleDragRef = useRef<ActiveBubbleDrag | null>(null);
  const positionSavesRef = useRef<Record<string, BubblePositionSave>>({});
  const positionSaveAttemptRef = useRef(0);
  const latestViewportRef = useRef(initialViewport);
  const persistedViewportRef = useRef(initialViewport);
  const failedViewportRef = useRef<CanvasViewport | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const pendingSaveRef = useRef<{
    keepalive: boolean;
    viewport: CanvasViewport;
  } | null>(null);
  const mountedRef = useRef(true);
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
    [],
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
      projectId,
      replacePositionSave,
      requestBubblePositionUpdate,
      setLocalBubblePosition,
    ],
  );

  const persistViewport = useCallback(
    async function persist(
      requestedViewport: CanvasViewport,
      keepalive = false,
    ): Promise<void> {
      if (saveInFlightRef.current) {
        pendingSaveRef.current = {
          keepalive: keepalive || (pendingSaveRef.current?.keepalive ?? false),
          viewport: requestedViewport,
        };
        return;
      }

      if (isSameViewport(requestedViewport, persistedViewportRef.current)) {
        return;
      }

      saveInFlightRef.current = true;

      if (mountedRef.current) {
        setViewportSaveFailed(false);
      }

      try {
        const updatedProject = await requestViewportUpdate(
          projectId,
          viewportInput(requestedViewport),
          { keepalive },
        );
        persistedViewportRef.current = projectViewport(updatedProject);
        failedViewportRef.current = null;

        if (mountedRef.current) {
          setViewportSaveFailed(false);
        }
      } catch {
        if (isSameViewport(latestViewportRef.current, requestedViewport)) {
          failedViewportRef.current = requestedViewport;

          if (mountedRef.current) {
            setViewportSaveFailed(true);
          }
        }
      } finally {
        saveInFlightRef.current = false;
        const pendingSave = pendingSaveRef.current;
        pendingSaveRef.current = null;

        if (
          pendingSave &&
          !isSameViewport(pendingSave.viewport, persistedViewportRef.current)
        ) {
          void persist(pendingSave.viewport, pendingSave.keepalive);
        }
      }
    },
    [projectId, requestViewportUpdate],
  );

  const applyViewport = useCallback(
    (update: (current: CanvasViewport) => CanvasViewport) => {
      setViewport((current) => {
        const nextViewport = update(current);

        if (isSameViewport(current, nextViewport)) {
          return current;
        }

        latestViewportRef.current = nextViewport;
        return nextViewport;
      });
    },
    [],
  );

  const flushViewport = useCallback(() => {
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    failedViewportRef.current = null;
    void persistViewport(latestViewportRef.current, true);
  }, [persistViewport]);

  useEffect(() => {
    latestViewportRef.current = viewport;

    if (isSameViewport(viewport, persistedViewportRef.current)) {
      failedViewportRef.current = null;
      setViewportSaveFailed(false);
      return;
    }

    if (
      failedViewportRef.current &&
      isSameViewport(viewport, failedViewportRef.current)
    ) {
      return;
    }

    setViewportSaveFailed(false);
    saveTimeoutRef.current = window.setTimeout(() => {
      saveTimeoutRef.current = null;
      void persistViewport(viewport);
    }, viewportSaveDelayMs);

    return () => {
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [persistViewport, viewport, viewportSaveDelayMs]);

  useEffect(() => {
    mountedRef.current = true;
    window.addEventListener('pagehide', flushViewport);
    window.addEventListener('popstate', flushViewport);

    return () => {
      mountedRef.current = false;
      window.removeEventListener('pagehide', flushViewport);
      window.removeEventListener('popstate', flushViewport);
      flushViewport();
    };
  }, [flushViewport]);

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
  }, [projectId, requestBubbles, requestKey]);

  function isInteractiveTarget(target: EventTarget | null) {
    return (
      target instanceof Element &&
      target.closest('[data-canvas-overlay], [data-canvas-interactive]') !== null
    );
  }

  function handleBubblePointerDown(
    event: ReactPointerEvent<HTMLElement>,
    bubble: Bubble,
  ) {
    if (
      event.button !== 0 ||
      positionSavesRef.current[bubble.id]?.status === 'saving'
    ) {
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
    const activeDrag = activeBubbleDragRef.current;

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
      setLocalBubblePosition(activeDrag.bubbleId, nextPosition);
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

  function finishBubbleDrag(event: ReactPointerEvent<HTMLElement>) {
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
    const activeDrag = activeBubbleDragRef.current;

    if (activeDrag?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      setLocalBubblePosition(activeDrag.bubbleId, activeDrag.startPosition);
      activeBubbleDragRef.current = null;
      setDraggingBubbleId(null);
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

  function retryBubbleLoad() {
    setLoadState((current) => ({
      status: 'loading',
      bubbles: current.bubbles,
    }));
    setRequestKey((key) => key + 1);
  }

  function openCreateBubbleDialog() {
    setIsCreateBubbleDialogOpen(true);
  }

  function handleBubbleCreated(bubble: Bubble) {
    setLoadState((current) => ({
      status: current.status === 'partial' ? 'partial' : 'ready',
      bubbles: mergeBubbles(current.bubbles, [bubble]),
    }));
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
    ? loadState.bubbles.find(
        (bubble) => bubble.id === failedPositionSaveEntry[0],
      )
    : undefined;

  return (
    <section
      className={`relative min-w-0 flex-1 select-none overflow-hidden bg-[#eef1f5] ${
        isPanning ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      aria-label="Project canvas"
      data-canvas-x={viewport.x}
      data-canvas-y={viewport.y}
      data-canvas-zoom={viewport.zoom}
      onLostPointerCapture={() => {
        const activeDrag = activeBubbleDragRef.current;

        if (activeDrag) {
          setLocalBubblePosition(activeDrag.bubbleId, activeDrag.startPosition);
          activeBubbleDragRef.current = null;
          setDraggingBubbleId(null);
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
        {loadState.bubbles.map((bubble) => {
          const positionSave = positionSaves[bubble.id];
          const status =
            draggingBubbleId === bubble.id
              ? 'dragging'
              : (positionSave?.status ?? 'default');

          return (
            <BubbleCard
              bubble={bubble}
              key={bubble.id}
              onPointerDown={(event) =>
                handleBubblePointerDown(event, bubble)
              }
              status={status}
            />
          );
        })}
      </div>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 py-10 lg:px-10">
        {loadState.status === 'loading' && loadState.bubbles.length === 0 && (
          <CanvasLoadingState />
        )}
        {loadState.status === 'failed' && loadState.bubbles.length === 0 && (
          <CanvasErrorState onRetry={retryBubbleLoad} />
        )}
        {loadState.status === 'partial' && loadState.bubbles.length === 0 && (
          <CanvasBubbleLoadNotice
            hasBubbles={false}
            isPartial
            onRetry={retryBubbleLoad}
          />
        )}
        {loadState.status === 'ready' &&
          loadState.bubbles.length === 0 &&
          renderedEmptyState}
      </div>

      {(loadState.status === 'partial' || loadState.status === 'failed') &&
        loadState.bubbles.length > 0 && (
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

      {loadState.bubbles.length > 0 && (
        <CanvasBubbleAction onCreate={openCreateBubbleDialog} />
      )}

      {viewportSaveFailed && (
        <CanvasViewportSaveError
          onRetry={() => {
            failedViewportRef.current = null;
            void persistViewport(latestViewportRef.current);
          }}
        />
      )}

      {failedPositionSaveEntry && failedPositionBubble && (
        <BubblePositionSaveError
          bubbleTitle={failedPositionBubble.title}
          onRetry={() => {
            const [bubbleId, save] = failedPositionSaveEntry;
            void persistBubblePosition(
              bubbleId,
              save.requestedPosition,
              save.persistedPosition,
            );
          }}
          onRevert={() => {
            const [bubbleId, save] = failedPositionSaveEntry;
            setLocalBubblePosition(bubbleId, save.persistedPosition);
            replacePositionSave(bubbleId, null);
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

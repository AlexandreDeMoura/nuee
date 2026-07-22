import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { CircleAlert, CircleDot, Minus, Plus, RotateCcw } from 'lucide-react';
import {
  getProjectBubbles,
  updateProjectViewport,
  type Bubble,
  type Project,
  type ProjectViewportUpdateOptions,
  type UpdateProjectViewportInput,
} from '../api';

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

export interface CanvasSurfaceProps {
  emptyState: ReactNode;
  initialViewport?: CanvasViewport;
  projectId: string;
  requestBubbles?: BubbleListRequest;
  requestViewportUpdate?: ProjectViewportUpdateRequest;
  viewportSaveDelayMs?: number;
}

type CanvasLoadState =
  | { status: 'loading' }
  | { status: 'ready'; bubbles: Bubble[] }
  | { status: 'failed' };

interface ActivePan {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startViewportX: number;
  startViewportY: number;
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

export function CanvasSurface({
  emptyState,
  initialViewport = { x: 0, y: 0, zoom: 1 },
  projectId,
  requestBubbles = getProjectBubbles,
  requestViewportUpdate = updateProjectViewport,
  viewportSaveDelayMs = DEFAULT_VIEWPORT_SAVE_DELAY_MS,
}: CanvasSurfaceProps) {
  const [loadState, setLoadState] = useState<CanvasLoadState>({ status: 'loading' });
  const [requestKey, setRequestKey] = useState(0);
  const [viewport, setViewport] = useState<CanvasViewport>(initialViewport);
  const [viewportSaveFailed, setViewportSaveFailed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const surfaceRef = useRef<HTMLElement>(null);
  const activePanRef = useRef<ActivePan | null>(null);
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

    requestBubbles(projectId, controller.signal)
      .then((bubbles) => {
        if (!controller.signal.aborted) {
          setLoadState({ status: 'ready', bubbles });
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        if (!controller.signal.aborted) {
          setLoadState({ status: 'failed' });
        }
      });

    return () => controller.abort();
  }, [projectId, requestBubbles, requestKey]);

  function isOverlayTarget(target: EventTarget | null) {
    return target instanceof Element && target.closest('[data-canvas-overlay]') !== null;
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if ((event.button !== 0 && event.button !== 1) || isOverlayTarget(event.target)) {
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
      />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 py-10 lg:px-10">
        {loadState.status === 'loading' && <CanvasLoadingState />}
        {loadState.status === 'failed' && (
          <CanvasErrorState
            onRetry={() => {
              setLoadState({ status: 'loading' });
              setRequestKey((key) => key + 1);
            }}
          />
        )}
        {loadState.status === 'ready' && loadState.bubbles.length === 0 && emptyState}
      </div>

      <CanvasZoomControls
        zoom={viewport.zoom}
        onReset={() => zoomAt(1)}
        onZoomIn={() => zoomAt((currentZoom) => currentZoom * ZOOM_STEP)}
        onZoomOut={() => zoomAt((currentZoom) => currentZoom / ZOOM_STEP)}
      />

      {viewportSaveFailed && (
        <CanvasViewportSaveError
          onRetry={() => {
            failedViewportRef.current = null;
            void persistViewport(latestViewportRef.current);
          }}
        />
      )}
    </section>
  );
}

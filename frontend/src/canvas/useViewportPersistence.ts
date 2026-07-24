import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  trackAnalytics,
  type AnalyticsClient,
} from '../analytics';
import {
  DEFAULT_VIEWPORT,
  isSameViewport,
  projectViewport,
  viewportInput,
} from './canvasModel';
import type {
  CanvasViewport,
  ProjectViewportUpdateRequest,
} from './canvasTypes';

interface UseViewportPersistenceOptions {
  analyticsClient: AnalyticsClient;
  initialViewport: CanvasViewport;
  projectId: string;
  requestViewportUpdate: ProjectViewportUpdateRequest;
  saveDelayMs: number;
}

export function useViewportPersistence({
  analyticsClient,
  initialViewport,
  projectId,
  requestViewportUpdate,
  saveDelayMs,
}: UseViewportPersistenceOptions) {
  const [viewport, setViewport] = useState<CanvasViewport>(initialViewport);
  const [viewportSaveFailed, setViewportSaveFailed] = useState(false);
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
  const restoredViewportProjectIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      restoredViewportProjectIdRef.current === projectId ||
      isSameViewport(initialViewport, DEFAULT_VIEWPORT)
    ) {
      return;
    }

    restoredViewportProjectIdRef.current = projectId;
    trackAnalytics(analyticsClient, 'canvas_viewport_restored', {
      project_id: projectId,
    });
  }, [analyticsClient, initialViewport, projectId]);

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

  const retryViewportSave = useCallback(() => {
    failedViewportRef.current = null;
    void persistViewport(latestViewportRef.current);
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
    }, saveDelayMs);

    return () => {
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [persistViewport, saveDelayMs, viewport]);

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

  return {
    applyViewport,
    retryViewportSave,
    viewport,
    viewportSaveFailed,
  };
}

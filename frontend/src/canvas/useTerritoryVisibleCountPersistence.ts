import {
  TERRITORY_VISIBLE_COUNT_MAX,
  TERRITORY_VISIBLE_COUNT_MIN,
} from '@nuee/shared-types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isTerritoryResponse, type Territory } from '../api';
import type {
  CanvasSaveStatus,
  TerritoryVisibleCountUpdateRequest,
} from './canvasTypes';

export const DEFAULT_VISIBLE_COUNT_SAVE_DELAY_MS = 450;

export interface TerritoryVisibleCountTarget {
  territory: Territory;
  total: number;
}

export interface TerritoryVisibleCountSave {
  persistedCount: number;
  requestedCount: number;
  status: 'dirty' | 'saving' | 'error';
}

interface UseTerritoryVisibleCountPersistenceOptions {
  onSaveStatusChange?: (status: CanvasSaveStatus) => void;
  projectId: string;
  requestUpdate: TerritoryVisibleCountUpdateRequest;
  saveDelayMs?: number;
  targets: readonly TerritoryVisibleCountTarget[];
}

function clampVisibleCount(value: number, total: number): number {
  return Math.min(
    Math.max(
      value,
      TERRITORY_VISIBLE_COUNT_MIN,
    ),
    Math.min(total, TERRITORY_VISIBLE_COUNT_MAX),
  );
}

function overallSaveStatus(
  saves: Readonly<Record<string, TerritoryVisibleCountSave>>,
): CanvasSaveStatus {
  const values = Object.values(saves);

  if (values.some(({ status }) => status === 'error')) {
    return 'error';
  }
  if (values.some(({ status }) => status === 'saving')) {
    return 'saving';
  }
  if (values.some(({ status }) => status === 'dirty')) {
    return 'dirty';
  }
  return 'saved';
}

export function useTerritoryVisibleCountPersistence({
  onSaveStatusChange,
  projectId,
  requestUpdate,
  saveDelayMs = DEFAULT_VISIBLE_COUNT_SAVE_DELAY_MS,
  targets,
}: UseTerritoryVisibleCountPersistenceOptions) {
  const [localCounts, setLocalCountsState] = useState<Record<string, number>>(
    {},
  );
  const [saves, setSavesState] = useState<
    Record<string, TerritoryVisibleCountSave>
  >({});
  const localCountsRef = useRef(localCounts);
  const persistedCountsRef = useRef<Record<string, number>>({});
  const savesRef = useRef(saves);
  const targetsRef = useRef(new Map<string, TerritoryVisibleCountTarget>());
  const observedTargetsRef = useRef(
    new Map<string, { total: number; updatedAt: string; visibleCount: number }>(),
  );
  const timersRef = useRef(new Map<string, number>());
  const activeRequestsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const persistRef = useRef<(territoryId: string) => Promise<void>>(async () => {});
  const onSaveStatusChangeRef = useRef(onSaveStatusChange);

  useEffect(() => {
    onSaveStatusChangeRef.current = onSaveStatusChange;
  }, [onSaveStatusChange]);

  const replaceSave = useCallback(
    (territoryId: string, save: TerritoryVisibleCountSave | null) => {
      const next = { ...savesRef.current };

      if (save) {
        next[territoryId] = save;
      } else {
        delete next[territoryId];
      }

      savesRef.current = next;
      setSavesState(next);
    },
    [],
  );

  const setLocalCount = useCallback((territoryId: string, count: number) => {
    const next = { ...localCountsRef.current, [territoryId]: count };
    localCountsRef.current = next;
    setLocalCountsState(next);
  }, []);

  const scheduleSave = useCallback(
    (territoryId: string, delay = saveDelayMs) => {
      const existing = timersRef.current.get(territoryId);

      if (existing !== undefined) {
        window.clearTimeout(existing);
      }

      const timeoutId = window.setTimeout(() => {
        timersRef.current.delete(territoryId);
        void persistRef.current(territoryId);
      }, delay);
      timersRef.current.set(territoryId, timeoutId);
    },
    [saveDelayMs],
  );

  const persist = useCallback(
    async (territoryId: string) => {
      if (activeRequestsRef.current.has(territoryId)) {
        return;
      }

      const target = targetsRef.current.get(territoryId);
      const save = savesRef.current[territoryId];

      if (!target || !save || save.status === 'error') {
        return;
      }

      const requestedCount = clampVisibleCount(save.requestedCount, target.total);

      if (requestedCount === save.persistedCount) {
        setLocalCount(territoryId, requestedCount);
        replaceSave(territoryId, null);
        return;
      }

      activeRequestsRef.current.add(territoryId);
      replaceSave(territoryId, {
        ...save,
        requestedCount,
        status: 'saving',
      });

      try {
        const updated = await requestUpdate(projectId, territoryId, {
          visible_count: requestedCount,
        });
        const currentTarget = targetsRef.current.get(territoryId);

        if (
          !currentTarget ||
          !isTerritoryResponse(updated, projectId) ||
          updated.id !== territoryId ||
          updated.visible_count > currentTarget.total
        ) {
          throw new Error('The saved territory visible count was invalid.');
        }

        if (!mountedRef.current) {
          return;
        }

        persistedCountsRef.current[territoryId] = updated.visible_count;
        const currentSave = savesRef.current[territoryId];

        if (
          currentSave &&
          currentSave.requestedCount !== requestedCount
        ) {
          const nextRequestedCount = clampVisibleCount(
            currentSave.requestedCount,
            currentTarget.total,
          );
          setLocalCount(territoryId, nextRequestedCount);

          if (nextRequestedCount === updated.visible_count) {
            replaceSave(territoryId, null);
          } else {
            replaceSave(territoryId, {
              persistedCount: updated.visible_count,
              requestedCount: nextRequestedCount,
              status: 'dirty',
            });
            scheduleSave(territoryId, 0);
          }
        } else {
          setLocalCount(territoryId, updated.visible_count);
          replaceSave(territoryId, null);
        }
      } catch {
        if (!mountedRef.current) {
          return;
        }

        const currentSave = savesRef.current[territoryId];

        if (currentSave?.requestedCount !== requestedCount) {
          if (currentSave) {
            replaceSave(territoryId, {
              ...currentSave,
              status: 'dirty',
            });
            scheduleSave(territoryId, 0);
          }
        } else {
          replaceSave(territoryId, {
            persistedCount: save.persistedCount,
            requestedCount,
            status: 'error',
          });
        }
      } finally {
        activeRequestsRef.current.delete(territoryId);
      }
    }, [projectId, replaceSave, requestUpdate, scheduleSave, setLocalCount],
  );

  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  useEffect(() => {
    const nextTargets = new Map(
      targets.map((target) => [target.territory.id, target]),
    );
    targetsRef.current = nextTargets;
    const validIds = new Set(nextTargets.keys());
    const nextLocalCounts = { ...localCountsRef.current };
    const nextPersistedCounts = { ...persistedCountsRef.current };
    const nextSaves = { ...savesRef.current };
    let localChanged = false;
    let savesChanged = false;

    for (const [territoryId, target] of nextTargets) {
      const previous = observedTargetsRef.current.get(territoryId);
      const serverCount = clampVisibleCount(
        target.territory.visible_count,
        target.total,
      );
      const isFirstObservation = previous === undefined;
      const serverChanged =
        previous !== undefined &&
        (previous.visibleCount !== target.territory.visible_count ||
          previous.updatedAt !== target.territory.updated_at);
      const totalChanged = previous?.total !== target.total;

      observedTargetsRef.current.set(territoryId, {
        total: target.total,
        updatedAt: target.territory.updated_at,
        visibleCount: target.territory.visible_count,
      });

      if (isFirstObservation || serverChanged) {
        nextPersistedCounts[territoryId] = serverCount;
      } else if (totalChanged) {
        nextPersistedCounts[territoryId] = clampVisibleCount(
          nextPersistedCounts[territoryId] ?? serverCount,
          target.total,
        );
      }

      const persistedCount = nextPersistedCounts[territoryId] ?? serverCount;
      const currentSave = nextSaves[territoryId];
      const currentLocalCount = nextLocalCounts[territoryId] ?? serverCount;
      const requestedCount = clampVisibleCount(currentLocalCount, target.total);

      if (currentSave) {
        if (requestedCount === persistedCount) {
          delete nextSaves[territoryId];
          savesChanged = true;
        } else if (
          requestedCount !== currentSave.requestedCount ||
          persistedCount !== currentSave.persistedCount
        ) {
          nextSaves[territoryId] = {
            persistedCount,
            requestedCount,
            status: 'dirty',
          };
          savesChanged = true;
          scheduleSave(territoryId);
        }
      }

      const nextLocalCount = currentSave ? requestedCount : serverChanged || isFirstObservation
        ? serverCount
        : requestedCount;

      if (nextLocalCounts[territoryId] !== nextLocalCount) {
        nextLocalCounts[territoryId] = nextLocalCount;
        localChanged = true;
      }
    }

    for (const territoryId of Object.keys(nextLocalCounts)) {
      if (validIds.has(territoryId)) {
        continue;
      }

      const timer = timersRef.current.get(territoryId);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timersRef.current.delete(territoryId);
      }
      observedTargetsRef.current.delete(territoryId);
      delete nextLocalCounts[territoryId];
      delete nextPersistedCounts[territoryId];
      if (nextSaves[territoryId]) {
        delete nextSaves[territoryId];
        savesChanged = true;
      }
      localChanged = true;
    }

    persistedCountsRef.current = nextPersistedCounts;
    if (localChanged) {
      localCountsRef.current = nextLocalCounts;
      setLocalCountsState(nextLocalCounts);
    }
    if (savesChanged) {
      savesRef.current = nextSaves;
      setSavesState(nextSaves);
    }
  }, [scheduleSave, targets]);

  useEffect(() => {
    onSaveStatusChangeRef.current?.(overallSaveStatus(saves));
  }, [saves]);

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;

    return () => {
      mountedRef.current = false;
      for (const timeoutId of timers.values()) {
        window.clearTimeout(timeoutId);
      }
      timers.clear();
    };
  }, []);

  const changeVisibleCount = useCallback(
    (territoryId: string, nextCount: number) => {
      const target = targetsRef.current.get(territoryId);

      if (!target) {
        return;
      }

      const clampedCount = clampVisibleCount(nextCount, target.total);
      const currentCount =
        localCountsRef.current[territoryId] ??
        clampVisibleCount(target.territory.visible_count, target.total);

      if (clampedCount === currentCount) {
        return;
      }

      const persistedCount =
        persistedCountsRef.current[territoryId] ??
        clampVisibleCount(target.territory.visible_count, target.total);
      setLocalCount(territoryId, clampedCount);

      if (
        clampedCount === persistedCount &&
        !activeRequestsRef.current.has(territoryId)
      ) {
        const timer = timersRef.current.get(territoryId);
        if (timer !== undefined) {
          window.clearTimeout(timer);
          timersRef.current.delete(territoryId);
        }
        replaceSave(territoryId, null);
        return;
      }

      replaceSave(territoryId, {
        persistedCount,
        requestedCount: clampedCount,
        status: 'dirty',
      });
      scheduleSave(territoryId);
    },
    [replaceSave, scheduleSave, setLocalCount],
  );

  const retrySave = useCallback(
    (territoryId: string) => {
      const save = savesRef.current[territoryId];

      if (!save || save.status !== 'error') {
        return;
      }

      replaceSave(territoryId, { ...save, status: 'dirty' });
      scheduleSave(territoryId, 0);
    },
    [replaceSave, scheduleSave],
  );

  const revertSave = useCallback(
    (territoryId: string) => {
      const save = savesRef.current[territoryId];

      if (!save) {
        return;
      }

      const timer = timersRef.current.get(territoryId);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timersRef.current.delete(territoryId);
      }
      setLocalCount(territoryId, save.persistedCount);
      replaceSave(territoryId, null);
    },
    [replaceSave, setLocalCount],
  );

  return useMemo(
    () => ({
      changeVisibleCount,
      localCounts,
      retrySave,
      revertSave,
      saves,
    }),
    [changeVisibleCount, localCounts, retrySave, revertSave, saves],
  );
}

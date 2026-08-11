import { useCallback, useEffect, useRef, useState } from 'react';
import type { Territory, TerritoryPositionUpdate } from '../api';
import { isTerritoryResponse } from '../api';
import type {
  TerritoryPositionsUpdateRequest,
  TerritoryPositionUpdateRequest,
} from './canvasTypes';

export interface TerritoryPosition {
  x: number;
  y: number;
}

export interface TerritoryPositionSave {
  attempt: number;
  persistedPosition: TerritoryPosition;
  requestedPosition: TerritoryPosition;
  status: 'saving' | 'error';
}

export interface CompactTerritoryLayoutSave {
  attempt: number;
  persistedPositions: TerritoryPositionUpdate[];
  requestedPositions: TerritoryPositionUpdate[];
  status: 'saving' | 'error';
}

interface UseTerritoryLayoutPersistenceOptions {
  onCompactLayoutPersisted?: (movedTerritoryCount: number) => void;
  onPositionPersisted?: (territoryId: string) => void;
  projectId: string;
  requestPositionUpdate: TerritoryPositionUpdateRequest;
  requestPositionsUpdate: TerritoryPositionsUpdateRequest;
}

export function useTerritoryLayoutPersistence({
  onCompactLayoutPersisted,
  onPositionPersisted,
  projectId,
  requestPositionUpdate,
  requestPositionsUpdate,
}: UseTerritoryLayoutPersistenceOptions) {
  const [localPositions, setLocalPositionsState] = useState<
    Record<string, TerritoryPosition>
  >({});
  const [positionSaves, setPositionSaves] = useState<
    Record<string, TerritoryPositionSave>
  >({});
  const [compactLayoutSave, setCompactLayoutSave] =
    useState<CompactTerritoryLayoutSave | null>(null);
  const localPositionsRef = useRef(localPositions);
  const positionSavesRef = useRef(positionSaves);
  const compactLayoutSaveRef = useRef(compactLayoutSave);
  const positionSaveAttemptRef = useRef(0);
  const compactSaveAttemptRef = useRef(0);
  const mountedRef = useRef(true);
  const onCompactLayoutPersistedRef = useRef(onCompactLayoutPersisted);
  const onPositionPersistedRef = useRef(onPositionPersisted);

  useEffect(() => {
    onCompactLayoutPersistedRef.current = onCompactLayoutPersisted;
  }, [onCompactLayoutPersisted]);

  useEffect(() => {
    onPositionPersistedRef.current = onPositionPersisted;
  }, [onPositionPersisted]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const replacePositionSave = useCallback(
    (territoryId: string, save: TerritoryPositionSave | null) => {
      const next = { ...positionSavesRef.current };

      if (save) {
        next[territoryId] = save;
      } else {
        delete next[territoryId];
      }

      positionSavesRef.current = next;
      setPositionSaves(next);
    },
    [],
  );

  const replaceCompactLayoutSave = useCallback(
    (save: CompactTerritoryLayoutSave | null) => {
      compactLayoutSaveRef.current = save;
      setCompactLayoutSave(save);
    },
    [],
  );

  const setLocalPosition = useCallback(
    (territoryId: string, position: TerritoryPosition) => {
      const next = {
        ...localPositionsRef.current,
        [territoryId]: position,
      };
      localPositionsRef.current = next;
      setLocalPositionsState(next);
    },
    [],
  );

  const setLocalPositions = useCallback(
    (positions: readonly TerritoryPositionUpdate[]) => {
      const next = { ...localPositionsRef.current };

      for (const position of positions) {
        next[position.territory_id] = {
          x: position.position_x,
          y: position.position_y,
        };
      }

      localPositionsRef.current = next;
      setLocalPositionsState(next);
    },
    [],
  );

  const persistPosition = useCallback(
    async (
      territoryId: string,
      requestedPosition: TerritoryPosition,
      persistedPosition: TerritoryPosition,
    ) => {
      const attempt = ++positionSaveAttemptRef.current;
      replacePositionSave(territoryId, {
        attempt,
        persistedPosition,
        requestedPosition,
        status: 'saving',
      });

      try {
        const updated = await requestPositionUpdate(projectId, territoryId, {
          position_x: requestedPosition.x,
          position_y: requestedPosition.y,
        });

        if (
          !isTerritoryResponse(updated, projectId) ||
          updated.id !== territoryId
        ) {
          throw new Error('The saved territory position response was invalid.');
        }

        if (
          !mountedRef.current ||
          positionSavesRef.current[territoryId]?.attempt !== attempt
        ) {
          return;
        }

        setLocalPosition(territoryId, {
          x: updated.position_x,
          y: updated.position_y,
        });
        replacePositionSave(territoryId, null);
        onPositionPersistedRef.current?.(territoryId);
      } catch {
        if (
          mountedRef.current &&
          positionSavesRef.current[territoryId]?.attempt === attempt
        ) {
          replacePositionSave(territoryId, {
            attempt,
            persistedPosition,
            requestedPosition,
            status: 'error',
          });
        }
      }
    },
    [projectId, replacePositionSave, requestPositionUpdate, setLocalPosition],
  );

  const persistCompactLayout = useCallback(
    async (
      requestedPositions: TerritoryPositionUpdate[],
      persistedPositions: TerritoryPositionUpdate[],
    ) => {
      const attempt = ++compactSaveAttemptRef.current;
      const saving: CompactTerritoryLayoutSave = {
        attempt,
        persistedPositions,
        requestedPositions,
        status: 'saving',
      };

      setLocalPositions(requestedPositions);
      replaceCompactLayoutSave(saving);

      try {
        const updated = await requestPositionsUpdate(projectId, {
          positions: requestedPositions,
        });
        const expectedById = new Map(
          requestedPositions.map((position) => [
            position.territory_id,
            position,
          ]),
        );
        const seenIds = new Set<string>();

        if (
          updated.length !== requestedPositions.length ||
          updated.some((territory: Territory) => {
            const expected = expectedById.get(territory.id);
            const invalid =
              !isTerritoryResponse(territory, projectId) ||
              !expected ||
              seenIds.has(territory.id) ||
              territory.position_x !== expected.position_x ||
              territory.position_y !== expected.position_y;
            seenIds.add(territory.id);
            return invalid;
          })
        ) {
          throw new Error(
            'The saved compact territory layout response was invalid.',
          );
        }

        if (
          !mountedRef.current ||
          compactLayoutSaveRef.current?.attempt !== attempt
        ) {
          return;
        }

        setLocalPositions(
          updated.map((territory) => ({
            territory_id: territory.id,
            position_x: territory.position_x,
            position_y: territory.position_y,
          })),
        );
        replaceCompactLayoutSave(null);
        onCompactLayoutPersistedRef.current?.(requestedPositions.length);
      } catch {
        if (
          mountedRef.current &&
          compactLayoutSaveRef.current?.attempt === attempt
        ) {
          setLocalPositions(persistedPositions);
          replaceCompactLayoutSave({ ...saving, status: 'error' });
        }
      }
    },
    [
      projectId,
      replaceCompactLayoutSave,
      requestPositionsUpdate,
      setLocalPositions,
    ],
  );

  return {
    compactLayoutSave,
    localPositions,
    persistCompactLayout,
    persistPosition,
    positionSaves,
    positionSavesRef,
    replaceCompactLayoutSave,
    replacePositionSave,
    setLocalPosition,
  };
}

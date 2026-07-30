import type {
  Bubble,
  Project,
  UpdateProjectViewportInput,
} from '../api';
import { isBubbleResponse } from '../api';
import type { CanvasViewport } from './canvasTypes';

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
export const ZOOM_STEP = 1.2;
export const GRID_SIZE = 24;
export const DEFAULT_VIEWPORT_SAVE_DELAY_MS = 500;
export const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, zoom: 1 };

export function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function isSameViewport(
  first: CanvasViewport,
  second: CanvasViewport,
) {
  return first.x === second.x && first.y === second.y && first.zoom === second.zoom;
}

export function projectViewport(project: Project): CanvasViewport {
  return {
    x: project.canvas_viewport_x,
    y: project.canvas_viewport_y,
    zoom: project.canvas_zoom,
  };
}

export function viewportInput(
  viewport: CanvasViewport,
): UpdateProjectViewportInput {
  return {
    canvas_viewport_x: viewport.x,
    canvas_viewport_y: viewport.y,
    canvas_zoom: viewport.zoom,
  };
}

export function normalizeWheelDelta(
  delta: number,
  deltaMode: number,
  pageSize: number,
) {
  if (deltaMode === 1) {
    return delta * 16;
  }

  if (deltaMode === 2) {
    return delta * pageSize;
  }

  return delta;
}

export function isRenderableBubble(
  value: unknown,
  projectId: string,
): value is Bubble {
  return isBubbleResponse(value, projectId);
}

export function renderableBubbles(records: unknown, projectId: string) {
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

export function mergeBubbles(current: Bubble[], incoming: Bubble[]) {
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

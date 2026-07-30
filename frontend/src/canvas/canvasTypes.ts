import type { ReactNode } from 'react';
import type {
  BatchUpdateBubblePositionsInput,
  Bubble,
  BubbleLink,
  BubblePlacementInput,
  BubblePositionUpdate,
  Project,
  ProjectViewportUpdateOptions,
  UpdateBubblePositionInput,
  UpdateProjectViewportInput,
} from '../api';
import type { AnalyticsClient } from '../analytics';
import type {
  BubbleCreateRequest,
  BubblePlacementRequest,
} from '../bubbles/CreateBubbleDialog';

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

export type BubblePositionsUpdateRequest = (
  projectId: string,
  input: BatchUpdateBubblePositionsInput,
) => Promise<Bubble[]>;

export interface CanvasEmptyStateActions {
  onCreateBubble: () => void;
}

export interface CanvasMultiSelectionResult {
  projectId: string;
  bubbleIds: readonly string[];
  bubbles: readonly Bubble[];
}

/**
 * A feature owns the lifetime of this controlled selection flow. It should
 * stop supplying the value after either callback completes.
 */
export interface CanvasMultiSelection {
  /** Allows confirmation with no bubbles, so an owner can clear prior choices. */
  allowEmptySelection?: boolean;
  confirmLabel?: string;
  initialBubbleIds?: readonly string[];
  instruction?: string;
  /** Constrains controlled selection without changing normal canvas selection. */
  maximumSelectionCount?: number;
  onCancel: () => void;
  onConfirm: (selection: CanvasMultiSelectionResult) => void;
}

export interface CanvasSurfaceProps {
  bubbleCollection?: ProjectBubbleCollection;
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
  requestBubblePositionsUpdate?: BubblePositionsUpdateRequest;
  requestViewportUpdate?: ProjectViewportUpdateRequest;
  onBubbleSelectionChange?: (bubble: Bubble | null) => void;
  onStartDiscussion?: () => void;
  bubbleLinks?: BubbleLink[];
  multiSelection?: CanvasMultiSelection | null;
  viewportSaveDelayMs?: number;
}

export type CanvasLoadState =
  | { status: 'loading'; bubbles: Bubble[] }
  | { status: 'ready'; bubbles: Bubble[] }
  | { status: 'partial'; bubbles: Bubble[] }
  | { status: 'failed'; bubbles: Bubble[] };

export interface ProjectBubbleCollection {
  projectId: string;
  loadState: CanvasLoadState;
  addBubble: (bubble: Bubble) => void;
  isBubbleRemoved: (bubbleId: string) => boolean;
  /**
   * Replaces persisted bubble data while retaining the collection's current
   * canvas position. Content saves must not overwrite a newer spatial save.
   */
  replaceBubble: (bubble: Bubble) => void;
  removeBubble: (bubbleId: string) => void;
  retry: () => void;
  updateBubblePositions: (
    positions: readonly BubblePositionUpdate[],
  ) => void;
}

export interface ActivePan {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startViewportX: number;
  startViewportY: number;
}

export interface BubblePosition {
  x: number;
  y: number;
}

export interface ActiveBubbleDrag {
  bubbleId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPosition: BubblePosition;
  currentPosition: BubblePosition;
  persistedPosition: BubblePosition;
  zoom: number;
}

export interface BubblePositionSave {
  attempt: number;
  persistedPosition: BubblePosition;
  requestedPosition: BubblePosition;
  status: 'saving' | 'error';
}

export interface CompactLayoutSave {
  attempt: number;
  persistedPositions: BubblePositionUpdate[];
  requestedPositions: BubblePositionUpdate[];
  status: 'saving' | 'error';
}

export type { BubblePlacementInput };

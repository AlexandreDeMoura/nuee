import type { ReactNode } from 'react';
import type {
  Bubble,
  BubbleLink,
  BatchRepositionTerritoriesInput,
  BatchRepositionTerritoriesResponse,
  Project,
  ProjectViewportUpdateOptions,
  Territory,
  RepositionTerritoryInput,
  UpdateTerritoryVisibleCountInput,
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

export type TerritoryListRequest = (
  projectId: string,
  signal?: AbortSignal,
) => Promise<Territory[]>;

export type TerritoryPositionUpdateRequest = (
  projectId: string,
  territoryId: string,
  input: RepositionTerritoryInput,
) => Promise<Territory>;

export type TerritoryPositionsUpdateRequest = (
  projectId: string,
  input: BatchRepositionTerritoriesInput,
) => Promise<BatchRepositionTerritoriesResponse>;

export type TerritoryVisibleCountUpdateRequest = (
  projectId: string,
  territoryId: string,
  input: UpdateTerritoryVisibleCountInput,
) => Promise<Territory>;

export type CanvasSaveStatus = 'dirty' | 'saving' | 'saved' | 'error';

export type ProjectViewportUpdateRequest = (
  projectId: string,
  input: UpdateProjectViewportInput,
  options?: ProjectViewportUpdateOptions,
) => Promise<Project>;

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
  createBubbleDialogOpen?: boolean;
  emptyState:
    | ReactNode
    | ((actions: CanvasEmptyStateActions) => ReactNode);
  initialViewport?: CanvasViewport;
  projectId: string;
  analyticsClient?: AnalyticsClient;
  requestBubbleCreate?: BubbleCreateRequest;
  requestBubbles?: BubbleListRequest;
  requestBubblePlacement?: BubblePlacementRequest;
  requestTerritories?: TerritoryListRequest;
  requestTerritoryPositionUpdate?: TerritoryPositionUpdateRequest;
  requestTerritoryPositionsUpdate?: TerritoryPositionsUpdateRequest;
  requestTerritoryVisibleCountUpdate?: TerritoryVisibleCountUpdateRequest;
  requestViewportUpdate?: ProjectViewportUpdateRequest;
  onBubbleSelectionChange?: (bubble: Bubble | null) => void;
  onCreateBubbleDialogOpenChange?: (open: boolean) => void;
  onSaveStatusChange?: (status: CanvasSaveStatus) => void;
  onStartDiscussion?: () => void;
  bubbleLinks?: BubbleLink[];
  multiSelection?: CanvasMultiSelection | null;
  viewportSaveDelayMs?: number;
  visibleCountSaveDelayMs?: number;
}

export type CanvasLoadState =
  | { status: 'loading'; bubbles: Bubble[]; territories: Territory[] }
  | { status: 'ready'; bubbles: Bubble[]; territories: Territory[] }
  | { status: 'partial'; bubbles: Bubble[]; territories: Territory[] }
  | { status: 'failed'; bubbles: Bubble[]; territories: Territory[] };

export interface ProjectBubbleCollection {
  projectId: string;
  loadState: CanvasLoadState;
  addBubble: (bubble: Bubble) => void;
  isBubbleRemoved: (bubbleId: string) => boolean;
  replaceBubble: (bubble: Bubble) => void;
  removeBubble: (bubbleId: string) => void;
  retry: () => void;
}

export interface ActivePan {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startViewportX: number;
  startViewportY: number;
}

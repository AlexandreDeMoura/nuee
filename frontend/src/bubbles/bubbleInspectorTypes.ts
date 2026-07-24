import type {
  Bubble,
  BubbleLink,
  CreateBubbleLinkInput,
  UpdateBubbleInput,
} from '../api';
import type { AnalyticsClient } from '../analytics';

export type BubbleUpdateRequest = (
  projectId: string,
  bubbleId: string,
  input: UpdateBubbleInput,
  signal?: AbortSignal,
) => Promise<Bubble>;

export type BubbleLinkCreateRequest = (
  projectId: string,
  input: CreateBubbleLinkInput,
) => Promise<BubbleLink>;

export type BubbleLinkDeleteRequest = (
  projectId: string,
  firstBubbleId: string,
  secondBubbleId: string,
) => Promise<void>;

export type BubbleDeleteRequest = (
  projectId: string,
  bubbleId: string,
  signal?: AbortSignal,
) => Promise<void>;

export type BubbleLinkLoadStatus = 'loading' | 'ready' | 'error';

export type BubbleInspectorSaveStatus =
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'error';

export interface BubbleInspectorProps {
  bubble: Bubble;
  availableBubbles?: Bubble[];
  bubbleLinks?: BubbleLink[];
  linkLoadStatus?: BubbleLinkLoadStatus;
  onBubbleDeleted?: (bubble: Bubble) => void;
  onBubbleUpdated: (bubble: Bubble) => void;
  onBubbleLinkCreated?: (link: BubbleLink) => void;
  onBubbleLinkRemoved?: (link: BubbleLink) => void;
  onRetryBubbleLinks?: () => void;
  requestCreateLink?: BubbleLinkCreateRequest;
  requestDelete?: BubbleDeleteRequest;
  requestDeleteLink?: BubbleLinkDeleteRequest;
  requestUpdate?: BubbleUpdateRequest;
  saveDelayMs?: number;
  analyticsClient?: AnalyticsClient;
}

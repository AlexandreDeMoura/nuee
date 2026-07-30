import type { Bubble } from '../api';

/**
 * Knowledge Extraction owns the target-selection lifetime while Workspace
 * adapts this request to the canvas' controlled selection surface.
 */
export interface KnowledgeExtractionTargetSelectionRequest {
  initialBubbleId: string | null;
  onCancel: () => void;
  onConfirm: (bubble: Bubble) => void;
  projectId: string;
}

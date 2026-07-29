export type DocumentProcessingStatus = 'pending' | 'ready' | 'failed';

/**
 * Metadata exposed by Document Library for discussion-context selection.
 * Processed document bodies stay behind the server-side context-source reader.
 */
export interface DocumentContextSource {
  id: string;
  project_id: string;
  title: string;
  processing_status: DocumentProcessingStatus;
}

export interface DocumentMultiSelectionResult {
  projectId: string;
  documentIds: readonly string[];
  documents: readonly DocumentContextSource[];
}

/**
 * A feature owns the lifetime of this controlled selection flow. It should
 * stop supplying the value after either callback completes.
 */
export interface DocumentMultiSelection {
  /** Allows confirmation with no documents, so an owner can clear prior choices. */
  allowEmptySelection?: boolean;
  confirmLabel?: string;
  initialDocumentIds?: readonly string[];
  instruction?: string;
  onCancel: () => void;
  onConfirm: (selection: DocumentMultiSelectionResult) => void;
}

export interface DocumentMultiSelectionController {
  allowEmptySelection: boolean;
  cancel: () => void;
  confirm: () => void;
  confirmLabel: string;
  documents: readonly DocumentContextSource[];
  instruction: string;
  isActive: boolean;
  selectedDocumentIdSet: ReadonlySet<string>;
  selectedDocumentIds: readonly string[];
  toggle: (documentId: string) => void;
}

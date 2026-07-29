import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  DocumentContextSource,
  DocumentMultiSelection,
  DocumentMultiSelectionController,
  DocumentProcessingStatus,
} from './documentContextSelectionTypes';

interface UseDocumentMultiSelectionOptions {
  documents: readonly DocumentContextSource[];
  multiSelection: DocumentMultiSelection | null;
  projectId: string;
}

function isProcessingStatus(
  value: unknown,
): value is DocumentProcessingStatus {
  return value === 'pending' || value === 'ready' || value === 'failed';
}

function normalizeDocuments(
  projectId: string,
  documents: readonly DocumentContextSource[],
): DocumentContextSource[] {
  const normalized: DocumentContextSource[] = [];
  const indicesById = new Map<string, number>();

  for (const document of documents) {
    const id = typeof document.id === 'string' ? document.id.trim() : '';
    const title =
      typeof document.title === 'string' ? document.title.trim() : '';

    if (
      document.project_id !== projectId ||
      id.length === 0 ||
      title.length === 0 ||
      !isProcessingStatus(document.processing_status)
    ) {
      continue;
    }

    const source = {
      id,
      project_id: projectId,
      processing_status: document.processing_status,
      title,
    };
    const existingIndex = indicesById.get(id);

    if (existingIndex === undefined) {
      indicesById.set(id, normalized.length);
      normalized.push(source);
    } else {
      normalized[existingIndex] = source;
    }
  }

  return normalized;
}

function normalizeInitialIds(ids: readonly string[] | undefined): string[] {
  if (!ids) {
    return [];
  }

  return [
    ...new Set(
      ids.map((id) => id.trim()).filter((id) => id.length > 0),
    ),
  ];
}

/**
 * Keeps tentative whole-document choices outside the Documents panel so they
 * survive panel switches. Only current, ready, same-project records can be
 * toggled or confirmed.
 */
export function useDocumentMultiSelection({
  documents,
  multiSelection,
  projectId,
}: UseDocumentMultiSelectionOptions): DocumentMultiSelectionController {
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const wasActiveRef = useRef(false);
  const outcomeCompletedRef = useRef(false);
  const normalizedDocuments = useMemo(
    () => normalizeDocuments(projectId, documents),
    [documents, projectId],
  );
  const documentsById = useMemo(
    () =>
      new Map(
        normalizedDocuments.map((document) => [document.id, document]),
      ),
    [normalizedDocuments],
  );
  const readyDocumentIds = useMemo(
    () =>
      new Set(
        normalizedDocuments
          .filter(({ processing_status }) => processing_status === 'ready')
          .map(({ id }) => id),
      ),
    [normalizedDocuments],
  );
  const activeSelectedDocumentIds = useMemo(
    () =>
      selectedDocumentIds.filter((documentId) =>
        readyDocumentIds.has(documentId),
      ),
    [readyDocumentIds, selectedDocumentIds],
  );
  const selectedDocumentIdSet = useMemo(
    () => new Set(activeSelectedDocumentIds),
    [activeSelectedDocumentIds],
  );

  const cancel = useCallback(() => {
    if (!multiSelection || outcomeCompletedRef.current) {
      return;
    }

    outcomeCompletedRef.current = true;
    multiSelection.onCancel();
  }, [multiSelection]);

  const confirm = useCallback(() => {
    if (!multiSelection || outcomeCompletedRef.current) {
      return;
    }

    const selectedDocuments = activeSelectedDocumentIds.flatMap(
      (documentId) => {
        const document = documentsById.get(documentId);
        return document ? [document] : [];
      },
    );

    if (
      !multiSelection.allowEmptySelection &&
      selectedDocuments.length === 0
    ) {
      return;
    }

    outcomeCompletedRef.current = true;
    multiSelection.onConfirm({
      documentIds: selectedDocuments.map(({ id }) => id),
      documents: selectedDocuments,
      projectId,
    });
  }, [
    activeSelectedDocumentIds,
    documentsById,
    multiSelection,
    projectId,
  ]);

  const toggle = useCallback(
    (documentId: string) => {
      if (!multiSelection || !readyDocumentIds.has(documentId)) {
        return;
      }

      setSelectedDocumentIds((current) =>
        current.includes(documentId)
          ? current.filter((id) => id !== documentId)
          : [...current, documentId],
      );
    },
    [multiSelection, readyDocumentIds],
  );

  useEffect(() => {
    const wasActive = wasActiveRef.current;

    if (multiSelection && !wasActive) {
      setSelectedDocumentIds(
        normalizeInitialIds(multiSelection.initialDocumentIds),
      );
      outcomeCompletedRef.current = false;
    } else if (!multiSelection && wasActive) {
      setSelectedDocumentIds([]);
      outcomeCompletedRef.current = false;
    }

    wasActiveRef.current = multiSelection !== null;
  }, [multiSelection]);

  useEffect(() => {
    if (!multiSelection) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      cancel();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cancel, multiSelection]);

  return {
    allowEmptySelection: multiSelection?.allowEmptySelection ?? false,
    cancel,
    confirm,
    confirmLabel: multiSelection?.confirmLabel ?? 'Use selected documents',
    documents: normalizedDocuments,
    instruction:
      multiSelection?.instruction ?? 'Choose documents for this discussion',
    isActive: multiSelection !== null,
    selectedDocumentIdSet,
    selectedDocumentIds: activeSelectedDocumentIds,
    toggle,
  };
}

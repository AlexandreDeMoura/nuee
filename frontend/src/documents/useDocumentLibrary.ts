import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  assertDocumentListResponse,
  assertDocumentSummaryResponse,
  assertDocumentUploadPolicyResponse,
  getDocumentUploadPolicy,
  getProjectDocuments,
  retryDocumentProcessing as requestDocumentProcessingRetry,
  uploadDocument as requestDocumentUpload,
  type DocumentSummary,
  type DocumentUploadPolicy,
  type UploadDocumentInput,
} from '../api';
import { preflightDocumentUpload } from './documentUploadPreflight';

export type DocumentListRequest = typeof getProjectDocuments;
export type DocumentPolicyRequest = typeof getDocumentUploadPolicy;
export type DocumentProcessingRetryRequest =
  typeof requestDocumentProcessingRetry;
export type DocumentUploadRequest = typeof requestDocumentUpload;

export interface DocumentLibraryRequests {
  list?: DocumentListRequest;
  policy?: DocumentPolicyRequest;
  retryProcessing?: DocumentProcessingRetryRequest;
  upload?: DocumentUploadRequest;
}

export type DocumentLibraryLoadStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error';

export interface DocumentTransferRow {
  error: string | null;
  id: string;
  original_filename: string;
  size_bytes: number;
  status: 'transferring' | 'failed';
}

export interface DocumentLibraryController {
  clearProcessingError: (documentId: string) => void;
  dismissTransfer: (transferId: string) => void;
  documents: readonly DocumentSummary[];
  error: string | null;
  policy: DocumentUploadPolicy | null;
  policyError: string | null;
  policyStatus: DocumentLibraryLoadStatus;
  processingErrors: Readonly<Record<string, string>>;
  refresh: () => void;
  refreshPolicy: () => void;
  retryProcessing: (documentId: string) => Promise<boolean>;
  retryTransfer: (transferId: string) => void;
  retryingDocumentIds: ReadonlySet<string>;
  status: DocumentLibraryLoadStatus;
  transfers: readonly DocumentTransferRow[];
  uploadFile: (file: File) => string;
}

export interface UseDocumentLibraryOptions {
  createUploadId?: () => string;
  enabled?: boolean;
  pollIntervalMs?: number;
  projectId: string;
  requests?: DocumentLibraryRequests;
}

interface DocumentStore {
  documents: DocumentSummary[];
  error: string | null;
  projectId: string;
  status: DocumentLibraryLoadStatus;
}

interface PolicyStore {
  error: string | null;
  policy: DocumentUploadPolicy | null;
  status: DocumentLibraryLoadStatus;
}

interface TransferRecord extends DocumentTransferRow {
  file: File;
  idempotencyKey: string;
  operation: number;
  projectId: string;
}

interface TransferStore {
  projectId: string;
  records: TransferRecord[];
}

interface ProcessingRetryStore {
  errors: Record<string, string>;
  projectId: string;
  retryingIds: string[];
}

type ListRequestMode = 'initial' | 'poll' | 'refresh';

function defaultCreateUploadId(): string {
  return globalThis.crypto.randomUUID();
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback;
}

function compareDocuments(first: DocumentSummary, second: DocumentSummary) {
  const createdAtDifference =
    Date.parse(second.created_at) - Date.parse(first.created_at);

  return createdAtDifference || first.id.localeCompare(second.id);
}

function mergeDocuments(
  ...collections: readonly (readonly DocumentSummary[])[]
): DocumentSummary[] {
  const byId = new Map<string, DocumentSummary>();

  for (const collection of collections) {
    for (const document of collection) {
      byId.set(document.id, document);
    }
  }

  return [...byId.values()].sort(compareDocuments);
}

function publicTransfer(record: TransferRecord): DocumentTransferRow {
  return {
    error: record.error,
    id: record.id,
    original_filename: record.original_filename,
    size_bytes: record.size_bytes,
    status: record.status,
  };
}

export function useDocumentLibrary({
  createUploadId = defaultCreateUploadId,
  enabled = true,
  pollIntervalMs = 2_000,
  projectId,
  requests,
}: UseDocumentLibraryOptions): DocumentLibraryController {
  const listRequest = requests?.list ?? getProjectDocuments;
  const policyRequest = requests?.policy ?? getDocumentUploadPolicy;
  const processingRetryRequest =
    requests?.retryProcessing ?? requestDocumentProcessingRetry;
  const uploadRequest = requests?.upload ?? requestDocumentUpload;
  const [store, setStore] = useState<DocumentStore>({
    documents: [],
    error: null,
    projectId,
    status: enabled ? 'loading' : 'idle',
  });
  const [policyStore, setPolicyStore] = useState<PolicyStore>({
    error: null,
    policy: null,
    status: enabled ? 'loading' : 'idle',
  });
  const [transferStore, setTransferStore] = useState<TransferStore>({
    projectId,
    records: [],
  });
  const [processingRetryStore, setProcessingRetryStore] =
    useState<ProcessingRetryStore>({
      errors: {},
      projectId,
      retryingIds: [],
    });
  const [listRequestKey, setListRequestKey] = useState(0);
  const [listSettledKey, setListSettledKey] = useState(0);
  const [policyRequestKey, setPolicyRequestKey] = useState(0);
  const activeProjectIdRef = useRef<string | null>(
    enabled ? projectId : null,
  );
  const loadedProjectIdRef = useRef(projectId);
  const documentsRef = useRef<DocumentSummary[]>([]);
  const mutationRevisionRef = useRef(0);
  const listOperationRef = useRef(0);
  const listRequestModeRef = useRef<ListRequestMode>('initial');
  const policyOperationRef = useRef(0);
  const transferRecordsRef = useRef<TransferRecord[]>([]);
  const uploadControllersRef = useRef(new Map<string, AbortController>());
  const processingRetryControllersRef = useRef(
    new Map<string, AbortController>(),
  );
  const uploadSequenceRef = useRef(0);

  activeProjectIdRef.current = enabled ? projectId : null;

  const currentStore =
    enabled && store.projectId === projectId
      ? store
      : {
          documents: [],
          error: null,
          projectId,
          status: enabled ? ('loading' as const) : ('idle' as const),
        };
  const currentProcessingRetryStore =
    processingRetryStore.projectId === projectId
      ? processingRetryStore
      : { errors: {}, projectId, retryingIds: [] };

  const commitTransferRecords = useCallback(
    (
      boundProjectId: string,
      update: (records: readonly TransferRecord[]) => TransferRecord[],
    ) => {
      if (activeProjectIdRef.current !== boundProjectId) {
        return;
      }

      const records = update(transferRecordsRef.current);
      transferRecordsRef.current = records;
      setTransferStore({ projectId: boundProjectId, records });
    },
    [],
  );

  const commitDocument = useCallback(
    (boundProjectId: string, document: DocumentSummary) => {
      if (activeProjectIdRef.current !== boundProjectId) {
        return;
      }

      mutationRevisionRef.current += 1;
      const documents = mergeDocuments(documentsRef.current, [document]);
      documentsRef.current = documents;
      setStore((current) => ({
        documents,
        error: current.projectId === boundProjectId ? current.error : null,
        projectId: boundProjectId,
        status:
          current.projectId === boundProjectId &&
          current.status === 'loading'
            ? 'loading'
            : 'ready',
      }));
    },
    [],
  );

  useEffect(() => {
    const isNewProject = loadedProjectIdRef.current !== projectId;

    if (isNewProject) {
      loadedProjectIdRef.current = projectId;
      documentsRef.current = [];
      mutationRevisionRef.current = 0;
    }

    if (!enabled) {
      return;
    }

    const controller = new AbortController();
    const operation = ++listOperationRef.current;
    const mutationRevision = mutationRevisionRef.current;
    const mode = isNewProject ? 'initial' : listRequestModeRef.current;
    listRequestModeRef.current = 'initial';

    if (mode !== 'poll') {
      setStore((current) => ({
        documents:
          current.projectId === projectId ? current.documents : [],
        error: null,
        projectId,
        status: 'loading',
      }));
    }

    listRequest(projectId, controller.signal)
      .then((response) => {
        if (
          controller.signal.aborted ||
          operation !== listOperationRef.current ||
          activeProjectIdRef.current !== projectId
        ) {
          return;
        }

        const loaded = assertDocumentListResponse(response, projectId);
        const documents =
          mutationRevision === mutationRevisionRef.current
            ? [...loaded]
            : mergeDocuments(loaded, documentsRef.current);
        documentsRef.current = documents;
        setStore({
          documents,
          error: null,
          projectId,
          status: 'ready',
        });
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          operation !== listOperationRef.current ||
          activeProjectIdRef.current !== projectId ||
          isAbort(error)
        ) {
          return;
        }

        setStore((current) => ({
          documents:
            current.projectId === projectId ? current.documents : [],
          error: errorMessage(
            error,
            'The documents could not be loaded. Please retry.',
          ),
          projectId,
          status: 'error',
        }));
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          operation === listOperationRef.current &&
          activeProjectIdRef.current === projectId
        ) {
          setListSettledKey((key) => key + 1);
        }
      });

    return () => controller.abort();
  }, [enabled, listRequest, listRequestKey, projectId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const controller = new AbortController();
    const operation = ++policyOperationRef.current;

    setPolicyStore((current) => ({
      error: null,
      policy: current.policy,
      status: 'loading',
    }));

    policyRequest(controller.signal)
      .then((response) => {
        if (
          controller.signal.aborted ||
          operation !== policyOperationRef.current
        ) {
          return;
        }

        const policy = assertDocumentUploadPolicyResponse(response);
        setPolicyStore({ error: null, policy, status: 'ready' });
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          operation !== policyOperationRef.current ||
          isAbort(error)
        ) {
          return;
        }

        setPolicyStore((current) => ({
          error: errorMessage(
            error,
            'The document upload requirements could not be loaded.',
          ),
          policy: current.policy,
          status: 'error',
        }));
      });

    return () => controller.abort();
  }, [enabled, policyRequest, policyRequestKey]);

  useEffect(() => {
    const uploadControllers = uploadControllersRef.current;
    const processingRetryControllers =
      processingRetryControllersRef.current;

    uploadControllers.forEach((controller) => controller.abort());
    uploadControllers.clear();
    processingRetryControllers.forEach((controller) => controller.abort());
    processingRetryControllers.clear();
    transferRecordsRef.current = [];
    setTransferStore({ projectId, records: [] });
    setProcessingRetryStore({ errors: {}, projectId, retryingIds: [] });

    return () => {
      uploadControllers.forEach((controller) => controller.abort());
      processingRetryControllers.forEach((controller) => controller.abort());
    };
  }, [enabled, projectId]);

  useEffect(() => {
    if (
      !enabled ||
      currentStore.status === 'loading' ||
      !currentStore.documents.some(
        ({ processing_status }) => processing_status === 'processing',
      )
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      listRequestModeRef.current = 'poll';
      setListRequestKey((key) => key + 1);
    }, Math.max(0, pollIntervalMs));

    return () => window.clearTimeout(timeout);
  }, [
    currentStore.documents,
    currentStore.status,
    enabled,
    listSettledKey,
    pollIntervalMs,
  ]);

  const refresh = useCallback(() => {
    if (!enabled) {
      return;
    }

    listRequestModeRef.current = 'refresh';
    setListRequestKey((key) => key + 1);
  }, [enabled]);

  const refreshPolicy = useCallback(() => {
    if (enabled) {
      setPolicyRequestKey((key) => key + 1);
    }
  }, [enabled]);

  const runTransfer = useCallback(
    async (initialRecord: TransferRecord) => {
      const boundProjectId = initialRecord.projectId;
      const operation = initialRecord.operation;
      const policy = policyStore.policy;

      if (!policy) {
        commitTransferRecords(boundProjectId, (records) =>
          records.map((record) =>
            record.id === initialRecord.id && record.operation === operation
              ? {
                  ...record,
                  error:
                    'Document upload requirements are unavailable. Load them and retry.',
                  status: 'failed',
                }
              : record,
          ),
        );
        return;
      }

      const preflight = await preflightDocumentUpload(
        initialRecord.file,
        policy,
      );
      const currentRecord = transferRecordsRef.current.find(
        ({ id }) => id === initialRecord.id,
      );

      if (
        activeProjectIdRef.current !== boundProjectId ||
        currentRecord?.operation !== operation
      ) {
        return;
      }

      if (!preflight.ok) {
        commitTransferRecords(boundProjectId, (records) =>
          records.map((record) =>
            record.id === initialRecord.id && record.operation === operation
              ? {
                  ...record,
                  error: preflight.error.message,
                  status: 'failed',
                }
              : record,
          ),
        );
        return;
      }

      const controller = new AbortController();
      uploadControllersRef.current.get(initialRecord.id)?.abort();
      uploadControllersRef.current.set(initialRecord.id, controller);

      try {
        const input: UploadDocumentInput = {
          file: initialRecord.file,
          idempotency_key: initialRecord.idempotencyKey,
        };
        const response = await uploadRequest(
          boundProjectId,
          input,
          controller.signal,
        );

        if (
          controller.signal.aborted ||
          activeProjectIdRef.current !== boundProjectId ||
          transferRecordsRef.current.find(
            ({ id }) => id === initialRecord.id,
          )?.operation !== operation
        ) {
          return;
        }

        const document = assertDocumentSummaryResponse(
          response,
          boundProjectId,
        );
        commitDocument(boundProjectId, document);
        commitTransferRecords(boundProjectId, (records) =>
          records.filter(({ id }) => id !== initialRecord.id),
        );
      } catch (error) {
        if (
          controller.signal.aborted ||
          activeProjectIdRef.current !== boundProjectId ||
          isAbort(error)
        ) {
          return;
        }

        commitTransferRecords(boundProjectId, (records) =>
          records.map((record) =>
            record.id === initialRecord.id && record.operation === operation
              ? {
                  ...record,
                  error: errorMessage(
                    error,
                    'The document could not be uploaded. Please retry.',
                  ),
                  status: 'failed',
                }
              : record,
          ),
        );
      } finally {
        if (
          uploadControllersRef.current.get(initialRecord.id) === controller
        ) {
          uploadControllersRef.current.delete(initialRecord.id);
        }
      }
    },
    [
      commitDocument,
      commitTransferRecords,
      policyStore.policy,
      uploadRequest,
    ],
  );

  const uploadFile = useCallback(
    (file: File): string => {
      const id = createUploadId();
      const sequence = ++uploadSequenceRef.current;
      const record: TransferRecord = {
        error: null,
        file,
        id: `${id}:${sequence}`,
        idempotencyKey: `document-upload:${id}:${sequence}`,
        operation: 1,
        original_filename: file.name,
        projectId,
        size_bytes: file.size,
        status: 'transferring',
      };

      commitTransferRecords(projectId, (records) => [...records, record]);
      void runTransfer(record);
      return record.id;
    },
    [commitTransferRecords, createUploadId, projectId, runTransfer],
  );

  const retryTransfer = useCallback(
    (transferId: string) => {
      const existing = transferRecordsRef.current.find(
        ({ id, projectId: recordProjectId }) =>
          id === transferId && recordProjectId === projectId,
      );

      if (!existing || existing.status !== 'failed') {
        return;
      }

      const retry = {
        ...existing,
        error: null,
        operation: existing.operation + 1,
        status: 'transferring' as const,
      };
      commitTransferRecords(projectId, (records) =>
        records.map((record) => (record.id === transferId ? retry : record)),
      );
      void runTransfer(retry);
    },
    [commitTransferRecords, projectId, runTransfer],
  );

  const dismissTransfer = useCallback(
    (transferId: string) => {
      const transfer = transferRecordsRef.current.find(
        ({ id }) => id === transferId,
      );

      if (!transfer || transfer.status === 'transferring') {
        return;
      }

      uploadControllersRef.current.get(transferId)?.abort();
      commitTransferRecords(projectId, (records) =>
        records.filter(({ id }) => id !== transferId),
      );
    },
    [commitTransferRecords, projectId],
  );

  const retryProcessing = useCallback(
    async (documentId: string): Promise<boolean> => {
      const document = documentsRef.current.find(
        ({ id }) => id === documentId,
      );

      if (
        !enabled ||
        !document ||
        document.project_id !== projectId ||
        document.processing_status !== 'failed' ||
        !document.can_retry
      ) {
        return false;
      }

      processingRetryControllersRef.current.get(documentId)?.abort();
      const controller = new AbortController();
      processingRetryControllersRef.current.set(documentId, controller);
      setProcessingRetryStore((current) => ({
        errors:
          current.projectId === projectId
            ? Object.fromEntries(
                Object.entries(current.errors).filter(
                  ([id]) => id !== documentId,
                ),
              )
            : {},
        projectId,
        retryingIds: [
          ...new Set([
            ...(current.projectId === projectId ? current.retryingIds : []),
            documentId,
          ]),
        ],
      }));

      try {
        const response = await processingRetryRequest(
          projectId,
          documentId,
          controller.signal,
        );

        if (
          controller.signal.aborted ||
          activeProjectIdRef.current !== projectId
        ) {
          return false;
        }

        const updated = assertDocumentSummaryResponse(
          response,
          projectId,
          documentId,
        );
        commitDocument(projectId, updated);
        return true;
      } catch (error) {
        if (
          controller.signal.aborted ||
          activeProjectIdRef.current !== projectId ||
          isAbort(error)
        ) {
          return false;
        }

        setProcessingRetryStore((current) => ({
          ...current,
          errors: {
            ...(current.projectId === projectId ? current.errors : {}),
            [documentId]: errorMessage(
              error,
              'Document processing could not be retried.',
            ),
          },
          projectId,
        }));
        return false;
      } finally {
        if (
          processingRetryControllersRef.current.get(documentId) === controller
        ) {
          processingRetryControllersRef.current.delete(documentId);
          setProcessingRetryStore((current) => ({
            ...current,
            retryingIds:
              current.projectId === projectId
                ? current.retryingIds.filter((id) => id !== documentId)
                : current.retryingIds,
          }));
        }
      }
    },
    [commitDocument, enabled, processingRetryRequest, projectId],
  );

  const clearProcessingError = useCallback(
    (documentId: string) => {
      setProcessingRetryStore((current) => ({
        ...current,
        errors:
          current.projectId === projectId
            ? Object.fromEntries(
                Object.entries(current.errors).filter(
                  ([id]) => id !== documentId,
                ),
              )
            : current.errors,
      }));
    },
    [projectId],
  );

  const transfers = useMemo(
    () =>
      (transferStore.projectId === projectId ? transferStore.records : []).map(
        publicTransfer,
      ),
    [projectId, transferStore],
  );
  const retryingDocumentIds = useMemo(
    () => new Set(currentProcessingRetryStore.retryingIds),
    [currentProcessingRetryStore.retryingIds],
  );

  return {
    clearProcessingError,
    dismissTransfer,
    documents: currentStore.documents,
    error: currentStore.error,
    policy: policyStore.policy,
    policyError: policyStore.error,
    policyStatus: enabled ? policyStore.status : 'idle',
    processingErrors: currentProcessingRetryStore.errors,
    refresh,
    refreshPolicy,
    retryProcessing,
    retryTransfer,
    retryingDocumentIds,
    status: currentStore.status,
    transfers,
    uploadFile,
  };
}

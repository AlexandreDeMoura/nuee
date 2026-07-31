import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Ref,
} from 'react';
import {
  Check,
  CircleAlert,
  Clock3,
  FileText,
  LoaderCircle,
  RotateCcw,
  Upload,
} from 'lucide-react';
import type { DocumentSummary } from '../api';
import { DocumentInspectionPanel, type DocumentDetailRequest } from './DocumentInspectionPanel';
import {
  documentPolicyDescription,
  documentPolicyExtensions,
  documentProcessingFailureMessage,
  documentStatusLabels,
  formatDocumentSize,
  formatDocumentUploadTime,
} from './documentPresentation';
import type {
  DocumentLibraryController,
  DocumentTransferRow,
} from './useDocumentLibrary';

const focusRing =
  '[-webkit-tap-highlight-color:transparent] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/30';

interface InspectionSelection {
  documentId: string;
  projectId: string;
}

export interface DocumentsPanelProps {
  controller: DocumentLibraryController;
  projectId: string;
  requestDocument?: DocumentDetailRequest;
  uploadInputRef?: Ref<HTMLInputElement>;
}

function setRefValue<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

function StatusMark({ status }: { status: DocumentSummary['processing_status'] }) {
  const classes = {
    processing: 'bg-[#eef2fa] text-[#3f63a8]',
    ready: 'bg-[#ecf5ee] text-[#5b8f67]',
    failed: 'bg-[#f9eeee] text-[#a95f57]',
  }[status];

  return (
    <span className={`grid size-7 shrink-0 place-items-center rounded-[8px] ${classes}`}>
      {status === 'processing' ? (
        <Clock3 className="size-[14px]" strokeWidth={1.8} aria-hidden="true" />
      ) : status === 'ready' ? (
        <Check className="size-[14px]" strokeWidth={2} aria-hidden="true" />
      ) : (
        <CircleAlert
          className="size-[14px]"
          strokeWidth={1.8}
          aria-hidden="true"
        />
      )}
    </span>
  );
}

function TransferItem({
  onDismiss,
  onRetry,
  transfer,
}: {
  onDismiss: (id: string) => void;
  onRetry: (id: string) => void;
  transfer: DocumentTransferRow;
}) {
  const isTransferring = transfer.status === 'transferring';
  const errorId = `document-transfer-error-${transfer.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  return (
    <li className="rounded-[10px] border border-[#e5e9ee] bg-white px-3 py-3">
      <div className="flex items-start gap-2.5">
        <span
          className={`grid size-7 shrink-0 place-items-center rounded-[8px] ${
            isTransferring
              ? 'bg-[#eef2fa] text-[#3f63a8]'
              : 'bg-[#f9eeee] text-[#a95f57]'
          }`}
        >
          {isTransferring ? (
            <LoaderCircle
              className="size-[14px] animate-spin motion-reduce:animate-none"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          ) : (
            <CircleAlert
              className="size-[14px]"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-[12.5px] leading-[1.4] font-semibold text-[#344050]">
            {transfer.original_filename}
          </p>
          <p className="mt-1 text-[10px] font-semibold tracking-[0.05em] text-[#7d8997] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
            {isTransferring ? 'TRANSFERRING' : 'UPLOAD FAILED'} ·{' '}
            {formatDocumentSize(transfer.size_bytes)}
          </p>
          {transfer.error && (
            <p
              className="mt-2 text-[11.5px] leading-[1.45] text-[#9a514c]"
              id={errorId}
              role="alert"
            >
              {transfer.error}
            </p>
          )}
          {!isTransferring && (
            <div className="mt-2.5 flex gap-2">
              <button
                className={`cursor-pointer rounded-md border border-[#d4ddea] bg-[#f7f9fc] px-2.5 py-1.5 text-[11px] font-semibold text-[#3f63a8] hover:bg-[#eef2fa] ${focusRing}`}
                type="button"
                aria-describedby={transfer.error ? errorId : undefined}
                onClick={() => onRetry(transfer.id)}
              >
                Retry upload
              </button>
              <button
                className={`cursor-pointer rounded-md px-2 py-1.5 text-[11px] font-semibold text-[#7b8899] hover:bg-[#f2f5f9] hover:text-[#4f5d6d] ${focusRing}`}
                type="button"
                onClick={() => onDismiss(transfer.id)}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function DocumentItem({
  document,
  inspectButtonRef,
  onInspect,
  onRetryProcessing,
  processingError,
  retryingProcessing,
}: {
  document: DocumentSummary;
  inspectButtonRef: (element: HTMLButtonElement | null) => void;
  onInspect: (document: DocumentSummary) => void;
  onRetryProcessing: (documentId: string) => void;
  processingError: string | null;
  retryingProcessing: boolean;
}) {
  const failed = document.processing_status === 'failed';
  const errorId = `document-processing-error-${document.id}`;

  return (
    <li className="rounded-[10px] border border-transparent hover:border-[#e9edf2] hover:bg-[#fafbfc]">
      <button
        className={`flex w-full cursor-pointer items-start gap-2.5 rounded-[10px] px-3 py-3 text-left ${focusRing}`}
        type="button"
        aria-label={`Inspect document: ${document.title}`}
        ref={inspectButtonRef}
        onClick={() => onInspect(document)}
      >
        <StatusMark status={document.processing_status} />
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2">
            <span className="min-w-0 flex-1 break-words text-[12.5px] leading-[1.4] font-semibold text-[#344050]">
              {document.title}
            </span>
            <span
              className={`shrink-0 rounded-[5px] px-1.5 py-0.5 text-[8.5px] font-semibold tracking-[0.07em] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${
                document.processing_status === 'ready'
                  ? 'bg-[#ecf5ee] text-[#5b8f67]'
                  : document.processing_status === 'processing'
                    ? 'bg-[#eef2fa] text-[#5872a4]'
                    : 'bg-[#f9eeee] text-[#a95f57]'
              }`}
            >
              {documentStatusLabels[document.processing_status].toUpperCase()}
            </span>
          </span>
          <span className="mt-1 block break-words text-[11px] leading-[1.4] text-[#788697]">
            {document.original_filename}
          </span>
          <span className="mt-1 block text-[10px] leading-[1.45] text-[#9aa6b4] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
            {formatDocumentSize(document.size_bytes)} ·{' '}
            <time dateTime={document.created_at} title={document.created_at}>
              {formatDocumentUploadTime(document.created_at)}
            </time>
          </span>
          {failed && (
            <span className="mt-2 block text-[11.5px] leading-[1.45] text-[#9a514c]">
              {documentProcessingFailureMessage(document.processing_error_code)}
            </span>
          )}
        </span>
      </button>

      {failed && document.can_retry && (
        <div className="px-3 pb-3 pl-[50px]">
          <button
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#d4ddea] bg-[#f7f9fc] px-2.5 py-1.5 text-[11px] font-semibold text-[#3f63a8] hover:bg-[#eef2fa] disabled:cursor-wait disabled:opacity-60 ${focusRing}`}
            type="button"
            aria-describedby={processingError ? errorId : undefined}
            disabled={retryingProcessing}
            onClick={() => onRetryProcessing(document.id)}
          >
            {retryingProcessing ? (
              <LoaderCircle
                className="size-[12px] animate-spin motion-reduce:animate-none"
                strokeWidth={1.8}
                aria-hidden="true"
              />
            ) : (
              <RotateCcw
                className="size-[12px]"
                strokeWidth={1.8}
                aria-hidden="true"
              />
            )}
            {retryingProcessing ? 'Retrying…' : 'Retry processing'}
          </button>
          {processingError && (
            <p
              className="mt-2 text-[11.5px] leading-[1.45] text-[#9a514c]"
              id={errorId}
              role="alert"
            >
              {processingError}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function DocumentsPanel({
  controller,
  projectId,
  requestDocument,
  uploadInputRef,
}: DocumentsPanelProps) {
  const inputId = useId();
  const policyDescriptionId = useId();
  const internalUploadInputRef = useRef<HTMLInputElement | null>(null);
  const inspectButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const [selection, setSelection] = useState<InspectionSelection | null>(null);
  const activeSelection = selection?.projectId === projectId ? selection : null;
  const selectedDocument = activeSelection
    ? controller.documents.find(({ id }) => id === activeSelection.documentId) ?? null
    : null;
  const policyExtensions = useMemo(
    () => (controller.policy ? documentPolicyExtensions(controller.policy) : []),
    [controller.policy],
  );
  const accept = policyExtensions.join(',');
  const isInitialLoading =
    (controller.status === 'idle' || controller.status === 'loading') &&
    controller.documents.length === 0 &&
    controller.transfers.length === 0;
  const isEmpty =
    controller.status === 'ready' &&
    controller.documents.length === 0 &&
    controller.transfers.length === 0;
  const liveSummary = useMemo(() => {
    const processingCount = controller.documents.filter(
      ({ processing_status }) => processing_status === 'processing',
    ).length;
    const readyCount = controller.documents.filter(
      ({ processing_status }) => processing_status === 'ready',
    ).length;
    const failedCount =
      controller.documents.length - processingCount - readyCount +
      controller.transfers.filter(({ status }) => status === 'failed').length;
    const transferringCount = controller.transfers.filter(
      ({ status }) => status === 'transferring',
    ).length;

    return `${transferringCount} transferring. ${processingCount} processing. ${readyCount} ready. ${failedCount} failed.`;
  }, [controller.documents, controller.transfers]);

  const setUploadInput = useCallback(
    (element: HTMLInputElement | null) => {
      internalUploadInputRef.current = element;
      setRefValue(uploadInputRef, element);
    },
    [uploadInputRef],
  );

  const handleFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';

    for (const file of files) {
      controller.uploadFile(file);
    }
  };

  const inspectDocument = (document: DocumentSummary) => {
    controller.clearProcessingError(document.id);
    setSelection({ documentId: document.id, projectId });
  };

  const returnToList = () => {
    const documentId = activeSelection?.documentId;
    setSelection(null);
    window.setTimeout(() => {
      if (documentId) {
        inspectButtonsRef.current.get(documentId)?.focus();
      }
    }, 0);
  };

  const retryProcessing = (documentId: string) => {
    controller.clearProcessingError(documentId);
    void controller.retryProcessing(documentId);
  };

  if (activeSelection) {
    if (!selectedDocument) {
      return (
        <div className="flex min-h-0 flex-1 flex-col" data-document-inspection="missing">
          <div className="border-b border-[#eef1f5] px-3 py-3">
            <button
              className={`inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-1 text-[11.5px] font-semibold text-[#5872a4] hover:text-[#33538f] ${focusRing}`}
              type="button"
              onClick={returnToList}
            >
              All documents
            </button>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center px-7 text-center" role="alert">
            <CircleAlert
              className="mb-3 size-5 text-[#a95f57]"
              strokeWidth={1.7}
              aria-hidden="true"
            />
            <h3 className="text-[13px] font-semibold text-[#344050]">
              Document unavailable
            </h3>
            <p className="mt-1.5 max-w-[240px] text-xs leading-[1.55] text-[#7b8899]">
              This document is missing or is no longer available in this project.
            </p>
          </div>
        </div>
      );
    }

    return (
      <DocumentInspectionPanel
        document={selectedDocument}
        key={`${selectedDocument.id}:${selectedDocument.updated_at}:${selectedDocument.processing_status}`}
        onBack={returnToList}
        onRetryProcessing={retryProcessing}
        processingRetryError={
          controller.processingErrors[selectedDocument.id] ?? null
        }
        projectId={projectId}
        requestDocument={requestDocument}
        retryingProcessing={controller.retryingDocumentIds.has(
          selectedDocument.id,
        )}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-documents-panel>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {liveSummary}
      </span>

      <div className="shrink-0 border-b border-[#eef1f5] px-3 py-3">
        <input
          className="sr-only"
          accept={accept}
          aria-label="Choose document files"
          aria-describedby={policyDescriptionId}
          disabled={!controller.policy}
          id={inputId}
          multiple
          ref={setUploadInput}
          type="file"
          onChange={handleFilesSelected}
        />
        <button
          className={`inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-[#cdd8ea] bg-[#f6f8fc] px-3 py-2 text-xs font-semibold text-[#3f63a8] hover:border-[#aebed8] hover:bg-[#eef2fa] disabled:cursor-not-allowed disabled:border-[#e4e9ef] disabled:bg-[#fafbfc] disabled:text-[#9aa6b4] ${focusRing}`}
          type="button"
          aria-describedby={policyDescriptionId}
          disabled={!controller.policy}
          onClick={() => internalUploadInputRef.current?.click()}
        >
          <Upload className="size-[14px]" strokeWidth={1.8} aria-hidden="true" />
          Choose documents
        </button>
        <p
          className="mt-2 text-center text-[10.5px] leading-[1.45] text-[#8b97a6]"
          id={policyDescriptionId}
        >
          {controller.policy
            ? documentPolicyDescription(controller.policy)
            : controller.policyStatus === 'loading'
              ? 'Loading supported formats and upload limit…'
              : 'Upload requirements are unavailable.'}
        </p>
        {controller.policyStatus === 'error' && (
          <div
            className="mt-2 flex items-start justify-between gap-2 rounded-lg border border-[#efd4d1] bg-[#fdf6f5] px-2.5 py-2 text-[11px] leading-[1.4] text-[#9a514c]"
            role="alert"
          >
            <span>{controller.policyError}</span>
            <button
              className={`shrink-0 cursor-pointer rounded p-0.5 text-[#8d4944] hover:bg-[#f8e7e5] ${focusRing}`}
              type="button"
              aria-label="Retry upload requirements"
              onClick={controller.refreshPolicy}
            >
              <RotateCcw className="size-[13px]" strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {isInitialLoading && (
        <div
          className="flex flex-1 items-center justify-center gap-2 text-xs text-[#8b97a6]"
          role="status"
        >
          <LoaderCircle
            className="size-4 animate-spin motion-reduce:animate-none"
            strokeWidth={1.8}
            aria-hidden="true"
          />
          Loading documents…
        </div>
      )}

      {controller.status === 'error' &&
        controller.documents.length === 0 &&
        controller.transfers.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center px-7 text-center" role="alert">
            <span className="mb-3 grid size-9 place-items-center rounded-[10px] bg-[#f9eeee] text-[#a95f57]">
              <CircleAlert
                className="size-[16px]"
                strokeWidth={1.7}
                aria-hidden="true"
              />
            </span>
            <h3 className="text-[13px] font-semibold text-[#344050]">
              Couldn’t load documents
            </h3>
            <p className="mt-1.5 max-w-[240px] text-xs leading-[1.55] text-[#8b97a6]">
              {controller.error}
            </p>
            <button
              className={`mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#cdd8ea] bg-[#f6f8fc] px-3.5 py-2 text-xs font-semibold text-[#3f63a8] hover:border-[#aebed8] hover:bg-[#eef2fa] ${focusRing}`}
              type="button"
              onClick={controller.refresh}
            >
              <RotateCcw className="size-[13px]" strokeWidth={1.8} aria-hidden="true" />
              Try again
            </button>
          </div>
        )}

      {isEmpty && (
        <div
          className="flex flex-1 flex-col items-center justify-center px-7 text-center"
          data-panel-empty="documents"
        >
          <span className="mb-3 grid size-9 place-items-center rounded-[10px] bg-[#f2f5f9] text-[#7f8ea0]">
            <FileText className="size-[17px]" strokeWidth={1.7} aria-hidden="true" />
          </span>
          <h3 className="text-[13px] font-semibold text-[#344050]">
            No documents yet
          </h3>
          <p className="mt-1.5 max-w-[230px] text-xs leading-[1.55] text-[#8b97a6]">
            Add source material to inspect it here and explicitly select it for a discussion.
          </p>
          <button
            className={`mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#cdd8ea] bg-[#f6f8fc] px-3.5 py-2 text-xs font-semibold text-[#3f63a8] hover:border-[#aebed8] hover:bg-[#eef2fa] disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`}
            type="button"
            disabled={!controller.policy}
            onClick={() => internalUploadInputRef.current?.click()}
          >
            <Upload className="size-[13px]" strokeWidth={1.8} aria-hidden="true" />
            Upload documents
          </button>
        </div>
      )}

      {!isInitialLoading &&
        !isEmpty &&
        (controller.documents.length > 0 || controller.transfers.length > 0) && (
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {controller.status === 'error' && (
              <div
                className="mx-1 mb-2 flex items-start justify-between gap-2 rounded-lg border border-[#efd4d1] bg-[#fdf6f5] px-2.5 py-2 text-[11px] leading-[1.4] text-[#9a514c]"
                role="alert"
              >
                <span>
                  {controller.error}{' '}
                  {controller.documents.length > 0
                    ? 'Existing documents remain available.'
                    : 'Current uploads remain available.'}
                </span>
                <button
                  className={`shrink-0 cursor-pointer rounded p-0.5 text-[#8d4944] hover:bg-[#f8e7e5] ${focusRing}`}
                  type="button"
                  aria-label="Retry document list"
                  onClick={controller.refresh}
                >
                  <RotateCcw
                    className="size-[13px]"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                </button>
              </div>
            )}

            {controller.transfers.length > 0 && (
              <ul className="space-y-2 px-1 pb-2" aria-label="Document uploads">
                {controller.transfers.map((transfer) => (
                  <TransferItem
                    key={transfer.id}
                    onDismiss={controller.dismissTransfer}
                    onRetry={controller.retryTransfer}
                    transfer={transfer}
                  />
                ))}
              </ul>
            )}

            {controller.documents.length > 0 && (
              <ul aria-label="Project documents">
                {controller.documents.map((document) => (
                  <DocumentItem
                    document={document}
                    inspectButtonRef={(element) => {
                      if (element) {
                        inspectButtonsRef.current.set(document.id, element);
                      } else {
                        inspectButtonsRef.current.delete(document.id);
                      }
                    }}
                    key={document.id}
                    onInspect={inspectDocument}
                    onRetryProcessing={retryProcessing}
                    processingError={
                      controller.processingErrors[document.id] ?? null
                    }
                    retryingProcessing={controller.retryingDocumentIds.has(
                      document.id,
                    )}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
    </div>
  );
}

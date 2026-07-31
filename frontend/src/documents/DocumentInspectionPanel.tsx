import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CircleAlert,
  Clock3,
  FileCheck2,
  FileText,
  LoaderCircle,
  RotateCcw,
} from 'lucide-react';
import {
  assertDocumentDetailResponse,
  getDocument,
  type DocumentDetail,
  type DocumentSummary,
} from '../api';
import {
  documentProcessingFailureMessage,
  documentStatusLabels,
  formatDocumentSize,
  formatDocumentUploadTime,
} from './documentPresentation';

const focusRing =
  '[-webkit-tap-highlight-color:transparent] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/30';

export type DocumentDetailRequest = typeof getDocument;

interface DocumentInspectionState {
  detail: DocumentDetail | null;
  error: string | null;
  status: 'loading' | 'ready' | 'error';
}

export interface DocumentInspectionPanelProps {
  document: DocumentSummary;
  onBack: () => void;
  onRetryProcessing: (documentId: string) => void;
  processingRetryError?: string | null;
  projectId: string;
  requestDocument?: DocumentDetailRequest;
  retryingProcessing?: boolean;
}

function requestErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : 'The document details could not be loaded. Please retry.';
}

function DocumentMetadata({ document }: { document: DocumentSummary }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-y border-[#eef1f5] py-3 text-[11.5px]">
      <dt className="text-[#8b97a6]">Original file</dt>
      <dd className="min-w-0 break-words text-right text-[#4c5a6b]">
        {document.original_filename}
      </dd>
      <dt className="text-[#8b97a6]">Size</dt>
      <dd className="text-right text-[#4c5a6b]">
        {formatDocumentSize(document.size_bytes)}
      </dd>
      <dt className="text-[#8b97a6]">Uploaded</dt>
      <dd className="text-right text-[#4c5a6b]">
        <time dateTime={document.created_at} title={document.created_at}>
          {formatDocumentUploadTime(document.created_at)}
        </time>
      </dd>
    </dl>
  );
}

function InspectionStatus({
  document,
  onRetryProcessing,
  processingRetryError,
  retryingProcessing,
}: {
  document: Exclude<DocumentDetail, { processing_status: 'ready' }>;
  onRetryProcessing: (documentId: string) => void;
  processingRetryError: string | null;
  retryingProcessing: boolean;
}) {
  const isProcessing = document.processing_status === 'processing';

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-2 py-10 text-center">
      <span
        className={`mb-3 grid size-10 place-items-center rounded-[11px] ${
          isProcessing
            ? 'bg-[#eef2fa] text-[#3f63a8]'
            : 'bg-[#f9eeee] text-[#a95f57]'
        }`}
      >
        {isProcessing ? (
          <Clock3 className="size-[18px]" strokeWidth={1.7} aria-hidden="true" />
        ) : (
          <CircleAlert
            className="size-[18px]"
            strokeWidth={1.7}
            aria-hidden="true"
          />
        )}
      </span>
      <h3 className="text-[13px] font-semibold text-[#344050]">
        {isProcessing ? 'Processed text is not ready yet' : 'Processing failed'}
      </h3>
      <p className="mt-1.5 max-w-[245px] text-xs leading-[1.55] text-[#7b8899]">
        {isProcessing
          ? 'Nuée is still preparing the complete text used for discussion context.'
          : documentProcessingFailureMessage(document.processing_error_code)}
      </p>
      {!isProcessing && document.can_retry && (
        <button
          className={`mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#cdd8ea] bg-[#f6f8fc] px-3.5 py-2 text-xs font-semibold text-[#3f63a8] hover:border-[#aebed8] hover:bg-[#eef2fa] disabled:cursor-wait disabled:opacity-60 ${focusRing}`}
          type="button"
          aria-describedby={
            processingRetryError
              ? `document-inspection-retry-error-${document.id}`
              : undefined
          }
          disabled={retryingProcessing}
          onClick={() => onRetryProcessing(document.id)}
        >
          {retryingProcessing ? (
            <LoaderCircle
              className="size-[13px] animate-spin motion-reduce:animate-none"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          ) : (
            <RotateCcw
              className="size-[13px]"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          )}
          {retryingProcessing ? 'Retrying…' : 'Retry processing'}
        </button>
      )}
      {processingRetryError && (
        <p
          className="mt-3 max-w-[250px] rounded-lg border border-[#efd4d1] bg-[#fdf6f5] px-3 py-2 text-[11.5px] leading-[1.45] text-[#9a514c]"
          id={`document-inspection-retry-error-${document.id}`}
          role="alert"
        >
          {processingRetryError}
        </p>
      )}
    </div>
  );
}

export function DocumentInspectionPanel({
  document,
  onBack,
  onRetryProcessing,
  processingRetryError = null,
  projectId,
  requestDocument = getDocument,
  retryingProcessing = false,
}: DocumentInspectionPanelProps) {
  const [requestKey, setRequestKey] = useState(0);
  const [state, setState] = useState<DocumentInspectionState>({
    detail: null,
    error: null,
    status: 'loading',
  });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const displayedDocument = state.detail ?? document;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    requestDocument(projectId, document.id, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          detail: assertDocumentDetailResponse(
            response,
            projectId,
            document.id,
          ),
          error: null,
          status: 'ready',
        });
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          return;
        }

        setState({
          detail: null,
          error: requestErrorMessage(error),
          status: 'error',
        });
      });

    return () => controller.abort();
  }, [document.id, document.updated_at, projectId, requestDocument, requestKey]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-document-inspection={document.id}>
      <div className="shrink-0 border-b border-[#eef1f5] px-3 py-3">
        <button
          className={`mb-3 inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-1 text-[11.5px] font-semibold text-[#5872a4] hover:text-[#33538f] ${focusRing}`}
          type="button"
          onClick={onBack}
        >
          <ArrowLeft className="size-[14px]" strokeWidth={1.8} aria-hidden="true" />
          All documents
        </button>
        <div className="flex items-start gap-2.5 px-1">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[9px] bg-[#eef2f7] text-[#3f63a8]">
            <FileText className="size-[16px]" strokeWidth={1.7} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h3
              className="break-words text-[13px] leading-[1.4] font-semibold text-[#273446] outline-none"
              ref={headingRef}
              tabIndex={-1}
            >
              {displayedDocument.title}
            </h3>
            <p className="mt-1 text-[10px] font-semibold tracking-[0.06em] text-[#778596] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
              {documentStatusLabels[
                displayedDocument.processing_status
              ].toUpperCase()}
            </p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <DocumentMetadata document={displayedDocument} />

        {state.status === 'loading' && (
          <div
            className="flex items-center justify-center gap-2 py-12 text-xs text-[#8b97a6]"
            role="status"
          >
            <LoaderCircle
              className="size-4 animate-spin motion-reduce:animate-none"
              strokeWidth={1.8}
              aria-hidden="true"
            />
            Loading document…
          </div>
        )}

        {state.status === 'error' && (
          <div className="flex flex-col items-center py-10 text-center" role="alert">
            <CircleAlert
              className="mb-3 size-5 text-[#a95f57]"
              strokeWidth={1.7}
              aria-hidden="true"
            />
            <h3 className="text-[13px] font-semibold text-[#344050]">
              Couldn’t load this document
            </h3>
            <p className="mt-1.5 max-w-[250px] text-xs leading-[1.55] text-[#7b8899]">
              {state.error}
            </p>
            <button
              className={`mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#cdd8ea] bg-[#f6f8fc] px-3.5 py-2 text-xs font-semibold text-[#3f63a8] hover:border-[#aebed8] hover:bg-[#eef2fa] ${focusRing}`}
              type="button"
              onClick={() => {
                setState({ detail: null, error: null, status: 'loading' });
                setRequestKey((key) => key + 1);
              }}
            >
              <RotateCcw className="size-[13px]" strokeWidth={1.8} aria-hidden="true" />
              Try again
            </button>
          </div>
        )}

        {state.status === 'ready' && state.detail?.processing_status === 'ready' && (
          <section className="pt-4" aria-labelledby={`document-content-${document.id}`}>
            <div className="mb-3 flex items-start gap-2 rounded-[9px] border border-[#dce5f3] bg-[#f6f8fc] px-3 py-2.5 text-[11.5px] leading-[1.45] text-[#52698f]">
              <FileCheck2
                className="mt-0.5 size-[14px] shrink-0"
                strokeWidth={1.8}
                aria-hidden="true"
              />
              <p>
                This is the complete processed text Nuée uses when you explicitly
                select this document as discussion context.
              </p>
            </div>
            <h4
              className="mb-2 text-[10px] font-semibold tracking-[0.08em] text-[#7d8997] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]"
              id={`document-content-${document.id}`}
            >
              PROCESSED TEXT
            </h4>
            <pre className="m-0 whitespace-pre-wrap break-words rounded-[10px] border border-[#e5e9ee] bg-[#fafbfc] p-3 text-wrap text-[12px] leading-[1.65] text-[#354253] [font-family:'IBM_Plex_Sans',system-ui,sans-serif]">
              {state.detail.extracted_text}
            </pre>
          </section>
        )}

        {state.status === 'ready' &&
          state.detail &&
          state.detail.processing_status !== 'ready' && (
            <InspectionStatus
              document={state.detail}
              onRetryProcessing={onRetryProcessing}
              processingRetryError={processingRetryError}
              retryingProcessing={retryingProcessing}
            />
          )}
      </div>
    </div>
  );
}

import {
  Check,
  CircleAlert,
  Clock3,
  FileText,
} from 'lucide-react';
import type {
  DocumentContextSource,
  DocumentMultiSelectionController,
} from './documentContextSelectionTypes';

const focusRing =
  '[-webkit-tap-highlight-color:transparent] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/30';

const processingPresentation = {
  failed: {
    description:
      'Processing failed. This document can’t be used as discussion context.',
    label: 'FAILED',
  },
  pending: {
    description:
      'Still processing. This document can be selected when it’s ready.',
    label: 'PROCESSING',
  },
  ready: {
    description: 'Ready to include as a complete document.',
    label: 'READY',
  },
} as const;

function DocumentSelectionRow({
  controller,
  document,
}: {
  controller: DocumentMultiSelectionController;
  document: DocumentContextSource;
}) {
  const isReady = document.processing_status === 'ready';
  const isSelected = controller.selectedDocumentIdSet.has(document.id);
  const presentation = processingPresentation[document.processing_status];
  const descriptionId = `document-context-status-${document.id}`;

  return (
    <li
      className={`rounded-[11px] border ${
        isSelected
          ? 'border-[#9eb2d5] bg-[#f3f6fc]'
          : isReady
            ? 'border-[#e1e6ec] bg-white'
            : 'border-[#e5e8ed] bg-[#f8f9fb]'
      }`}
      data-document-context-id={document.id}
      data-document-context-selected={isSelected ? 'true' : 'false'}
      data-document-processing-status={document.processing_status}
    >
      <button
        className={`flex w-full items-start gap-3 rounded-[11px] px-3 py-3 text-left ${
          isReady
            ? `cursor-pointer hover:bg-[#f7f9fc] ${focusRing}`
            : 'cursor-not-allowed'
        }`}
        type="button"
        aria-checked={isSelected}
        aria-describedby={descriptionId}
        aria-disabled={!isReady}
        aria-label={document.title}
        disabled={!isReady}
        role="checkbox"
        onClick={() => controller.toggle(document.id)}
      >
        <span
          className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-[8px] ${
            isSelected
              ? 'bg-[#3f63a8] text-white'
              : isReady
                ? 'bg-[#eef2fa] text-[#3f63a8]'
                : 'bg-[#eceff3] text-[#98a3b0]'
          }`}
        >
          {isSelected ? (
            <Check
              className="size-[15px]"
              strokeWidth={2}
              aria-hidden="true"
            />
          ) : document.processing_status === 'pending' ? (
            <Clock3
              className="size-[15px]"
              strokeWidth={1.7}
              aria-hidden="true"
            />
          ) : document.processing_status === 'failed' ? (
            <CircleAlert
              className="size-[15px]"
              strokeWidth={1.7}
              aria-hidden="true"
            />
          ) : (
            <FileText
              className="size-[15px]"
              strokeWidth={1.7}
              aria-hidden="true"
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-xs font-semibold ${
              isReady ? 'text-[#344050]' : 'text-[#687484]'
            }`}
          >
            {document.title}
          </span>
          <span
            className={`mt-0.5 block text-[9px] font-semibold tracking-[0.08em] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${
              document.processing_status === 'failed'
                ? 'text-[#a95f57]'
                : document.processing_status === 'pending'
                  ? 'text-[#9a7a4d]'
                  : 'text-[#63806c]'
            }`}
          >
            {presentation.label}
          </span>
          <span
            className="mt-1 block text-[10.5px] leading-[1.45] text-[#8b97a6]"
            id={descriptionId}
          >
            {presentation.description}
          </span>
        </span>
      </button>
    </li>
  );
}

export function DocumentContextSelectionPanel({
  controller,
}: {
  controller: DocumentMultiSelectionController;
}) {
  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-labelledby="document-context-selection-title"
    >
      <div className="border-b border-[#eef1f5] px-[18px] py-4">
        <h3
          className="text-[13px] font-semibold text-[#344050]"
          id="document-context-selection-title"
        >
          {controller.instruction}
        </h3>
        <p className="mt-1.5 text-[11px] leading-[1.5] text-[#7d8998]">
          Select complete documents. Pages, passages, and excerpts can’t be
          selected separately.
        </p>
        <p
          className="mt-2 text-[9.5px] font-semibold tracking-[0.08em] text-[#6681b5] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]"
          aria-live="polite"
        >
          {controller.selectedDocumentIds.length} SELECTED
        </p>
      </div>

      {controller.documents.length > 0 ? (
        <ul
          className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
          aria-label="Documents available for discussion context"
        >
          {controller.documents.map((document) => (
            <DocumentSelectionRow
              controller={controller}
              document={document}
              key={document.id}
            />
          ))}
        </ul>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center px-7 text-center">
          <span className="mb-3 grid size-9 place-items-center rounded-[10px] bg-[#f2f5f9] text-[#7f8ea0]">
            <FileText
              className="size-[17px]"
              strokeWidth={1.7}
              aria-hidden="true"
            />
          </span>
          <h3 className="text-[13px] font-semibold text-[#344050]">
            No documents available
          </h3>
          <p className="mt-1.5 max-w-[230px] text-xs leading-[1.55] text-[#8b97a6]">
            This project has no documents that can be selected yet.
          </p>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2 border-t border-[#eef1f5] p-3">
        <button
          className={`min-h-9 flex-1 cursor-pointer rounded-[9px] border border-[#d3dae2] bg-white px-3 text-xs font-semibold text-[#5c6a7a] hover:bg-[#f6f8fc] hover:text-[#344050] ${focusRing}`}
          type="button"
          onClick={controller.cancel}
        >
          Cancel
        </button>
        <button
          className={`min-h-9 flex-[1.5] cursor-pointer rounded-[9px] bg-[#3f63a8] px-3 text-xs font-semibold text-white hover:bg-[#33538f] disabled:cursor-default disabled:bg-[#aebbd1] ${focusRing}`}
          type="button"
          aria-label={`${controller.confirmLabel} (${controller.selectedDocumentIds.length} selected)`}
          disabled={
            !controller.allowEmptySelection &&
            controller.selectedDocumentIds.length === 0
          }
          onClick={controller.confirm}
        >
          {controller.confirmLabel}
        </button>
      </div>
    </section>
  );
}

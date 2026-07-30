import { useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  FilePenLine,
  LoaderCircle,
  Plus,
  RefreshCw,
  Target,
  X,
} from 'lucide-react';
import type { KnowledgeExtractionProposal } from '../api';
import type { KnowledgeExtractionController } from './useKnowledgeExtraction';

const focusRing =
  '[-webkit-tap-highlight-color:transparent] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/30';
const fieldClasses =
  `w-full rounded-[10px] border bg-white px-3 py-2.5 text-[13px] leading-[1.55] text-[#273446] placeholder:text-[#aab4c1] disabled:cursor-not-allowed disabled:bg-[#f7f9fb] ${focusRing}`;

type ProposalField = keyof KnowledgeExtractionProposal;

export interface KnowledgeExtractionProposalReviewProps {
  controller: KnowledgeExtractionController;
  isRejecting?: boolean;
  onApproveAsNewBubble?: () => void | Promise<void>;
  onApproveBubbleUpdate?: () => void | Promise<void>;
  onReject: () => void | Promise<void>;
  onUpdateExistingBubble?: () => void | Promise<void>;
}

function normalizedProposal(
  proposal: KnowledgeExtractionProposal,
): KnowledgeExtractionProposal {
  return {
    title: proposal.title.trim(),
    summary: proposal.summary.trim(),
    content: proposal.content.trim(),
  };
}

export function KnowledgeExtractionProposalReview({
  controller,
  isRejecting = false,
  onApproveAsNewBubble,
  onApproveBubbleUpdate,
  onReject,
  onUpdateExistingBubble,
}: KnowledgeExtractionProposalReviewProps) {
  const titleId = useId();
  const summaryId = useId();
  const contentId = useId();
  const titleErrorId = useId();
  const contentErrorId = useId();
  const resolutionErrorId = useId();
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [touched, setTouched] = useState({
    content: false,
    title: false,
  });
  const proposal = controller.state.proposal;
  const normalized = proposal ? normalizedProposal(proposal) : null;
  const titleError =
    touched.title && (normalized?.title.length ?? 0) === 0;
  const contentError =
    touched.content && (normalized?.content.length ?? 0) === 0;
  const isSaving =
    controller.state.status === 'saving_new' ||
    controller.state.status === 'saving_update';
  const isBusy = isRejecting || isSaving;
  const resolutionFailure =
    controller.state.failure?.kind === 'resolution' ||
    controller.state.failure?.kind === 'target_changed'
      ? controller.state.failure
      : null;
  const target = controller.state.target;
  const targetPreview = target
    ? target.summary?.trim() || target.content.trim()
    : '';
  const updateAction = target
    ? onApproveBubbleUpdate
    : onUpdateExistingBubble;

  useEffect(() => {
    titleInputRef.current?.focus();
  }, [controller.state.extractionId]);

  if (!proposal || !normalized) {
    return null;
  }

  const touchField = (field: 'title' | 'content') => {
    setTouched((current) =>
      current[field] ? current : { ...current, [field]: true },
    );
  };

  const editField = (field: ProposalField, value: string) => {
    controller.editProposal(field, value);
  };

  const tryResolution = (
    action: (() => void | Promise<void>) | undefined,
  ) => {
    setTouched({ content: true, title: true });

    if (
      normalized.title.length === 0 ||
      normalized.content.length === 0 ||
      !action
    ) {
      return;
    }

    void action();
  };

  const inputBorderClasses = (hasError: boolean) =>
    hasError
      ? 'border-[#dca9a4] bg-[#fffafa] focus:border-[#b4544e]'
      : 'border-[#d8e0e9] focus:border-[#3f63a8]';

  return (
    <section
      className="mx-auto flex w-full max-w-[650px] flex-col gap-5"
      aria-labelledby="knowledge-extraction-review-title"
      data-knowledge-extraction-status={controller.state.status}
    >
      <header className="rounded-2xl border border-[#ced9e8] bg-[linear-gradient(145deg,#f4f7fc,#edf2fa)] px-4 py-4">
        <span className="mb-2 inline-flex items-center gap-1.5 text-[9.5px] font-semibold tracking-[0.08em] text-[#5e78aa] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
          <FilePenLine
            className="size-3.5"
            strokeWidth={1.8}
            aria-hidden="true"
          />
          Knowledge extraction
        </span>
        <h3
          className="text-[16px] font-semibold text-[#273446]"
          id="knowledge-extraction-review-title"
        >
          Review knowledge proposal
        </h3>
        <p
          className="mt-1.5 text-[11.5px] leading-[1.55] text-[#68778b]"
          aria-live="polite"
          role="status"
        >
          Proposal generated. Edit the plain text below before choosing what
          happens next. Nothing has been added to the canvas.
        </p>
      </header>

      {resolutionFailure && (
        <div
          className="rounded-xl border border-[#e8c4c0] bg-[#fff8f7] px-3.5 py-3 text-[#8f3f3a]"
          id={resolutionErrorId}
          role="alert"
        >
          <span className="flex items-start gap-2">
            <AlertCircle
              className="mt-0.5 size-4 shrink-0"
              strokeWidth={1.8}
              aria-hidden="true"
            />
            <span>
              <span className="block text-[12px] font-semibold">
                {resolutionFailure.kind === 'target_changed'
                  ? 'The target bubble changed'
                  : 'Couldn’t resolve this proposal'}
              </span>
              <span className="mt-0.5 block text-[11px] leading-[1.5] text-[#a25a55]">
                {resolutionFailure.message}
              </span>
            </span>
          </span>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label
            className="mb-1.5 block text-[11px] font-semibold text-[#465568]"
            htmlFor={titleId}
          >
            Title
          </label>
          <input
            className={`${fieldClasses} ${inputBorderClasses(titleError)}`}
            id={titleId}
            ref={titleInputRef}
            type="text"
            value={proposal.title}
            aria-describedby={titleError ? titleErrorId : undefined}
            aria-invalid={titleError || undefined}
            disabled={isBusy}
            onBlur={() => touchField('title')}
            onChange={(event) => editField('title', event.target.value)}
          />
          {titleError && (
            <p
              className="mt-1.5 flex items-center gap-1.5 text-[10.5px] font-medium text-[#a44a44]"
              id={titleErrorId}
            >
              <AlertCircle
                className="size-3.5 shrink-0"
                strokeWidth={1.9}
                aria-hidden="true"
              />
              Title is required.
            </p>
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <label
              className="text-[11px] font-semibold text-[#465568]"
              htmlFor={summaryId}
            >
              One-sentence summary
            </label>
            <span className="text-[9.5px] text-[#96a1af]">Optional</span>
          </div>
          <input
            className={`${fieldClasses} ${inputBorderClasses(false)}`}
            id={summaryId}
            type="text"
            value={proposal.summary}
            disabled={isBusy}
            onChange={(event) => editField('summary', event.target.value)}
          />
        </div>

        <div>
          <label
            className="mb-1.5 block text-[11px] font-semibold text-[#465568]"
            htmlFor={contentId}
          >
            Content
          </label>
          <textarea
            className={`${fieldClasses} min-h-52 resize-y whitespace-pre-wrap ${inputBorderClasses(contentError)}`}
            id={contentId}
            rows={9}
            value={proposal.content}
            aria-describedby={contentError ? contentErrorId : undefined}
            aria-invalid={contentError || undefined}
            disabled={isBusy}
            onBlur={() => touchField('content')}
            onChange={(event) => editField('content', event.target.value)}
          />
          {contentError && (
            <p
              className="mt-1.5 flex items-center gap-1.5 text-[10.5px] font-medium text-[#a44a44]"
              id={contentErrorId}
            >
              <AlertCircle
                className="size-3.5 shrink-0"
                strokeWidth={1.9}
                aria-hidden="true"
              />
              Content is required.
            </p>
          )}
        </div>
      </div>

      {target && (
        <section
          className="rounded-xl border border-[#cfd9e7] bg-[#f6f8fc] p-3.5"
          aria-labelledby="knowledge-extraction-update-target-title"
        >
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[9px] bg-[#e7edf7] text-[#48669a]"
              aria-hidden="true"
            >
              <Target className="size-4" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[9.5px] font-semibold tracking-[0.08em] text-[#7588a5] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
                Selected update target
              </span>
              <span
                className="mt-1 block truncate text-[13px] font-semibold text-[#2d3b4e]"
                id="knowledge-extraction-update-target-title"
              >
                {target.title}
              </span>
              {targetPreview.length > 0 && (
                <span className="mt-1 block line-clamp-2 text-[11px] leading-[1.5] text-[#718096]">
                  {targetPreview}
                </span>
              )}
            </span>
            <button
              className={`shrink-0 cursor-pointer rounded-[8px] border border-[#cfd9e7] bg-white px-2.5 py-1.5 text-[10.5px] font-semibold text-[#526b96] hover:bg-[#eef3fa] disabled:cursor-not-allowed disabled:text-[#aab4c1] ${focusRing}`}
              type="button"
              disabled={isBusy || onUpdateExistingBubble === undefined}
              onClick={() => tryResolution(onUpdateExistingBubble)}
            >
              Choose another
            </button>
          </div>
          <p className="mt-3 border-t border-[#dde4ed] pt-2.5 text-[10.5px] leading-[1.5] text-[#77869a]">
            Confirming replaces this bubble&apos;s title, summary, and content.
            Its canvas position and manual links stay unchanged.
          </p>
        </section>
      )}

      <div
        className="rounded-xl border border-[#dde4ed] bg-white p-3.5"
        aria-label="Proposal resolution"
        role="group"
      >
        <p className="mb-3 text-[10.5px] leading-[1.5] text-[#77869a]">
          Choose one resolution. Rejecting keeps the discussion unchanged and
          creates no bubble.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-[9px] bg-[#3f63a8] px-3.5 text-[11.5px] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(63,99,168,0.7)] hover:bg-[#33538f] disabled:cursor-not-allowed disabled:bg-[#aebbd1] disabled:shadow-none ${focusRing}`}
            data-knowledge-extraction-resolution-action="new_bubble"
            type="button"
            disabled={isBusy || onApproveAsNewBubble === undefined}
            onClick={() => tryResolution(onApproveAsNewBubble)}
          >
            {controller.state.status === 'saving_new' ? (
              <LoaderCircle
                className="size-3.5 animate-spin motion-reduce:animate-none"
                strokeWidth={1.9}
                aria-hidden="true"
              />
            ) : (
              <Plus
                className="size-3.5"
                strokeWidth={1.9}
                aria-hidden="true"
              />
            )}
            {controller.state.status === 'saving_new'
              ? 'Approving…'
              : 'Approve as new bubble'}
          </button>
          <button
            className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-[9px] border border-[#ccd7e6] bg-white px-3.5 text-[11.5px] font-semibold text-[#47628f] hover:bg-[#f4f7fc] disabled:cursor-not-allowed disabled:border-[#e0e5eb] disabled:text-[#aab4c1] ${focusRing}`}
            data-knowledge-extraction-resolution-action="update_bubble"
            type="button"
            disabled={isBusy || updateAction === undefined}
            onClick={() => tryResolution(updateAction)}
          >
            {controller.state.status === 'saving_update' ? (
              <LoaderCircle
                className="size-3.5 animate-spin motion-reduce:animate-none"
                strokeWidth={1.9}
                aria-hidden="true"
              />
            ) : (
              <RefreshCw
                className="size-3.5"
                strokeWidth={1.9}
                aria-hidden="true"
              />
            )}
            {controller.state.status === 'saving_update'
              ? 'Updating…'
              : target
                ? 'Confirm bubble update'
                : 'Update an existing bubble'}
          </button>
          <button
            className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-[9px] border border-[#e5cbc8] bg-[#fffafa] px-3.5 text-[11.5px] font-semibold text-[#a44a44] hover:bg-[#fbf1f0] disabled:cursor-not-allowed disabled:text-[#ca8d88] sm:col-span-2 ${focusRing}`}
            data-knowledge-extraction-resolution-action="reject"
            type="button"
            disabled={isBusy}
            onClick={() => void onReject()}
          >
            {isRejecting ? (
              <LoaderCircle
                className="size-3.5 animate-spin motion-reduce:animate-none"
                strokeWidth={1.9}
                aria-hidden="true"
              />
            ) : (
              <X
                className="size-3.5"
                strokeWidth={2}
                aria-hidden="true"
              />
            )}
            {isRejecting ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      </div>
    </section>
  );
}

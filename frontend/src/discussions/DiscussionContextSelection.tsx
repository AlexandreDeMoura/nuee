import {
  ArrowLeft,
  CircleAlert,
  CircleDot,
  FileText,
  MessageSquarePlus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { DiscussionContextSelectionInput } from '../api';
import { focusRing } from '../ui/focusRing';
import { discussionCreationSourceIssueMessage } from './discussionCreationFailure';
import type {
  DiscussionContextSelectionController,
  PendingDiscussionContextSource,
} from './useDiscussionContextSelection';

const secondaryButton =
  `inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-[9px] border border-[#cdd8ea] bg-white px-3.5 py-2 text-xs font-semibold text-[#3f63a8] hover:border-[#aebed8] hover:bg-[#f6f8fc] ${focusRing}`;
const primaryButton =
  `inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-[#3f63a8] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#33538f] ${focusRing}`;

export interface DiscussionContextSelectionProps {
  canSelectBubbles?: boolean;
  canSelectDocuments?: boolean;
  controller: DiscussionContextSelectionController;
  onSubmit: (
    selection: DiscussionContextSelectionInput,
    selectionRevision: number,
  ) => void;
}

function sourceIcon(source: PendingDiscussionContextSource) {
  return source.kind === 'bubble' ? MessageSquarePlus : FileText;
}

function PendingSourceList({
  controller,
}: {
  controller: DiscussionContextSelectionController;
}) {
  if (controller.pendingSources.length === 0) {
    return null;
  }

  return (
    <ul
      className="mt-4 space-y-2 text-left"
      aria-label="Pending discussion context"
    >
      {controller.pendingSources.map((source) => {
        const Icon = sourceIcon(source);
        const issue = controller.failure?.sourceIssues.find(
          (candidate) =>
            candidate.sourceKind === source.kind &&
            candidate.sourceId === source.id,
        );
        const issueId = issue
          ? `discussion-context-source-issue-${source.kind}-${source.id}`
          : undefined;

        return (
          <li
            className={`flex items-center gap-3 rounded-[10px] border bg-white px-3 py-2.5 ${
              issue
                ? 'border-[#d9aaa5] bg-[#fffafa]'
                : 'border-[#e1e6ec]'
            }`}
            aria-describedby={issueId}
            data-context-source-issue={issue?.reason}
            key={`${source.kind}:${source.id}`}
          >
            <span
              className={`grid size-8 shrink-0 place-items-center rounded-[8px] ${
                issue
                  ? 'bg-[#f9eeee] text-[#a95f57]'
                  : 'bg-[#eef2fa] text-[#3f63a8]'
              }`}
            >
              {issue ? (
                <CircleAlert
                  className="size-[15px]"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              ) : (
                <Icon
                  className="size-[15px]"
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-[#344050]">
                {source.title}
              </span>
              <span className="mt-0.5 block text-[9.5px] font-medium tracking-[0.08em] text-[#8b97a6] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
                {source.kind}
              </span>
              {issue && (
                <span
                  className="mt-1 block text-[10.5px] leading-[1.4] text-[#a05b55]"
                  id={issueId}
                >
                  {discussionCreationSourceIssueMessage(issue)}
                </span>
              )}
            </span>
            {issue && (
              <span className="shrink-0 rounded-[5px] bg-[#f9eeee] px-1.5 py-1 text-[8px] font-semibold tracking-[0.07em] text-[#a95f57] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
                REVIEW
              </span>
            )}
            <button
              className={`grid size-8 shrink-0 cursor-pointer place-items-center rounded-[8px] text-[#9aa6b4] hover:bg-[#fbf1f0] hover:text-[#b4544e] ${focusRing}`}
              type="button"
              aria-label={`Remove ${source.kind}: ${source.title}`}
              title="Remove from pending context"
              onClick={() => controller.removeSource(source.kind, source.id)}
            >
              <Trash2
                className="size-[14px]"
                strokeWidth={1.8}
                aria-hidden="true"
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ProjectContextIndicator() {
  return (
    <div
      className="flex items-center gap-3 rounded-[11px] border border-[#cad7ec] bg-[#f4f7fc] px-3.5 py-3 text-left"
      aria-label="Project description, always included"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[#e5ecf8] text-[#3f63a8]">
        <CircleDot
          className="size-[15px]"
          strokeWidth={1.8}
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-[#344050]">
          Project description
        </span>
        <span className="mt-0.5 block text-[10.5px] leading-[1.4] text-[#738196]">
          Always included from its latest value when the discussion starts.
        </span>
      </span>
      <span className="ml-auto shrink-0 rounded-[5px] bg-white/80 px-1.5 py-1 text-[8.5px] font-semibold tracking-[0.08em] text-[#6681b5] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
        INCLUDED
      </span>
    </div>
  );
}

export function DiscussionContextSelection({
  canSelectBubbles = false,
  canSelectDocuments = false,
  controller,
  onSubmit,
}: DiscussionContextSelectionProps) {
  const submit = (projectContextOnly: boolean) => {
    const removesPendingSources =
      projectContextOnly && controller.pendingSources.length > 0;
    const selectionRevision =
      controller.selectionRevision + (removesPendingSources ? 1 : 0);
    const selection = projectContextOnly
      ? { bubble_ids: [], document_ids: [] }
      : controller.selection;

    controller.beginSubmitting(projectContextOnly);
    onSubmit(selection, selectionRevision);
  };

  if (controller.phase === 'error') {
    return (
      <section
        className="m-auto w-full max-w-[520px] py-5 text-center"
        aria-labelledby="discussion-context-error-title"
      >
        <span className="mx-auto mb-3 grid size-11 place-items-center rounded-[12px] bg-[#f9eeee] text-[#a95f57]">
          <CircleAlert
            className="size-[18px]"
            strokeWidth={1.7}
            aria-hidden="true"
          />
        </span>
        <h3
          className="text-[15px] font-semibold text-[#344050]"
          id="discussion-context-error-title"
        >
          Discussion context wasn&apos;t created
        </h3>
        <p
          className="mx-auto mt-2 max-w-[420px] text-xs leading-[1.55] text-[#8b5d59]"
          role="alert"
        >
          {controller.error ?? 'The discussion could not be started.'}
        </p>
        {controller.pendingSources.length > 0 && (
          <div className="mx-auto mt-4 max-w-[460px]">
            <PendingSourceList controller={controller} />
          </div>
        )}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            className={primaryButton}
            type="button"
            onClick={() => {
              controller.retrySubmission();
              onSubmit(
                controller.selection,
                controller.selectionRevision,
              );
            }}
          >
            <RotateCcw
              className="size-[14px]"
              strokeWidth={1.8}
              aria-hidden="true"
            />
            Try again
          </button>
          <button
            className={secondaryButton}
            type="button"
            onClick={controller.review}
          >
            Review context
          </button>
          <button
            className={secondaryButton}
            type="button"
            onClick={controller.cancel}
          >
            Back to prompt
          </button>
        </div>
      </section>
    );
  }

  if (controller.phase === 'review') {
    const bubbleCount = controller.selection.bubble_ids.length;
    const documentCount = controller.selection.document_ids.length;

    return (
      <section
        className="m-auto w-full max-w-[560px] py-2"
        aria-labelledby="discussion-context-review-title"
      >
        <div className="text-center">
          <p className="text-[9.5px] font-semibold tracking-[0.12em] text-[#8290a0] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
            Frozen when discussion starts
          </p>
          <h3
            className="mt-1.5 text-[17px] font-semibold text-[#263344]"
            id="discussion-context-review-title"
          >
            Review discussion context
          </h3>
          <p className="mt-1.5 text-xs leading-[1.5] text-[#7d8998]">
            {bubbleCount} {bubbleCount === 1 ? 'bubble' : 'bubbles'} ·{' '}
            {documentCount} {documentCount === 1 ? 'document' : 'documents'}
          </p>
        </div>

        <div className="mt-5">
          {controller.failure && (
            <p
              className="mb-3 rounded-[9px] border border-[#e7c5c1] bg-[#fff9f8] px-3 py-2.5 text-left text-[11px] leading-[1.5] text-[#8b5d59]"
              role="alert"
            >
              {controller.failure.message}
            </p>
          )}
          <ProjectContextIndicator />
          <PendingSourceList controller={controller} />
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <button
            className={secondaryButton}
            type="button"
            onClick={controller.backToInvitation}
          >
            <ArrowLeft
              className="size-[14px]"
              strokeWidth={1.8}
              aria-hidden="true"
            />
            Add or change context
          </button>
          <button
            className={primaryButton}
            type="button"
            onClick={() => submit(false)}
          >
            Start discussion
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      className="m-auto w-full max-w-[540px] py-3 text-center"
      aria-labelledby="discussion-context-invitation-title"
    >
      <p className="text-[9.5px] font-semibold tracking-[0.12em] text-[#8290a0] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
        Before the discussion starts
      </p>
      <h3
        className="mt-1.5 text-[17px] font-semibold text-[#263344]"
        id="discussion-context-invitation-title"
      >
        Choose what Nuée should use
      </h3>
      <p className="mx-auto mt-2 max-w-[450px] text-xs leading-[1.55] text-[#7d8998]">
        Add project knowledge if it helps, or continue with only the project
        description. Your prompt stays here while you choose.
      </p>

      <div className="mt-5">
        <ProjectContextIndicator />
        <PendingSourceList controller={controller} />
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {canSelectBubbles && (
          <button
            className={secondaryButton}
            type="button"
            onClick={() => controller.beginSourceSelection('bubble')}
          >
            <MessageSquarePlus
              className="size-[15px]"
              strokeWidth={1.8}
              aria-hidden="true"
            />
            {controller.selection.bubble_ids.length > 0
              ? 'Change bubbles'
              : 'Add bubbles'}
          </button>
        )}
        {canSelectDocuments && (
          <button
            className={secondaryButton}
            type="button"
            onClick={() => controller.beginSourceSelection('document')}
          >
            <FileText
              className="size-[15px]"
              strokeWidth={1.8}
              aria-hidden="true"
            />
            {controller.selection.document_ids.length > 0
              ? 'Change documents'
              : 'Add documents'}
          </button>
        )}
        {controller.pendingSources.length > 0 && (
          <button
            className={secondaryButton}
            type="button"
            onClick={controller.review}
          >
            Review selected context
          </button>
        )}
      </div>

      <button
        className={`${primaryButton} mt-4 w-full`}
        type="button"
        onClick={() => submit(true)}
      >
        Continue with project context only
      </button>
      <button
        className={`mt-3 cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium text-[#7d8998] hover:text-[#40516a] ${focusRing}`}
        type="button"
        onClick={controller.cancel}
      >
        Back to prompt
      </button>
    </section>
  );
}

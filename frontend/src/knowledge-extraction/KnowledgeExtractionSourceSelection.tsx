import {
  useEffect,
  useId,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { AlertCircle, LockKeyhole } from 'lucide-react';
import type {
  DiscussionDetails,
  KnowledgeExtractionDetailLevel,
} from '../api';
import { focusRing } from '../ui/focusRing';
import type { KnowledgeExtractionSourceIssue } from './knowledgeExtractionStateMachine';
import {
  eligibleKnowledgeExtractionContextItems,
  eligibleKnowledgeExtractionMessages,
  knowledgeExtractionSourceRefKey,
} from './knowledgeExtractionSources';
import {
  FrozenContextSource,
  MessageSource,
} from './KnowledgeExtractionSourceOption';
import type { KnowledgeExtractionController } from './useKnowledgeExtraction';

const INSTRUCTIONS_MAX_LENGTH = 2_000;

const instructionPresets = [
  'Numbers only',
  'Keep the caveats',
  'Write it as a decision',
] as const;

const detailOptions: ReadonlyArray<{
  description: string;
  label: string;
  level: KnowledgeExtractionDetailLevel;
  length: string;
}> = [
  {
    description: 'The claim and nothing else.',
    label: 'Tight',
    length: '1–2 sentences',
    level: 'tight',
  },
  {
    description: 'Claim, key numbers, one caveat.',
    label: 'Standard',
    length: 'Short paragraph · default',
    level: 'standard',
  },
  {
    description: 'Reasoning, figures, open questions.',
    label: 'Detailed',
    length: '2–3 paragraphs',
    level: 'detailed',
  },
];

function sourceIssue(
  issues: readonly KnowledgeExtractionSourceIssue[],
  sourceKind: KnowledgeExtractionSourceIssue['sourceKind'],
  sourceId: string,
): KnowledgeExtractionSourceIssue | null {
  return (
    issues.find(
      (issue) =>
        issue.sourceKind === sourceKind && issue.sourceId === sourceId,
    ) ?? null
  );
}

function StepHeading({
  aside,
  children,
  number,
}: {
  aside?: ReactNode;
  children: ReactNode;
  number: number;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="grid size-6 shrink-0 place-items-center rounded-lg bg-[#eef3fb] text-[11px] font-semibold text-[#4267ad] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]"
        aria-hidden="true"
      >
        {number}
      </span>
      <h3 className="text-[13px] font-semibold text-[#263142]">
        {children}
      </h3>
      {aside}
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <p
      className="mt-1.5 flex items-center gap-1.5 text-[10.5px] font-medium text-[#a44a44]"
      id={id}
    >
      <AlertCircle
        className="size-3.5 shrink-0"
        strokeWidth={1.9}
        aria-hidden="true"
      />
      {message}
    </p>
  );
}

export interface KnowledgeExtractionSourceSelectionProps {
  controller: KnowledgeExtractionController;
  discussion: DiscussionDetails;
}

export function KnowledgeExtractionSourceSelection({
  controller,
  discussion,
}: KnowledgeExtractionSourceSelectionProps) {
  const errorId = useId();
  const sourcesErrorId = useId();
  const instructionsId = useId();
  const instructionsHelpId = useId();
  const instructionsErrorId = useId();
  const detailGroupId = useId();
  const detailErrorId = useId();
  const initialFocusAppliedRef = useRef(false);
  const sourceRefs = useRef(new Map<string, HTMLButtonElement>());
  const messages = useMemo(
    () => eligibleKnowledgeExtractionMessages(discussion),
    [discussion],
  );
  const contextItems = useMemo(
    () => eligibleKnowledgeExtractionContextItems(discussion),
    [discussion],
  );
  const failure =
    controller.state.failure?.kind === 'source_validation' ||
    controller.state.failure?.kind === 'generation'
      ? controller.state.failure
      : null;
  const issues = useMemo(
    () =>
      failure?.kind === 'source_validation'
        ? failure.sourceIssues
        : [],
    [failure],
  );
  const fieldErrors =
    failure?.kind === 'source_validation' ? failure.fieldErrors : {};
  const controlsDisabled = controller.state.status === 'generating';
  const eligibleMessageIds = useMemo(
    () => messages.map((message) => message.id),
    [messages],
  );
  const eligibleMessageIdSet = useMemo(
    () => new Set(eligibleMessageIds),
    [eligibleMessageIds],
  );
  const selectedMessageCount =
    controller.state.selection.messageIds.filter((messageId) =>
      eligibleMessageIdSet.has(messageId),
    ).length;
  const allMessagesSelected =
    messages.length > 0 && selectedMessageCount === messages.length;

  useEffect(() => {
    if (
      initialFocusAppliedRef.current ||
      controller.state.status !== 'selecting'
    ) {
      return;
    }

    const selectedMessageId = controller.state.selection.messageIds[0];
    const selectedContextId =
      controller.state.selection.frozenContextItemIds[0];
    const initialTarget = selectedMessageId
      ? sourceRefs.current.get(
          knowledgeExtractionSourceRefKey('message', selectedMessageId),
        )
      : selectedContextId
        ? sourceRefs.current.get(
            knowledgeExtractionSourceRefKey(
              'frozen_context',
              selectedContextId,
            ),
          )
        : messages[0]
          ? sourceRefs.current.get(
              knowledgeExtractionSourceRefKey('message', messages[0].id),
            )
          : sourceRefs.current.get(
              knowledgeExtractionSourceRefKey(
                'frozen_context',
                contextItems[0]?.id ?? '',
              ),
            );

    if (initialTarget) {
      initialFocusAppliedRef.current = true;
      initialTarget.focus();
    }
  }, [
    contextItems,
    controller.state.selection.frozenContextItemIds,
    controller.state.selection.messageIds,
    controller.state.status,
    messages,
  ]);

  useEffect(() => {
    if (
      controller.state.status !== 'source_invalid' ||
      issues.length === 0
    ) {
      return;
    }

    const firstIssue = issues[0];
    sourceRefs.current
      .get(
        knowledgeExtractionSourceRefKey(
          firstIssue.sourceKind,
          firstIssue.sourceId,
        ),
      )
      ?.focus();
  }, [controller.state.status, issues]);

  const registerSource =
    (
      sourceKind: KnowledgeExtractionSourceIssue['sourceKind'],
      sourceId: string,
    ) =>
    (element: HTMLButtonElement | null) => {
      const key = knowledgeExtractionSourceRefKey(sourceKind, sourceId);

      if (element) {
        sourceRefs.current.set(key, element);
      } else {
        sourceRefs.current.delete(key);
      }
    };

  const instructionDescriptionIds = [
    instructionsHelpId,
    fieldErrors.instructions ? instructionsErrorId : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      className="mx-auto flex w-full max-w-[900px] flex-col gap-5"
      aria-label="Extraction request"
      data-knowledge-extraction-status={controller.state.status}
    >
      {failure && (
        <div
          className="rounded-xl border border-[#e8c4c0] bg-[#fff8f7] px-3.5 py-3 text-[#8f3f3a]"
          id={errorId}
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
                {failure.kind === 'generation'
                  ? 'Bubble generation failed'
                  : 'Review the extraction request'}
              </span>
              <span className="mt-0.5 block text-[11px] leading-[1.5] text-[#a25a55]">
                {failure.message}
              </span>
            </span>
          </span>
        </div>
      )}

      <section aria-labelledby={`${detailGroupId}-sources`}>
        <div className="flex flex-wrap items-center gap-2">
          <StepHeading
            number={1}
            aside={
              <span
                className="rounded-md bg-[#f1f3f7] px-2 py-1 text-[9px] font-semibold tracking-[0.06em] text-[#8b97a8] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace]"
                aria-live="polite"
                role="status"
              >
                {selectedMessageCount} of {messages.length} messages
              </span>
            }
          >
            <span id={`${detailGroupId}-sources`}>What to include</span>
          </StepHeading>
          <button
            className={`ml-auto cursor-pointer rounded-md px-1 py-0.5 text-[11px] font-semibold text-[#4267ad] hover:text-[#2f518f] disabled:cursor-not-allowed disabled:text-[#a8b1bf] ${focusRing}`}
            type="button"
            disabled={controlsDisabled || messages.length === 0}
            onClick={() =>
              controller.selectAllMessages(
                allMessagesSelected ? [] : eligibleMessageIds,
              )
            }
          >
            {allMessagesSelected ? 'Clear all' : 'Select all'}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-[#8a98ac]">
          Only what you pick is sent. The rest of the thread stays as history.
        </p>
        {messages.length > 0 ? (
          <div
            className={`mt-3 max-h-56 overflow-y-auto rounded-xl border bg-white ${
              fieldErrors.message_ids
                ? 'border-[#d9918b]'
                : 'border-[#dbe3ed]'
            }`}
            aria-describedby={
              fieldErrors.message_ids ? sourcesErrorId : undefined
            }
            aria-label="Discussion messages available for extraction"
            role="group"
          >
            {messages.map((message) => (
              <MessageSource
                controller={controller}
                disabled={controlsDisabled}
                errorId={errorId}
                extractingFrom={
                  controller.state.initialMessageId === message.id
                }
                issue={sourceIssue(issues, 'message', message.id)}
                key={message.id}
                message={message}
                setSourceRef={registerSource('message', message.id)}
                threadPosition={
                  discussion.messages.findIndex(
                    (candidate) => candidate.id === message.id,
                  ) + 1
                }
              />
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-[#e1e6ec] bg-[#f8f9fb] px-4 py-3 text-[11px] text-[#8692a2]">
            No completed messages are available.
          </p>
        )}
        <FieldError
          id={sourcesErrorId}
          message={fieldErrors.message_ids}
        />

        {contextItems.length > 0 && (
          <div
            className="mt-4 space-y-2.5 border-t border-[#e3e8ef] pt-4"
            aria-labelledby={`${detailGroupId}-context`}
            role="group"
          >
            <div>
              <h4
                className="flex items-center gap-1.5 text-[11px] font-semibold text-[#465568]"
                id={`${detailGroupId}-context`}
              >
                <LockKeyhole
                  className="size-3.5 text-[#6f80a0]"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
                Frozen context snapshots
              </h4>
              <p className="mt-1 text-[10.5px] leading-[1.45] text-[#8490a0]">
                Stored copies attached when this discussion started.
              </p>
            </div>
            {contextItems.map((item) => (
              <FrozenContextSource
                controller={controller}
                disabled={controlsDisabled}
                errorId={errorId}
                issue={sourceIssue(issues, 'frozen_context', item.id)}
                item={item}
                key={item.id}
                setSourceRef={registerSource('frozen_context', item.id)}
              />
            ))}
            <FieldError
              id={`${sourcesErrorId}-context`}
              message={fieldErrors.frozen_context_item_ids}
            />
          </div>
        )}
      </section>

      <section aria-labelledby={`${instructionsId}-title`}>
        <StepHeading
          number={2}
          aside={
            <span className="text-[10px] font-medium text-[#92a0b2]">
              optional
            </span>
          }
        >
          <span id={`${instructionsId}-title`}>Instructions</span>
        </StepHeading>
        <label
          className="mt-1 block text-[11px] text-[#8a98ac]"
          htmlFor={instructionsId}
          id={instructionsHelpId}
        >
          Tell Nuée what this bubble is for, or what to leave out.
        </label>
        <textarea
          className={`mt-3 min-h-24 w-full resize-y rounded-xl border bg-white px-3.5 py-3 text-[12.5px] leading-[1.55] text-[#263142] outline-none placeholder:text-[#a6b0bd] focus:border-[#4267ad] focus:ring-3 focus:ring-[#4267ad]/12 disabled:cursor-not-allowed disabled:bg-[#f7f8fa] ${
            fieldErrors.instructions
              ? 'border-[#d9918b]'
              : 'border-[#d7e0eb]'
          }`}
          aria-describedby={instructionDescriptionIds}
          aria-invalid={fieldErrors.instructions ? 'true' : undefined}
          disabled={controlsDisabled}
          id={instructionsId}
          maxLength={INSTRUCTIONS_MAX_LENGTH}
          onChange={(event) =>
            controller.setInstructions(event.target.value)
          }
          placeholder="Add framing, emphasis, or omissions…"
          rows={3}
          value={controller.state.selection.instructions}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[8.5px] font-semibold tracking-[0.08em] text-[#a0aaba] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
            Try
          </span>
          {instructionPresets.map((preset) => (
            <button
              className={`cursor-pointer rounded-lg border border-[#dbe3ed] bg-[#f7f9fc] px-2.5 py-1 text-[10.5px] text-[#68778d] hover:border-[#bdcbe0] hover:bg-[#eef3fb] disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`}
              type="button"
              disabled={controlsDisabled}
              key={preset}
              onClick={() => controller.setInstructions(preset)}
            >
              {preset}
            </button>
          ))}
          <span className="ml-auto text-[9px] text-[#a0aaba] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
            {controller.state.selection.instructions.length}/
            {INSTRUCTIONS_MAX_LENGTH}
          </span>
        </div>
        <FieldError
          id={instructionsErrorId}
          message={fieldErrors.instructions}
        />
      </section>

      <fieldset
        className="min-w-0"
        aria-describedby={
          fieldErrors.detail_level ? detailErrorId : undefined
        }
        aria-invalid={fieldErrors.detail_level ? 'true' : undefined}
        disabled={controlsDisabled}
      >
        <legend className="sr-only">How much detail</legend>
        <StepHeading number={3}>
          <span id={detailGroupId}>How much detail</span>
        </StepHeading>
        <p className="mt-1 text-[11px] text-[#8a98ac]">
          Changes the bubble&apos;s content only — the title and summary stay
          short either way.
        </p>
        <div
          className="mt-3 grid gap-2.5 sm:grid-cols-3"
          aria-labelledby={detailGroupId}
          role="radiogroup"
        >
          {detailOptions.map((option, index) => {
            const selected =
              controller.state.selection.detailLevel === option.level;

            return (
              <label
                className={`relative flex min-h-32 cursor-pointer flex-col rounded-xl border p-3.5 transition-[border-color,background-color,box-shadow] motion-reduce:transition-none ${
                  selected
                    ? 'border-[#4267ad] bg-[#f3f6fc] shadow-[0_0_0_3px_rgba(66,103,173,0.1)]'
                    : 'border-[#dbe3ed] bg-white hover:border-[#bdcbe0]'
                } focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[#3f63a8]/30`}
                key={option.level}
              >
                <input
                  className="sr-only"
                  checked={selected}
                  name={detailGroupId}
                  onChange={() => controller.setDetailLevel(option.level)}
                  type="radio"
                  value={option.level}
                />
                <span
                  className={`mb-4 flex h-3 w-4 flex-col justify-between ${
                    selected ? 'text-[#4267ad]' : 'text-[#94a1b2]'
                  }`}
                  aria-hidden="true"
                >
                  {Array.from({ length: index + 1 }, (_, lineIndex) => (
                    <span
                      className="block h-px rounded-full bg-current"
                      key={lineIndex}
                    />
                  ))}
                </span>
                <span className="text-[12.5px] font-semibold text-[#273142]">
                  {option.label}
                </span>
                <span className="mt-1 text-[10.5px] leading-[1.45] text-[#8190a4]">
                  {option.description}
                </span>
                <span
                  className={`mt-auto pt-3 text-[9px] font-semibold tracking-[0.06em] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${
                    selected ? 'text-[#5274b5]' : 'text-[#a2adbb]'
                  }`}
                >
                  {option.length}
                </span>
              </label>
            );
          })}
        </div>
        <FieldError
          id={detailErrorId}
          message={fieldErrors.detail_level}
        />
      </fieldset>
    </section>
  );
}

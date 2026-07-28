import {
  useId,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { ArrowUp } from 'lucide-react';

const focusRing =
  '[-webkit-tap-highlight-color:transparent] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/30';

export interface DiscussionComposerProps {
  disabled?: boolean;
  error?: string | null;
  isInitialPrompt?: boolean;
  isSubmitting: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  value: string;
}

export function DiscussionComposer({
  disabled = false,
  error,
  isInitialPrompt = false,
  isSubmitting,
  onChange,
  onSubmit,
  value,
}: DiscussionComposerProps) {
  const composerId = useId();
  const statusId = useId();
  const normalizedValue = value.trim();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!disabled && !isSubmitting && normalizedValue.length > 0) {
      onSubmit();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <form
      className="shrink-0 border-t border-[#eef1f5] bg-white p-3.5 sm:p-4"
      onSubmit={submit}
    >
      <label className="sr-only" htmlFor={composerId}>
        {isInitialPrompt ? 'Discussion prompt' : 'Discussion message'}
      </label>
      <div className="flex items-end gap-2 rounded-xl border border-[#d7dee7] bg-white p-2 shadow-[0_1px_2px_rgba(30,39,51,0.04)] focus-within:border-[#3f63a8] focus-within:ring-3 focus-within:ring-[#3f63a8]/10">
        <textarea
          aria-describedby={error || isSubmitting ? statusId : undefined}
          className="max-h-40 min-h-[42px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[13px] leading-[1.5] text-[#1e2733] outline-none placeholder:text-[#a7b1be] disabled:cursor-not-allowed disabled:text-[#7f8b99]"
          disabled={disabled || isSubmitting}
          id={composerId}
          name="message"
          placeholder={
            disabled
              ? 'Resolve the unanswered message first'
              : isInitialPrompt
                ? 'What do you want to understand?'
                : 'Ask a focused follow-up'
          }
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className={`grid size-9 shrink-0 place-items-center rounded-[9px] bg-[#3f63a8] text-white shadow-[0_5px_12px_-7px_rgba(63,99,168,0.8)] hover:bg-[#33538f] disabled:cursor-not-allowed disabled:bg-[#c6cfda] disabled:shadow-none ${focusRing}`}
          type="submit"
          aria-label={
            isSubmitting
              ? 'Waiting for response'
              : isInitialPrompt
                ? 'Continue discussion'
                : 'Send message'
          }
          disabled={
            disabled || isSubmitting || normalizedValue.length === 0
          }
          title={isSubmitting ? 'Waiting for response' : 'Send'}
        >
          <ArrowUp
            className="size-[16px]"
            strokeWidth={2}
            aria-hidden="true"
          />
        </button>
      </div>
      {(error || isSubmitting) && (
        <p
          className={`mt-2 px-1 text-[11.5px] ${
            error ? 'text-[#a64540]' : 'text-[#728096]'
          }`}
          id={statusId}
          role={error ? 'alert' : 'status'}
        >
          {error ?? 'Generating a focused response…'}
        </p>
      )}
    </form>
  );
}

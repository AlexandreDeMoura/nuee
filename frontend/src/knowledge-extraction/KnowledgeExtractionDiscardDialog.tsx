import { useEffect, useId, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { focusRing } from '../ui/focusRing';

export interface KnowledgeExtractionDiscardDialogProps {
  onCancel: () => void;
  onConfirm: () => void;
}

export function KnowledgeExtractionDiscardDialog({
  onCancel,
  onConfirm,
}: KnowledgeExtractionDiscardDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    cancelButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Tab') {
        return;
      }

      event.stopImmediatePropagation();

      if (event.key === 'Escape') {
        event.preventDefault();
        onCancelRef.current();
        return;
      }

      const focusableElements = dialogRef.current
        ? Array.from(
            dialogRef.current.querySelectorAll<HTMLElement>(
              'button:not(:disabled), [tabindex]:not([tabindex="-1"])',
            ),
          )
        : [];

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);

      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1e2733]/45 p-4 backdrop-blur-[1.5px]"
      data-knowledge-extraction-discard-overlay
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="w-full max-w-[472px] overflow-hidden rounded-2xl border border-[#e1e6ec] bg-white shadow-[0_24px_60px_-18px_rgba(20,28,40,0.55)]"
        ref={dialogRef}
        role="alertdialog"
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        tabIndex={-1}
      >
        <div className="flex gap-3.5 px-5 pt-5 pb-[18px] sm:px-[22px]">
          <span className="grid size-[38px] shrink-0 place-items-center rounded-[10px] bg-[#fbf1f0] text-[#b4544e]">
            <Trash2
              className="size-[19px]"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0">
            <h2
              className="m-0 text-[15px] leading-[1.4] font-semibold text-[#1e2733]"
              id={titleId}
            >
              Discard this knowledge proposal?
            </h2>
            <p
              className="mt-1.5 mb-0 text-[12.5px] leading-[1.55] text-[#5c6a7a]"
              id={descriptionId}
            >
              The generated proposal and your review edits will be lost. No
              bubble will be created or updated, and this proposal won&apos;t
              be restored later.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2.5 border-t border-[#eef1f5] bg-[#fafbfc] px-5 py-3.5 sm:px-[22px]">
          <button
            className={`min-h-9 rounded-[9px] border border-[#e1e6ec] bg-white px-[15px] py-2 text-[12.5px] font-semibold text-[#5c6a7a] hover:bg-[#f6f8fc] ${focusRing}`}
            type="button"
            onClick={onCancel}
            ref={cancelButtonRef}
          >
            Keep reviewing
          </button>
          <button
            className={`min-h-9 rounded-[9px] bg-[#b4544e] px-[18px] py-2 text-[12.5px] font-semibold text-white hover:bg-[#9d443f] ${focusRing}`}
            type="button"
            onClick={onConfirm}
          >
            Discard proposal
          </button>
        </div>
      </div>
    </div>
  );
}

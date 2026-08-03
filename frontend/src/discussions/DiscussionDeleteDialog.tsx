import { useEffect, useId, useRef } from 'react';
import { CircleAlert, LoaderCircle, Trash2 } from 'lucide-react';
import { focusRing } from '../ui/focusRing';

export interface DiscussionDeleteTarget {
  id: string;
  title: string;
}

export interface DiscussionDeleteDialogProps {
  error: string | null;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  target: DiscussionDeleteTarget;
}

export function DiscussionDeleteDialog({
  error,
  isDeleting,
  onCancel,
  onConfirm,
  target,
}: DiscussionDeleteDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const isDeletingRef = useRef(isDeleting);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    isDeletingRef.current = isDeleting;
  }, [isDeleting]);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = 'hidden';
    cancelButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Tab') {
        return;
      }

      event.stopImmediatePropagation();

      if (event.key === 'Escape') {
        event.preventDefault();

        if (!isDeletingRef.current) {
          onCancelRef.current();
        }

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
      document.body.style.overflow = previousOverflow;

      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [target.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1e2733]/45 p-4 backdrop-blur-[1.5px]"
      data-discussion-delete-overlay
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          !isDeletingRef.current
        ) {
          onCancel();
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="w-full max-w-[472px] overflow-hidden rounded-2xl border border-[#e1e6ec] bg-white shadow-[0_24px_60px_-18px_rgba(20,28,40,0.55)]"
        ref={dialogRef}
        role="alertdialog"
        aria-busy={isDeleting}
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
              className="m-0 break-words text-[15px] leading-[1.4] font-semibold text-[#1e2733]"
              id={titleId}
            >
              Delete “{target.title}”?
            </h2>
            <p
              className="mt-1.5 mb-0 text-[12.5px] leading-[1.55] text-[#5c6a7a]"
              id={descriptionId}
            >
              Its full message history and frozen context will no longer be
              available. Bubbles already created from this discussion stay on
              the canvas with their source details preserved.
            </p>
            {error && (
              <p
                className="mt-3 mb-0 flex items-start gap-1.5 text-[11.5px] leading-[1.45] text-[#b4544e]"
                role="alert"
              >
                <CircleAlert
                  className="mt-px size-[13px] shrink-0"
                  strokeWidth={1.9}
                  aria-hidden="true"
                />
                {error}
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2.5 border-t border-[#eef1f5] bg-[#fafbfc] px-5 py-3.5 sm:px-[22px]">
          <button
            className={`min-h-9 rounded-[9px] border border-[#e1e6ec] bg-white px-[15px] py-2 text-[12.5px] font-semibold text-[#5c6a7a] disabled:cursor-not-allowed disabled:text-[#b6c0cc] ${focusRing}`}
            type="button"
            disabled={isDeleting}
            onClick={onCancel}
            ref={cancelButtonRef}
          >
            Cancel
          </button>
          <button
            className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[9px] bg-[#b4544e] px-[18px] py-2 text-[12.5px] font-semibold text-white hover:bg-[#9d443f] disabled:cursor-wait disabled:bg-[#cf8d88] ${focusRing}`}
            type="button"
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {isDeleting && (
              <LoaderCircle
                className="size-3 animate-spin motion-reduce:animate-none"
                strokeWidth={1.8}
                aria-hidden="true"
              />
            )}
            {isDeleting ? 'Deleting…' : 'Delete discussion'}
          </button>
        </div>
      </div>
    </div>
  );
}

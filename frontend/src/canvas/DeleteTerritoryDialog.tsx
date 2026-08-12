import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, LoaderCircle, Trash2 } from 'lucide-react';
import {
  deleteTerritory,
  type DeleteTerritoryResponse,
  type Territory,
  type TerritoryDeleteRequest,
} from '../api';
import { focusRing } from '../ui/focusRing';
import { useModalShell } from '../ui/useModalShell';

interface DeleteTerritoryDialogProps {
  bubbleCount: number;
  onCancel: () => void;
  onDeleted: (response: DeleteTerritoryResponse) => void;
  requestDelete?: TerritoryDeleteRequest;
  territory: Territory;
}

function consequenceCopy(bubbleCount: number) {
  if (bubbleCount === 0) {
    return 'This territory is empty. Deleting it removes only the territory.';
  }

  const preservationCopy =
    bubbleCount === 1
      ? 'Its content, links, and sources will stay intact.'
      : 'Their content, links, and sources will stay intact.';

  return `${bubbleCount} ${bubbleCount === 1 ? 'bubble' : 'bubbles'} will move to Ungrouped. ${preservationCopy}`;
}

export function DeleteTerritoryDialog({
  bubbleCount,
  onCancel,
  onDeleted,
  requestDelete = deleteTerritory,
  territory,
}: DeleteTerritoryDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [hasDeleteError, setHasDeleteError] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const isDeletingRef = useRef(false);
  const mountedRef = useRef(true);
  const titleId = useId();
  const descriptionId = useId();
  const { containerRef } = useModalShell<HTMLDivElement>({
    initialFocus: () => cancelButtonRef.current,
    onEscape: () => {
      if (!isDeletingRef.current) {
        onCancel();
      }
    },
  });

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  function cancelFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && !isDeletingRef.current) {
      onCancel();
    }
  }

  async function confirmDelete() {
    if (isDeletingRef.current) {
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    isDeletingRef.current = true;
    setIsDeleting(true);
    setHasDeleteError(false);

    try {
      const response = await requestDelete(
        territory.project_id,
        territory.id,
        controller.signal,
      );

      if (!mountedRef.current || controller.signal.aborted) {
        return;
      }

      onDeleted(response);
    } catch {
      if (!mountedRef.current || controller.signal.aborted) {
        return;
      }

      setHasDeleteError(true);
    } finally {
      if (mountedRef.current && !controller.signal.aborted) {
        controllerRef.current = null;
        isDeletingRef.current = false;
        setIsDeleting(false);
      }
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1e2733]/45 p-4 backdrop-blur-[1.5px]"
      data-canvas-overlay
      onMouseDown={cancelFromBackdrop}
    >
      <div
        className="w-full max-w-[472px] overflow-hidden rounded-2xl border border-[#e1e6ec] bg-white shadow-[0_24px_60px_-18px_rgba(20,28,40,0.55)]"
        ref={containerRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={isDeleting}
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
              Delete “{territory.title}”?
            </h2>
            <p
              className="mt-1.5 mb-0 text-[12.5px] leading-[1.55] text-[#5c6a7a]"
              id={descriptionId}
            >
              {consequenceCopy(bubbleCount)}
            </p>
            {hasDeleteError && (
              <p
                className="mt-3 mb-0 flex items-start gap-1.5 text-[11.5px] leading-[1.45] text-[#b4544e]"
                role="alert"
              >
                <CircleAlert
                  className="mt-px size-[13px] shrink-0"
                  strokeWidth={1.9}
                  aria-hidden="true"
                />
                Couldn’t delete the territory. Try again.
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
            onClick={() => void confirmDelete()}
          >
            {isDeleting && (
              <LoaderCircle
                className="size-3 animate-spin motion-reduce:animate-none"
                strokeWidth={1.8}
                aria-hidden="true"
              />
            )}
            {isDeleting ? 'Deleting…' : 'Delete territory'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

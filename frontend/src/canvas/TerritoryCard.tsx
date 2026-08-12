import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
} from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  TERRITORY_TITLE_MAX_LENGTH,
  TERRITORY_VISIBLE_COUNT_MAX,
} from '@nuee/shared-types';
import {
  Check,
  ChevronRight,
  CircleAlert,
  LoaderCircle,
  Minus,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { Bubble, Territory } from '../api';
import { focusRing } from '../ui/focusRing';
import { getBubbleCardPreview } from './bubbleCardPreview';
import { TERRITORY_CARD_WIDTH } from './compactTerritoryLayout';

export type TerritoryCardStatus = 'default' | 'dragging' | 'saving' | 'error';

export interface TerritoryCardProps {
  bubbles: readonly Bubble[];
  isMultiSelecting?: boolean;
  linkedBubbleIds?: ReadonlySet<string>;
  onBubbleActivate?: (bubble: Bubble) => void;
  onBubbleReaderOpen?: (bubble: Bubble) => void;
  onDeleteRequest?: () => void;
  onDragPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyboardMove?: (delta: { x: number; y: number }) => boolean | void;
  onRename?: (title: string, signal?: AbortSignal) => Promise<Territory>;
  onRenameSaveStatusChange?: (
    status: 'saving' | 'saved' | 'error',
  ) => void;
  onScrollUnlock?: (hiddenBubbleCount: number) => void;
  onVisibleCountChange?: (visibleCount: number) => void;
  selectedBubbleIds?: ReadonlySet<string>;
  status?: TerritoryCardStatus;
  territory: Territory;
  territoryRef?: Ref<HTMLElement>;
}

export function TerritoryCard({
  bubbles,
  isMultiSelecting = false,
  linkedBubbleIds = new Set<string>(),
  onBubbleActivate,
  onBubbleReaderOpen,
  onDeleteRequest,
  onDragPointerDown,
  onKeyboardMove,
  onRename,
  onRenameSaveStatusChange,
  onScrollUnlock,
  onVisibleCountChange,
  selectedBubbleIds = new Set<string>(),
  status = 'default',
  territory,
  territoryRef,
}: TerritoryCardProps) {
  const [unlockedListKey, setUnlockedListKey] = useState<string | null>(null);
  const [unlockedBodyHeight, setUnlockedBodyHeight] = useState<number | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(territory.title);
  const [isRenameTouched, setIsRenameTouched] = useState(false);
  const [isRenameSaving, setIsRenameSaving] = useState(false);
  const [hasRenameError, setHasRenameError] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameButtonRef = useRef<HTMLButtonElement>(null);
  const restoreRenameFocusRef = useRef(false);
  const renameControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const visibleBubbles = bubbles.slice(0, territory.visible_count);
  const hiddenBubbleCount = bubbles.length - visibleBubbles.length;
  const listKey = `${territory.visible_count}:${bubbles
    .map(({ id }) => id)
    .join(':')}`;
  const isScrollUnlocked =
    hiddenBubbleCount > 0 && unlockedListKey === listKey;
  const renderedBubbles = isScrollUnlocked ? bubbles : visibleBubbles;
  const canShowFewer = territory.visible_count > 1;
  const canShowMore =
    territory.visible_count < bubbles.length &&
    territory.visible_count < TERRITORY_VISIBLE_COUNT_MAX;
  const position: CSSProperties = {
    left: territory.position_x,
    top: territory.position_y,
    width: TERRITORY_CARD_WIDTH,
  };
  const normalizedRename = renameDraft.trim();
  const renameValidationError =
    normalizedRename.length === 0
      ? 'Enter a territory title.'
      : normalizedRename.length > TERRITORY_TITLE_MAX_LENGTH
        ? `Use ${TERRITORY_TITLE_MAX_LENGTH} characters or fewer.`
        : null;
  const showRenameValidationError =
    isRenameTouched && renameValidationError !== null;

  useEffect(() => {
    if (isScrollUnlocked) {
      bodyRef.current?.focus();
    }
  }, [isScrollUnlocked]);

  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    if (!isRenaming) {
      if (restoreRenameFocusRef.current) {
        restoreRenameFocusRef.current = false;
        renameButtonRef.current?.focus();
      }
    }
  }, [isRenaming]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      renameControllerRef.current?.abort();
    };
  }, []);

  function startRenaming() {
    setRenameDraft(territory.title);
    setIsRenameTouched(false);
    setHasRenameError(false);
    setIsRenaming(true);
  }

  function cancelRenaming() {
    if (isRenameSaving) {
      return;
    }

    setRenameDraft(territory.title);
    setIsRenameTouched(false);
    setHasRenameError(false);
    restoreRenameFocusRef.current = true;
    setIsRenaming(false);
    onRenameSaveStatusChange?.('saved');
  }

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsRenameTouched(true);

    if (renameValidationError || isRenameSaving || !onRename) {
      return;
    }

    if (normalizedRename === territory.title) {
      cancelRenaming();
      return;
    }

    const controller = new AbortController();
    renameControllerRef.current = controller;
    setIsRenameSaving(true);
    setHasRenameError(false);
    onRenameSaveStatusChange?.('saving');

    try {
      const renamedTerritory = await onRename(
        normalizedRename,
        controller.signal,
      );

      if (!mountedRef.current || controller.signal.aborted) {
        return;
      }

      setRenameDraft(renamedTerritory.title);
      restoreRenameFocusRef.current = true;
      setIsRenaming(false);
      setIsRenameTouched(false);
      onRenameSaveStatusChange?.('saved');
      setAnnouncement(`Territory renamed to ${renamedTerritory.title}.`);
    } catch {
      if (!mountedRef.current || controller.signal.aborted) {
        return;
      }

      setHasRenameError(true);
      onRenameSaveStatusChange?.('error');
    } finally {
      if (mountedRef.current && !controller.signal.aborted) {
        renameControllerRef.current = null;
        setIsRenameSaving(false);
      }
    }
  }

  function changeVisibleCount(nextCount: number) {
    onVisibleCountChange?.(nextCount);
    setAnnouncement(
      `Showing ${nextCount} of ${bubbles.length} bubbles in ${territory.title}.`,
    );
  }

  function unlockScrolling() {
    const body = bodyRef.current;
    const measuredHeight = body
      ? body.getBoundingClientRect().height || body.offsetHeight
      : 0;

    if (measuredHeight > 0) {
      setUnlockedBodyHeight(measuredHeight);
    }
    setUnlockedListKey(listKey);
    onScrollUnlock?.(hiddenBubbleCount);
    setAnnouncement(
      `Scrolling enabled for all ${bubbles.length} bubbles in ${territory.title}.`,
    );
  }

  return (
    <article
      className="pointer-events-auto absolute overflow-hidden rounded-[18px] border border-[#dce3eb] bg-white text-left shadow-[0_2px_5px_rgba(30,39,51,0.05),0_14px_32px_-18px_rgba(30,39,51,0.3)]"
      aria-labelledby={`territory-title-${territory.id}`}
      data-canvas-interactive
      data-territory-state={status}
      data-territory-id={territory.id}
      ref={territoryRef}
      style={position}
    >
      <header
        className={`flex min-h-[58px] items-center gap-4 border-b border-[#e7ebf0] px-5 py-3.5 ${focusRing} ${
          status === 'dragging' ? 'cursor-grabbing' : 'cursor-grab'
        } ${status === 'saving' ? 'opacity-75' : ''}`}
        aria-disabled={
          status === 'saving' || isMultiSelecting ? 'true' : undefined
        }
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
        aria-label={`Move ${territory.title} territory. Use the arrow keys.`}
        data-territory-drag-handle
        onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
          if (
            event.target !== event.currentTarget ||
            status === 'saving' ||
            isMultiSelecting
          ) {
            return;
          }

          const deltas: Partial<Record<string, { x: number; y: number }>> = {
            ArrowDown: { x: 0, y: 1 },
            ArrowLeft: { x: -1, y: 0 },
            ArrowRight: { x: 1, y: 0 },
            ArrowUp: { x: 0, y: -1 },
          };
          const delta = deltas[event.key];

          if (!delta) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          const didMove = onKeyboardMove?.(delta);

          if (didMove !== false) {
            setAnnouncement(`${territory.title} territory moved.`);
          }
        }}
        onPointerDown={onDragPointerDown}
        tabIndex={0}
      >
        <h2
          className={`${isRenaming ? 'sr-only' : 'min-w-0 flex-1 truncate text-[16px] font-semibold tracking-[-0.2px] text-[#1e2733]'}`}
          id={`territory-title-${territory.id}`}
        >
          {territory.title}
        </h2>

        {isRenaming && (
          <form
            className="min-w-0 flex-1"
            noValidate
            onPointerDown={(event) => event.stopPropagation()}
            onSubmit={(event) => void submitRename(event)}
          >
            <label className="sr-only" htmlFor={`territory-rename-${territory.id}`}>
              Territory title
            </label>
            <div className="flex items-center gap-1.5">
              <input
                className={`min-w-0 flex-1 rounded-[7px] border bg-white px-2.5 py-1.5 text-[13px] text-[#1e2733] disabled:cursor-wait disabled:bg-[#f6f8fb] ${
                  showRenameValidationError || hasRenameError
                    ? 'border-[#dba7a3]'
                    : 'border-[#cfd8e4]'
                } ${focusRing}`}
                id={`territory-rename-${territory.id}`}
                ref={renameInputRef}
                type="text"
                value={renameDraft}
                disabled={isRenameSaving}
                aria-invalid={showRenameValidationError || hasRenameError}
                aria-describedby={
                  showRenameValidationError || hasRenameError
                    ? `territory-rename-error-${territory.id}`
                    : undefined
                }
                onBlur={() => setIsRenameTouched(true)}
                onChange={(event) => {
                  setRenameDraft(event.target.value);
                  setHasRenameError(false);
                  if (hasRenameError) {
                    onRenameSaveStatusChange?.('saved');
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelRenaming();
                  }
                }}
              />
              <button
                className={`grid size-8 shrink-0 place-items-center rounded-[7px] text-[#526985] hover:bg-[#edf1f6] disabled:cursor-wait disabled:opacity-60 ${focusRing}`}
                type="submit"
                aria-label={`Save territory title for ${territory.title}`}
                disabled={isRenameSaving}
              >
                {isRenameSaving ? (
                  <LoaderCircle
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                ) : (
                  <Check className="size-3.5" strokeWidth={2} aria-hidden="true" />
                )}
              </button>
              <button
                className={`grid size-8 shrink-0 place-items-center rounded-[7px] text-[#8090a3] hover:bg-[#edf1f6] hover:text-[#526985] disabled:cursor-wait disabled:opacity-60 ${focusRing}`}
                type="button"
                aria-label="Cancel territory rename"
                disabled={isRenameSaving}
                onClick={cancelRenaming}
              >
                <X className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
              </button>
            </div>
            {(showRenameValidationError || hasRenameError) && (
              <p
                className="mt-1 mb-0 flex items-center gap-1 text-[10.5px] leading-[1.35] text-[#b4544e]"
                id={`territory-rename-error-${territory.id}`}
                role={hasRenameError ? 'alert' : undefined}
              >
                <CircleAlert className="size-3 shrink-0" aria-hidden="true" />
                {hasRenameError
                  ? 'Couldn’t rename the territory. Try again.'
                  : renameValidationError}
              </p>
            )}
          </form>
        )}

        {!isRenaming && territory.kind === 'manual' && onRename && (
          <button
            className={`grid size-8 shrink-0 place-items-center rounded-[8px] text-[#8795a7] hover:bg-[#edf1f6] hover:text-[#526985] disabled:cursor-default disabled:opacity-45 ${focusRing}`}
            type="button"
            aria-label={`Rename ${territory.title}`}
            disabled={status === 'saving' || isMultiSelecting}
            onClick={startRenaming}
            ref={renameButtonRef}
          >
            <Pencil className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
          </button>
        )}

        {!isRenaming && territory.kind === 'manual' && onDeleteRequest && (
          <button
            className={`grid size-8 shrink-0 place-items-center rounded-[8px] text-[#9b8585] hover:bg-[#fbf1f0] hover:text-[#b4544e] disabled:cursor-default disabled:opacity-45 ${focusRing}`}
            type="button"
            aria-label={`Delete ${territory.title}`}
            disabled={status === 'saving' || isMultiSelecting}
            onClick={onDeleteRequest}
          >
            <Trash2 className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
          </button>
        )}

        {!isRenaming && bubbles.length > 0 && (
          <div
            className="flex h-8 shrink-0 items-center overflow-hidden rounded-[9px] border border-[#dfe5ec] bg-[#f6f8fb] text-[#8090a3]"
            aria-label={`Visible bubbles: ${territory.visible_count}`}
            role="group"
          >
            <button
              className={`grid h-full w-8 cursor-pointer place-items-center hover:bg-[#edf1f6] hover:text-[#526985] disabled:cursor-default disabled:text-[#aeb9c7] ${focusRing}`}
              type="button"
              aria-label={`Show fewer bubbles in ${territory.title}`}
              disabled={!canShowFewer}
              onClick={() => changeVisibleCount(territory.visible_count - 1)}
            >
              <Minus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
            </button>
            <span className="min-w-7 text-center text-xs font-medium [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
              {territory.visible_count}
            </span>
            <button
              className={`grid h-full w-8 cursor-pointer place-items-center hover:bg-[#edf1f6] hover:text-[#526985] disabled:cursor-default disabled:text-[#aeb9c7] ${focusRing}`}
              type="button"
              aria-label={`Show more bubbles in ${territory.title}`}
              disabled={!canShowMore}
              onClick={() => changeVisibleCount(territory.visible_count + 1)}
            >
              <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        )}

        <span
          className="w-7 shrink-0 text-right text-[11px] text-[#9aa6b4] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]"
          aria-label={`${bubbles.length} bubbles total`}
        >
          {bubbles.length}
        </span>
      </header>

      <div
        className={`px-5 pt-2.5 pb-3 ${
          isScrollUnlocked
            ? 'scrollbar-subtle overflow-y-auto overscroll-contain'
            : 'overflow-hidden'
        }`}
        aria-label={
          isScrollUnlocked
            ? `All bubbles in ${territory.title}`
            : undefined
        }
        data-canvas-scroll-region={isScrollUnlocked ? 'true' : undefined}
        onPointerDown={(event) => {
          if (isScrollUnlocked) {
            event.stopPropagation();
          }
        }}
        ref={bodyRef}
        role={isScrollUnlocked ? 'region' : undefined}
        style={
          isScrollUnlocked
            ? {
                height: unlockedBodyHeight ?? undefined,
                touchAction: 'pan-y',
              }
            : undefined
        }
        tabIndex={isScrollUnlocked ? 0 : undefined}
      >
        {bubbles.length === 0 && (
          <p
            className="m-0 py-5 text-center text-[12.5px] leading-[1.5] text-[#8b97a6]"
            aria-label="This territory doesn’t hold any bubbles yet."
            role="status"
          >
            This territory doesn’t hold any bubbles yet.
          </p>
        )}
        <ul className="m-0 list-none p-0">
          {renderedBubbles.map((bubble) => (
            <li
              className={`group relative flex min-h-[58px] cursor-pointer items-start gap-3 rounded-[9px] py-2.5 pr-1 transition-colors motion-reduce:transition-none ${focusRing} ${
                selectedBubbleIds.has(bubble.id)
                  ? 'bg-[#eef3fb]'
                  : linkedBubbleIds.has(bubble.id)
                    ? 'bg-[#f5f8fd]'
                    : 'hover:bg-[#f8fafc]'
              }`}
              aria-checked={
                isMultiSelecting
                  ? selectedBubbleIds.has(bubble.id)
                  : undefined
              }
              aria-label={bubble.title}
              data-bubble-id={bubble.id}
              data-bubble-linked={
                linkedBubbleIds.has(bubble.id) ? 'true' : 'false'
              }
              data-bubble-selected={
                selectedBubbleIds.has(bubble.id) ? 'true' : 'false'
              }
              key={bubble.id}
              onClick={() => onBubbleActivate?.(bubble)}
              onKeyDown={(event: KeyboardEvent<HTMLLIElement>) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onBubbleActivate?.(bubble);
                }
              }}
              role={isMultiSelecting ? 'checkbox' : 'article'}
              tabIndex={0}
            >
              {isMultiSelecting && (
                <span
                  className={`absolute top-1 -left-3 grid size-5 place-items-center rounded-full border-2 border-white shadow-[0_2px_6px_rgba(30,39,51,0.16)] ${
                    selectedBubbleIds.has(bubble.id)
                      ? 'bg-[#3f63a8] text-white'
                      : 'bg-[#d7dee7] text-transparent'
                  }`}
                  aria-hidden="true"
                >
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
              )}
              <button
                className={`mt-0.5 grid size-6 shrink-0 cursor-pointer place-items-center rounded-[7px] border border-[#dbe3ec] bg-[#eef3f8] text-[#70829a] hover:border-[#bdcad8] hover:bg-[#e5edf6] disabled:cursor-default disabled:opacity-50 ${focusRing}`}
                type="button"
                aria-label={`Open ${bubble.title}`}
                disabled={isMultiSelecting}
                onClick={(event) => {
                  event.stopPropagation();
                  onBubbleReaderOpen?.(bubble);
                }}
              >
                <ChevronRight
                  className="size-3.5"
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </button>
              <p className="m-0 min-w-0 flex-1 text-[14px] leading-[1.55] text-[#34445a]">
                {getBubbleCardPreview(bubble)}
              </p>
            </li>
          ))}
        </ul>

        {hiddenBubbleCount > 0 && !isScrollUnlocked && (
          <button
            className={`ml-8 cursor-pointer rounded px-1 py-1 text-[12px] font-medium text-[#8192a8] hover:text-[#526985] ${focusRing}`}
            type="button"
            aria-label={`${hiddenBubbleCount} more bubbles in ${territory.title}`}
            onClick={unlockScrolling}
          >
            + {hiddenBubbleCount} more{' '}
            {hiddenBubbleCount === 1 ? 'bubble' : 'bubbles'}
          </button>
        )}
      </div>
      <span className="sr-only" aria-atomic="true" aria-live="polite" role="status">
        {announcement}
      </span>
    </article>
  );
}

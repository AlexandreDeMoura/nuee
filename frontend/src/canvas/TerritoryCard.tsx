import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
} from 'react';
import { useRef, useState } from 'react';
import { TERRITORY_VISIBLE_COUNT_MAX } from '@nuee/shared-types';
import { Check, ChevronRight, Minus, Plus } from 'lucide-react';
import type { Bubble, Territory } from '../api';
import { getBubbleCardPreview } from './bubbleCardPreview';
import { TERRITORY_CARD_WIDTH } from './compactTerritoryLayout';

export type TerritoryCardStatus = 'default' | 'dragging' | 'saving' | 'error';

export interface TerritoryCardProps {
  bubbles: readonly Bubble[];
  isMultiSelecting?: boolean;
  linkedBubbleIds?: ReadonlySet<string>;
  onBubbleActivate?: (bubble: Bubble) => void;
  onBubbleReaderOpen?: (bubble: Bubble) => void;
  onDragPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
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
  onDragPointerDown,
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
  const bodyRef = useRef<HTMLDivElement>(null);
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
        className={`flex min-h-[58px] items-center gap-4 border-b border-[#e7ebf0] px-5 py-3.5 ${
          status === 'dragging' ? 'cursor-grabbing' : 'cursor-grab'
        } ${status === 'saving' ? 'opacity-75' : ''}`}
        data-territory-drag-handle
        onPointerDown={onDragPointerDown}
      >
        <h2
          className="min-w-0 flex-1 truncate text-[16px] font-semibold tracking-[-0.2px] text-[#1e2733]"
          id={`territory-title-${territory.id}`}
        >
          {territory.title}
        </h2>

        <div
          className="flex h-8 shrink-0 items-center overflow-hidden rounded-[9px] border border-[#dfe5ec] bg-[#f6f8fb] text-[#8090a3]"
          aria-label={`Visible bubbles: ${territory.visible_count}`}
          role="group"
        >
          <button
            className="grid h-full w-8 cursor-pointer place-items-center hover:bg-[#edf1f6] hover:text-[#526985] disabled:cursor-default disabled:text-[#aeb9c7]"
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
            className="grid h-full w-8 cursor-pointer place-items-center hover:bg-[#edf1f6] hover:text-[#526985] disabled:cursor-default disabled:text-[#aeb9c7]"
            type="button"
            aria-label={`Show more bubbles in ${territory.title}`}
            disabled={!canShowMore}
            onClick={() => changeVisibleCount(territory.visible_count + 1)}
          >
            <Plus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>

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
        <ul className="m-0 list-none p-0">
          {renderedBubbles.map((bubble) => (
            <li
              className={`group relative flex min-h-[58px] cursor-pointer items-start gap-3 rounded-[9px] py-2.5 pr-1 transition-colors motion-reduce:transition-none ${
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
                className="mt-0.5 grid size-6 shrink-0 cursor-pointer place-items-center rounded-[7px] border border-[#dbe3ec] bg-[#eef3f8] text-[#70829a] hover:border-[#bdcad8] hover:bg-[#e5edf6] disabled:cursor-default disabled:opacity-50"
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
            className="ml-8 cursor-pointer rounded px-1 py-1 text-[12px] font-medium text-[#8192a8] hover:text-[#526985] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/25"
            type="button"
            aria-label={`${hiddenBubbleCount} more bubbles in ${territory.title}`}
            onClick={unlockScrolling}
          >
            + {hiddenBubbleCount} more{' '}
            {hiddenBubbleCount === 1 ? 'bubble' : 'bubbles'}
          </button>
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </article>
  );
}

import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
} from 'react';
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
  onDragPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
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
  onDragPointerDown,
  selectedBubbleIds = new Set<string>(),
  status = 'default',
  territory,
  territoryRef,
}: TerritoryCardProps) {
  const visibleBubbles = bubbles.slice(0, territory.visible_count);
  const hiddenBubbleCount = bubbles.length - visibleBubbles.length;
  const position: CSSProperties = {
    left: territory.position_x,
    top: territory.position_y,
    width: TERRITORY_CARD_WIDTH,
  };

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
            className="grid h-full w-8 cursor-default place-items-center disabled:text-[#aeb9c7]"
            type="button"
            aria-label={`Show fewer bubbles in ${territory.title}`}
            disabled
          >
            <Minus className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <span className="min-w-7 text-center text-xs font-medium [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
            {territory.visible_count}
          </span>
          <button
            className="grid h-full w-8 cursor-default place-items-center disabled:text-[#aeb9c7]"
            type="button"
            aria-label={`Show more bubbles in ${territory.title}`}
            disabled
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

      <div className="px-5 pt-2.5 pb-3">
        <ul className="m-0 list-none p-0">
          {visibleBubbles.map((bubble) => (
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
                className="mt-0.5 grid size-6 shrink-0 cursor-default place-items-center rounded-[7px] border border-[#dbe3ec] bg-[#eef3f8] text-[#70829a] disabled:text-[#70829a]"
                type="button"
                aria-label={`Open ${bubble.title}`}
                disabled
                onClick={(event) => event.stopPropagation()}
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

        {hiddenBubbleCount > 0 && (
          <button
            className="ml-8 cursor-default px-1 py-1 text-[12px] font-medium text-[#9aa9bb] disabled:text-[#9aa9bb]"
            type="button"
            aria-label={`${hiddenBubbleCount} more bubbles in ${territory.title}`}
            disabled
          >
            + {hiddenBubbleCount} more{' '}
            {hiddenBubbleCount === 1 ? 'bubble' : 'bubbles'}
          </button>
        )}
      </div>
    </article>
  );
}

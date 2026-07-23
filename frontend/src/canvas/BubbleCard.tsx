import type {
  CSSProperties,
  KeyboardEventHandler,
  PointerEventHandler,
} from 'react';
import { Check } from 'lucide-react';
import type { Bubble } from '../api';
import { formatUpdatedAt } from '../utils/date';
import { getBubbleCardPreview } from './bubbleCardPreview';
import { BUBBLE_CARD_HEIGHT, BUBBLE_CARD_WIDTH } from './compactLayout';

export type BubbleCardStatus = 'default' | 'dragging' | 'saving' | 'error';

export interface BubbleCardProps {
  bubble: Bubble;
  isLinked?: boolean;
  isMultiSelecting?: boolean;
  isSelected?: boolean;
  onActivate?: () => void;
  onPointerDown?: PointerEventHandler<HTMLElement>;
  status?: BubbleCardStatus;
}

const cardStateClasses: Record<BubbleCardStatus, string> = {
  default:
    'cursor-grab border-[#e1e6ec] shadow-[0_2px_4px_rgba(30,39,51,0.05),0_12px_26px_-14px_rgba(30,39,51,0.25)] hover:-translate-y-0.5 hover:border-[#c4cfdb] hover:shadow-[0_4px_8px_rgba(30,39,51,0.07),0_18px_32px_-14px_rgba(30,39,51,0.3)]',
  dragging:
    'z-20 -translate-y-1 cursor-grabbing border-[#8da6d3] shadow-[0_0_0_3px_rgba(63,99,168,0.1),0_22px_42px_-14px_rgba(63,99,168,0.42)]',
  saving:
    'cursor-wait border-[#a9bde0] opacity-85 shadow-[0_0_0_3px_rgba(63,99,168,0.07),0_12px_26px_-14px_rgba(30,39,51,0.25)]',
  error:
    'cursor-grab border-[#d7a9a4] shadow-[0_0_0_3px_rgba(180,84,78,0.08),0_12px_26px_-14px_rgba(30,39,51,0.25)]',
};

const stateLabels: Record<BubbleCardStatus, string> = {
  default: 'BUBBLE',
  dragging: 'MOVING',
  saving: 'SAVING',
  error: 'SAVE FAILED',
};

export function BubbleCard({
  bubble,
  isLinked = false,
  isMultiSelecting = false,
  isSelected = false,
  onActivate,
  onPointerDown,
  status = 'default',
}: BubbleCardProps) {
  const position: CSSProperties = {
    height: BUBBLE_CARD_HEIGHT,
    left: bubble.position_x,
    top: bubble.position_y,
    width: BUBBLE_CARD_WIDTH,
  };
  const stateLabel =
    status === 'default' && isSelected
      ? 'SELECTED'
      : status === 'default' && isLinked
        ? 'LINKED'
        : stateLabels[status];
  const stateClasses =
    status === 'default' && isSelected
      ? `z-10 border-2 border-[#3f63a8] shadow-[0_0_0_4px_rgba(63,99,168,0.16),0_18px_38px_-12px_rgba(63,99,168,0.45)] ${
          isMultiSelecting ? 'cursor-pointer' : 'cursor-grab'
        }`
      : status === 'default' && isLinked
        ? 'z-[5] cursor-grab border-2 border-[#89a5d2] bg-[linear-gradient(180deg,#f9fbff,#f3f7fd)] shadow-[0_0_0_3px_rgba(105,137,190,0.12),0_14px_30px_-14px_rgba(63,99,168,0.3)]'
        : status === 'default' && isMultiSelecting
          ? 'cursor-pointer border-[#d7deea] opacity-90 shadow-[0_8px_20px_-14px_rgba(30,39,51,0.25)] hover:opacity-100'
      : cardStateClasses[status];
  const handleKeyDown: KeyboardEventHandler<HTMLElement> = (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && onActivate) {
      event.preventDefault();
      onActivate();
    }
  };

  return (
    <article
      className={`pointer-events-auto absolute flex flex-col rounded-[20px] border bg-[linear-gradient(180deg,#ffffff,#fbfcfe)] px-4 pt-[15px] pb-[13px] text-left transition-[border-color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none ${
        isMultiSelecting ? 'overflow-visible' : 'overflow-hidden'
      } ${stateClasses}`}
      aria-busy={status === 'saving' ? 'true' : undefined}
      aria-checked={isMultiSelecting ? isSelected : undefined}
      aria-labelledby={`bubble-title-${bubble.id}`}
      data-bubble-id={bubble.id}
      data-bubble-linked={isLinked ? 'true' : 'false'}
      data-bubble-multi-selecting={isMultiSelecting ? 'true' : 'false'}
      data-bubble-selected={isSelected ? 'true' : 'false'}
      data-bubble-state={status}
      data-canvas-interactive
      onKeyDown={handleKeyDown}
      onPointerDown={onPointerDown}
      role={isMultiSelecting ? 'checkbox' : undefined}
      style={position}
      tabIndex={0}
    >
      {isMultiSelecting && (
        <span
          className={`absolute -top-2.5 -left-2.5 grid size-6 place-items-center rounded-full border-2 shadow-[0_2px_6px_rgba(30,39,51,0.18)] ${
            isSelected
              ? 'border-white bg-[#3f63a8] text-white'
              : 'border-[#c4cdd8] bg-white text-transparent'
          }`}
          aria-hidden="true"
        >
          {isSelected && <Check className="size-3" strokeWidth={3} />}
        </span>
      )}
      <div className="mb-2 flex min-h-[18px] items-center gap-[7px]">
        <span
          className={`rounded-[5px] px-1.5 py-0.5 text-[9px] leading-[14px] font-semibold tracking-[0.1em] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${
            status === 'error'
              ? 'bg-[#f9eeee] text-[#a95f57]'
              : status === 'default' && !isSelected && !isLinked
                ? 'bg-[#f2f5f9] text-[#7b8899]'
                : isSelected && status === 'default'
                  ? 'bg-[#3f63a8] text-white'
                  : 'bg-[#eef2fa] text-[#3f63a8]'
          }`}
        >
          {stateLabel}
        </span>
        <time
          className="ml-auto text-[10px] text-[#9aa6b4] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]"
          dateTime={bubble.updated_at}
        >
          {formatUpdatedAt(bubble.updated_at)}
        </time>
      </div>

      <h3
        className="line-clamp-2 text-[14.5px] leading-[1.3] font-semibold tracking-[-0.1px] text-[#1e2733]"
        id={`bubble-title-${bubble.id}`}
      >
        {bubble.title}
      </h3>
      <p className="mt-1.5 line-clamp-3 text-[11.5px] leading-[1.5] text-[#5c6a7a]">
        {getBubbleCardPreview(bubble)}
      </p>
    </article>
  );
}

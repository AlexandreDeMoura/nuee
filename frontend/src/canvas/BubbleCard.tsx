import type {
  CSSProperties,
  KeyboardEventHandler,
  PointerEventHandler,
} from 'react';
import type { Bubble } from '../api';
import { formatUpdatedAt } from '../utils/date';
import { getBubbleCardPreview } from './bubbleCardPreview';

export type BubbleCardStatus = 'default' | 'dragging' | 'saving' | 'error';

export interface BubbleCardProps {
  bubble: Bubble;
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
  isSelected = false,
  onActivate,
  onPointerDown,
  status = 'default',
}: BubbleCardProps) {
  const position: CSSProperties = {
    left: bubble.position_x,
    top: bubble.position_y,
  };
  const stateLabel =
    status === 'default' && isSelected ? 'SELECTED' : stateLabels[status];
  const stateClasses =
    status === 'default' && isSelected
      ? 'z-10 cursor-grab border-2 border-[#3f63a8] shadow-[0_0_0_4px_rgba(63,99,168,0.16),0_18px_38px_-12px_rgba(63,99,168,0.45)]'
      : cardStateClasses[status];
  const handleKeyDown: KeyboardEventHandler<HTMLElement> = (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && onActivate) {
      event.preventDefault();
      onActivate();
    }
  };

  return (
    <article
      className={`pointer-events-auto absolute flex h-[154px] w-[248px] flex-col overflow-hidden rounded-[20px] border bg-[linear-gradient(180deg,#ffffff,#fbfcfe)] px-4 pt-[15px] pb-[13px] text-left transition-[border-color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none ${stateClasses}`}
      aria-busy={status === 'saving' ? 'true' : undefined}
      aria-labelledby={`bubble-title-${bubble.id}`}
      data-bubble-id={bubble.id}
      data-bubble-selected={isSelected ? 'true' : 'false'}
      data-bubble-state={status}
      data-canvas-interactive
      onKeyDown={handleKeyDown}
      onPointerDown={onPointerDown}
      style={position}
      tabIndex={0}
    >
      <div className="mb-2 flex min-h-[18px] items-center gap-[7px]">
        <span
          className={`rounded-[5px] px-1.5 py-0.5 text-[9px] leading-[14px] font-semibold tracking-[0.1em] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${
            status === 'error'
              ? 'bg-[#f9eeee] text-[#a95f57]'
              : status === 'default' && !isSelected
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

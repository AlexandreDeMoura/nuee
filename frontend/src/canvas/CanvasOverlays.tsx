import {
  Check,
  CircleAlert,
  CircleDot,
  CirclePlus,
  LayoutGrid,
  Minus,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { MAX_ZOOM, MIN_ZOOM } from './canvasModel';

const focusRing =
  '[-webkit-tap-highlight-color:transparent] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/30';

export function CanvasLoadingState() {
  return (
    <div
      className="pointer-events-none flex flex-col items-center justify-center text-center"
      role="status"
      aria-label="Loading canvas"
    >
      <span className="mb-3 grid size-10 place-items-center rounded-[11px] bg-white/75 text-[#6681b5] shadow-[0_1px_3px_rgba(30,39,51,0.06)]">
        <CircleDot
          className="size-[18px] animate-pulse motion-reduce:animate-none"
          strokeWidth={1.7}
          aria-hidden="true"
        />
      </span>
      <p className="text-xs font-medium text-[#7b8899]">Loading canvas…</p>
    </div>
  );
}

export function CanvasErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="pointer-events-auto flex max-w-[360px] flex-col items-center rounded-[14px] border border-[#e1e6ec] bg-white/95 px-7 py-6 text-center shadow-[0_12px_32px_-18px_rgba(30,39,51,0.35)]"
      data-canvas-overlay
      role="alert"
    >
      <span className="mb-3 grid size-10 place-items-center rounded-[11px] bg-[#f9eeee] text-[#a95f57]">
        <CircleAlert className="size-[17px]" strokeWidth={1.7} aria-hidden="true" />
      </span>
      <h2 className="text-[14px] font-semibold text-[#1e2733]">
        We couldn’t load this canvas
      </h2>
      <p className="mt-1.5 text-xs leading-[1.55] text-[#7b8899]">
        Your saved bubbles are still safe. Check your connection and try again.
      </p>
      <button
        className={`mt-4 inline-flex min-h-9 cursor-pointer items-center justify-center gap-[7px] rounded-[9px] border border-[#cdd8ea] bg-[#f6f8fc] px-3.5 py-2 text-[12.5px] font-semibold text-[#33538f] hover:border-[#aebed8] hover:bg-[#eef2fa] ${focusRing}`}
        type="button"
        onClick={onRetry}
      >
        <RotateCcw className="size-[15px]" strokeWidth={1.8} aria-hidden="true" />
        Try again
      </button>
    </div>
  );
}

export function CanvasBubbleLoadNotice({
  hasBubbles,
  isPartial,
  onRetry,
}: {
  hasBubbles: boolean;
  isPartial: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      className={`${
        hasBubbles
          ? 'pointer-events-auto absolute top-4 right-4 max-w-[350px]'
          : 'pointer-events-auto max-w-[360px]'
      } flex items-start gap-3 rounded-[12px] border border-[#ead5d2] bg-white/95 px-4 py-3.5 text-left shadow-[0_10px_28px_-16px_rgba(30,39,51,0.4)] backdrop-blur-sm`}
      data-canvas-overlay
      role="alert"
    >
      <CircleAlert
        className="mt-0.5 size-[16px] shrink-0 text-[#b4544e]"
        strokeWidth={1.8}
        aria-hidden="true"
      />
      <div>
        <p className="text-xs font-semibold text-[#704944]">
          {isPartial
            ? 'Some bubbles couldn’t be displayed.'
            : 'We couldn’t refresh your bubbles.'}
        </p>
        <p className="mt-1 text-[11.5px] leading-[1.45] text-[#8b6864]">
          {hasBubbles
            ? 'The bubbles already shown remain available.'
            : 'Your saved bubble data is still safe.'}
        </p>
        <button
          className={`mt-2.5 cursor-pointer text-[11.5px] font-semibold text-[#8f4843] hover:text-[#6f3531] ${focusRing}`}
          type="button"
          onClick={onRetry}
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export function CanvasViewportSaveError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="pointer-events-auto absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-[10px] border border-[#ead5d2] bg-white/95 px-3.5 py-2.5 text-xs text-[#79504c] shadow-[0_8px_24px_-14px_rgba(30,39,51,0.4)] backdrop-blur-sm"
      data-canvas-overlay
      role="alert"
    >
      <CircleAlert className="size-[15px] shrink-0 text-[#b4544e]" strokeWidth={1.8} aria-hidden="true" />
      <span>Couldn’t save this canvas view.</span>
      <button
        className={`cursor-pointer font-semibold text-[#8f4843] hover:text-[#6f3531] ${focusRing}`}
        type="button"
        onClick={onRetry}
      >
        Retry save
      </button>
    </div>
  );
}

export function BubblePositionSaveError({
  bubbleTitle,
  onRetry,
  onRevert,
}: {
  bubbleTitle: string;
  onRetry: () => void;
  onRevert: () => void;
}) {
  return (
    <div
      className="pointer-events-auto absolute top-4 left-4 flex max-w-[380px] items-center gap-3 rounded-[10px] border border-[#ead5d2] bg-white/95 px-3.5 py-2.5 text-xs text-[#79504c] shadow-[0_8px_24px_-14px_rgba(30,39,51,0.4)] backdrop-blur-sm"
      data-canvas-overlay
      role="alert"
    >
      <CircleAlert
        className="size-[15px] shrink-0 text-[#b4544e]"
        strokeWidth={1.8}
        aria-hidden="true"
      />
      <span>Couldn’t save “{bubbleTitle}” position.</span>
      <button
        className={`shrink-0 cursor-pointer font-semibold text-[#8f4843] hover:text-[#6f3531] ${focusRing}`}
        type="button"
        onClick={onRetry}
      >
        Retry
      </button>
      <button
        className={`shrink-0 cursor-pointer font-semibold text-[#6f7782] hover:text-[#414c59] ${focusRing}`}
        type="button"
        onClick={onRevert}
      >
        Revert
      </button>
    </div>
  );
}

export function CompactLayoutSaveError({
  onRetry,
}: {
  onRetry: () => void;
}) {
  return (
    <div
      className="pointer-events-auto absolute top-4 left-4 flex max-w-[380px] items-center gap-3 rounded-[10px] border border-[#ead5d2] bg-white/95 px-3.5 py-2.5 text-xs text-[#79504c] shadow-[0_8px_24px_-14px_rgba(30,39,51,0.4)] backdrop-blur-sm"
      data-canvas-overlay
      role="alert"
    >
      <CircleAlert
        className="size-[15px] shrink-0 text-[#b4544e]"
        strokeWidth={1.8}
        aria-hidden="true"
      />
      <span>Couldn’t save the compact layout. The previous layout was restored.</span>
      <button
        className={`shrink-0 cursor-pointer font-semibold text-[#8f4843] hover:text-[#6f3531] ${focusRing}`}
        type="button"
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  );
}

export function CanvasZoomControls({
  zoom,
  onReset,
  onZoomIn,
  onZoomOut,
}: {
  zoom: number;
  onReset: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  return (
    <div
      className="pointer-events-auto absolute bottom-4 left-4 flex items-center overflow-hidden rounded-[10px] border border-[#d7dee7] bg-white/95 shadow-[0_5px_18px_-10px_rgba(30,39,51,0.35)] backdrop-blur-sm"
      data-canvas-overlay
      aria-label="Canvas zoom controls"
      role="group"
    >
      <button
        className={`grid size-9 cursor-pointer place-items-center text-[#687789] hover:bg-[#f4f6f9] hover:text-[#33538f] disabled:cursor-default disabled:text-[#c4cdd8] ${focusRing}`}
        type="button"
        aria-label="Zoom out"
        disabled={zoom <= MIN_ZOOM}
        onClick={onZoomOut}
      >
        <Minus className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
      </button>
      <button
        className={`h-9 min-w-[58px] cursor-pointer border-x border-[#e5e9ef] px-2 text-[10.5px] font-medium text-[#687789] hover:bg-[#f4f6f9] hover:text-[#33538f] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${focusRing}`}
        type="button"
        aria-label="Reset zoom to 100%"
        onClick={onReset}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        className={`grid size-9 cursor-pointer place-items-center text-[#687789] hover:bg-[#f4f6f9] hover:text-[#33538f] disabled:cursor-default disabled:text-[#c4cdd8] ${focusRing}`}
        type="button"
        aria-label="Zoom in"
        disabled={zoom >= MAX_ZOOM}
        onClick={onZoomIn}
      >
        <Plus className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
      </button>
    </div>
  );
}

export function CanvasBubbleActions({
  canCompact,
  isCompacting,
  onCompact,
  onCreate,
}: {
  canCompact: boolean;
  isCompacting: boolean;
  onCompact: () => void;
  onCreate: () => void;
}) {
  return (
    <div
      className="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center rounded-[13px] border border-[#e1e6ec] bg-white p-1.5 shadow-[0_8px_24px_-8px_rgba(30,39,51,0.28)]"
      data-canvas-overlay
    >
      <button
        className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-[9px] px-[13px] py-2 text-[12.5px] font-medium text-[#5c6a7a] hover:bg-[#f4f6f9] hover:text-[#33538f] ${focusRing}`}
        type="button"
        aria-haspopup="dialog"
        onClick={onCreate}
      >
        <CirclePlus className="size-[15px]" strokeWidth={1.8} aria-hidden="true" />
        Bubble
      </button>
      <span className="mx-1 h-5 w-px bg-[#e1e6ec]" aria-hidden="true" />
      <button
        className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-[9px] px-[13px] py-2 text-[12.5px] font-medium text-[#5c6a7a] hover:bg-[#f4f6f9] hover:text-[#33538f] disabled:cursor-default disabled:text-[#b6c0cc] disabled:hover:bg-transparent ${focusRing}`}
        type="button"
        disabled={!canCompact}
        onClick={onCompact}
      >
        <LayoutGrid className="size-[15px]" strokeWidth={1.8} aria-hidden="true" />
        {isCompacting ? 'Compacting…' : 'Compact'}
      </button>
    </div>
  );
}

export function CanvasMultiSelectionBar({
  confirmLabel,
  instruction,
  selectedCount,
  onCancel,
  onConfirm,
}: {
  confirmLabel: string;
  instruction: string;
  selectedCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <div
        className="pointer-events-auto absolute inset-x-0 top-0 z-30 flex min-h-[52px] items-center gap-3 border-b border-[#3f63a8]/20 bg-[linear-gradient(180deg,rgba(63,99,168,0.13),rgba(238,244,250,0.88))] px-5 backdrop-blur-sm"
        data-canvas-overlay
        role="toolbar"
        aria-label="Bubble selection"
      >
        <span className="inline-flex min-w-0 items-center gap-2 text-[12.5px] font-semibold text-[#33538f]">
          <Check className="size-[15px] shrink-0" strokeWidth={2} aria-hidden="true" />
          <span className="truncate">{instruction}</span>
        </span>
        <span
          className="shrink-0 rounded-md bg-white/75 px-2 py-[3px] text-[10.5px] font-medium text-[#5c7cb5] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]"
          aria-live="polite"
        >
          {selectedCount} SELECTED
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <button
            className={`min-h-8 cursor-pointer rounded-[9px] border border-[#d3dae2] bg-white px-3.5 text-xs font-semibold text-[#5c6a7a] hover:bg-[#f6f8fc] hover:text-[#344050] ${focusRing}`}
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className={`inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-[9px] bg-[#3f63a8] px-3.5 text-xs font-semibold text-white shadow-[0_6px_16px_-8px_rgba(63,99,168,0.7)] hover:bg-[#33538f] disabled:cursor-default disabled:bg-[#aebbd1] disabled:shadow-none ${focusRing}`}
            type="button"
            aria-label={`${confirmLabel} (${selectedCount} selected)`}
            disabled={selectedCount === 0}
            onClick={onConfirm}
          >
            {confirmLabel}
            <span className="font-medium opacity-75 [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
              {selectedCount}
            </span>
          </button>
        </span>
      </div>
      <div
        className="pointer-events-none absolute bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-[10px] border border-[#d3dae2] bg-white/90 px-3.5 py-2 text-[10.5px] font-medium text-[#5c7cb5] shadow-[0_6px_18px_-10px_rgba(30,39,51,0.3)] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]"
        aria-hidden="true"
      >
        CLICK BUBBLES TO TOGGLE · ESC TO CANCEL
      </div>
    </>
  );
}


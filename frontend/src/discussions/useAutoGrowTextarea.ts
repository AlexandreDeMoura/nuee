import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Grows a textarea with its content up to `maxRows`, then hands over to
 * scrolling. Returns the ref to attach to the textarea.
 */
export function useAutoGrowTextarea(
  value: string,
  maxRows: number,
): RefObject<HTMLTextAreaElement | null> {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    const styles = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(styles.lineHeight);
    const verticalPadding =
      Number.parseFloat(styles.paddingTop) +
      Number.parseFloat(styles.paddingBottom);
    const maxHeight =
      Number.isFinite(lineHeight) && Number.isFinite(verticalPadding)
        ? lineHeight * maxRows + verticalPadding
        : Number.POSITIVE_INFINITY;

    // Collapse first so the measured content height can shrink as well as grow.
    textarea.style.height = 'auto';
    const contentHeight = textarea.scrollHeight;

    textarea.style.height = `${Math.min(contentHeight, maxHeight)}px`;
    textarea.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
  }, [maxRows, value]);

  return textareaRef;
}

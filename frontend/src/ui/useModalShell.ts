import { useCallback, useEffect, useRef } from 'react';

const focusableSelector = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface ModalShellOptions<Container extends HTMLElement> {
  /**
   * Runs on Escape. Callers own their own guards (for example, ignoring Escape
   * while a request is in flight); this is always called with fresh props.
   */
  onEscape: () => void;
  /**
   * Element to focus when the modal opens, given the container. Falls back to
   * the container itself, which needs `tabIndex={-1}` to be focusable.
   */
  initialFocus?: (container: Container | null) => HTMLElement | null | undefined;
  /** Freeze background scrolling while the modal is open. */
  lockScroll?: boolean;
  /**
   * This modal is rendered above another one. It listens in the capture phase
   * and stops Escape and Tab before the underlying modal sees them.
   */
  stacked?: boolean;
  /** Re-runs the shell — reclaiming initial focus — whenever it changes. */
  resetKey?: string | number;
  /**
   * False while the modal is not showing, for callers that keep the hook
   * mounted alongside a conditionally rendered dialog. Nothing is focused,
   * locked, or listened to until it turns true.
   */
  enabled?: boolean;
}

export interface ModalShell<Container extends HTMLElement> {
  containerRef: React.RefObject<Container | null>;
  /**
   * True from the moment teardown begins. Focus moves the shell causes while
   * closing are not user intent, so handlers that interpret focus — revealing
   * validation, most of all — must ignore them.
   */
  isClosing: () => boolean;
}

/**
 * The shared behavior of a modal dialog: initial focus, a Tab focus trap,
 * Escape, background scroll locking, and restoring focus to whatever opened it.
 *
 * Restoring focus on teardown blurs whatever the modal focused on open. Under
 * StrictMode's development remount that teardown runs immediately, so anything
 * listening to blur sees one it did not earn — hence `isClosing`.
 */
export function useModalShell<Container extends HTMLElement = HTMLDivElement>({
  onEscape,
  initialFocus,
  lockScroll = true,
  stacked = false,
  resetKey,
  enabled = true,
}: ModalShellOptions<Container>): ModalShell<Container> {
  const containerRef = useRef<Container | null>(null);
  const isClosingRef = useRef(false);
  const onEscapeRef = useRef(onEscape);
  const initialFocusRef = useRef(initialFocus);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    initialFocusRef.current = initialFocus;
  }, [initialFocus]);

  useEffect(() => {
    isClosingRef.current = false;

    if (!enabled) {
      return;
    }

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;

    if (lockScroll) {
      document.body.style.overflow = 'hidden';
    }

    (
      initialFocusRef.current?.(containerRef.current) ?? containerRef.current
    )?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Tab') {
        return;
      }

      if (stacked) {
        event.stopImmediatePropagation();
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }

      const container = containerRef.current;
      const focusableElements = container
        ? Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
        : [];

      if (focusableElements.length === 0) {
        event.preventDefault();
        container?.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const focused =
        event.target instanceof HTMLElement
          ? event.target
          : document.activeElement;

      if (event.shiftKey && focused === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, stacked);

    return () => {
      isClosingRef.current = true;
      document.removeEventListener('keydown', handleKeyDown, stacked);

      if (lockScroll) {
        document.body.style.overflow = previousOverflow;
      }

      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [enabled, lockScroll, resetKey, stacked]);

  const isClosing = useCallback(() => isClosingRef.current, []);

  return { containerRef, isClosing };
}

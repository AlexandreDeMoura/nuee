import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DiscussionComposer } from '../src/discussions';

const LINE_HEIGHT = 20;
const VERTICAL_PADDING = 16;
const THREE_ROW_HEIGHT = LINE_HEIGHT * 3 + VERTICAL_PADDING;

/**
 * jsdom performs no layout, so the composer's growth is exercised against a
 * stubbed line box: `scrollHeight` reports one line box per line of value.
 */
function stubTextareaLayout() {
  const realGetComputedStyle = window.getComputedStyle.bind(window);

  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const styles = realGetComputedStyle(element, pseudo ?? undefined);

    if (element instanceof HTMLTextAreaElement) {
      return {
        ...styles,
        lineHeight: `${LINE_HEIGHT}px`,
        paddingTop: `${VERTICAL_PADDING / 2}px`,
        paddingBottom: `${VERTICAL_PADDING / 2}px`,
      } as CSSStyleDeclaration;
    }

    return styles;
  });

  vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(
    function (this: HTMLTextAreaElement) {
      const lines = Math.max(this.value.split('\n').length, 1);

      return lines * LINE_HEIGHT + VERTICAL_PADDING;
    },
  );
}

function renderComposer(value: string) {
  render(
    <DiscussionComposer
      isSubmitting={false}
      onChange={() => {}}
      onSubmit={() => {}}
      value={value}
    />,
  );

  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

beforeEach(stubTextareaLayout);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DiscussionComposer auto-grow', () => {
  it('grows with the content instead of scrolling up to three rows', () => {
    const oneLine = renderComposer('ijij');

    expect(oneLine.style.height).toBe(`${LINE_HEIGHT + VERTICAL_PADDING}px`);
    expect(oneLine.style.overflowY).toBe('hidden');

    cleanup();

    const threeLines = renderComposer('ijij\noii\nthird');

    expect(threeLines.style.height).toBe(`${THREE_ROW_HEIGHT}px`);
    expect(threeLines.style.overflowY).toBe('hidden');
  });

  it('caps at three rows and scrolls beyond them', () => {
    const textarea = renderComposer('one\ntwo\nthree\nfour\nfive');

    expect(textarea.style.height).toBe(`${THREE_ROW_HEIGHT}px`);
    expect(textarea.style.overflowY).toBe('auto');
  });

  it('shrinks back when the value is cleared after sending', () => {
    const { rerender } = render(
      <DiscussionComposer
        isSubmitting={false}
        onChange={() => {}}
        onSubmit={() => {}}
        value={'one\ntwo\nthree\nfour'}
      />,
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

    expect(textarea.style.height).toBe(`${THREE_ROW_HEIGHT}px`);

    rerender(
      <DiscussionComposer
        isSubmitting={false}
        onChange={() => {}}
        onSubmit={() => {}}
        value=""
      />,
    );

    expect(textarea.style.height).toBe(`${LINE_HEIGHT + VERTICAL_PADDING}px`);
    expect(textarea.style.overflowY).toBe('hidden');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Bubble } from '../src/api';
import { BubbleCard, type BubbleCardStatus } from '../src/canvas/BubbleCard';
import { getBubbleCardPreview } from '../src/canvas/bubbleCardPreview';

function bubble(overrides: Partial<Bubble> = {}): Bubble {
  return {
    id: 'bubble-1',
    project_id: 'project-123',
    title: 'Last-mile is the make-or-break',
    summary: 'A supplied summary is shown on the card.',
    content: 'The content opening should only be used as a fallback.',
    position_x: 72,
    position_y: 146,
    created_at: '2026-07-19T10:00:00.000Z',
    updated_at: '2026-07-20T10:00:00.000Z',
    source_kind: 'discussion',
    source_discussion_id: 'discussion-1',
    source_message_ids: ['message-1'],
    ...overrides,
  };
}

afterEach(cleanup);

describe('BubbleCard', () => {
  it('shows the supplied summary before the bubble content', () => {
    render(<BubbleCard bubble={bubble()} />);

    expect(screen.getByText('A supplied summary is shown on the card.')).toBeTruthy();
    expect(
      screen.queryByText('The content opening should only be used as a fallback.'),
    ).toBeNull();
  });

  it('derives a normalized first-sentence preview when no summary exists', () => {
    const preview = getBubbleCardPreview({
      summary: null,
      content: '  First line\ncontinues here. A second sentence is not included.  ',
    });

    expect(preview).toBe('First line continues here.');
  });

  it('truncates a long preview deterministically at a word boundary', () => {
    const content = Array.from({ length: 60 }, () => 'knowledge').join(' ');
    const firstPreview = getBubbleCardPreview({ summary: null, content });
    const secondPreview = getBubbleCardPreview({ summary: null, content });

    expect(firstPreview).toBe(secondPreview);
    expect(firstPreview.length).toBeLessThanOrEqual(181);
    expect(firstPreview.endsWith('…')).toBe(true);
  });

  it.each<BubbleCardStatus>(['default', 'dragging', 'saving', 'error'])(
    'exposes the %s visual state for later canvas interactions',
    (status) => {
      render(<BubbleCard bubble={bubble()} status={status} />);

      const card = screen.getByRole('article', {
        name: 'Last-mile is the make-or-break',
      });

      expect(card.getAttribute('data-bubble-state')).toBe(status);
      expect(card.getAttribute('aria-busy')).toBe(
        status === 'saving' ? 'true' : null,
      );
    },
  );

  it('exposes the primary selected state and supports keyboard inspection', () => {
    const onActivate = vi.fn();
    render(
      <BubbleCard
        bubble={bubble()}
        isSelected
        onActivate={onActivate}
      />,
    );

    const card = screen.getByRole('article', {
      name: 'Last-mile is the make-or-break',
    });

    expect(card.getAttribute('data-bubble-selected')).toBe('true');
    expect(screen.getByText('SELECTED')).toBeTruthy();

    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });

    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('exposes a distinct secondary state for a directly linked bubble', () => {
    render(<BubbleCard bubble={bubble()} isLinked />);

    const card = screen.getByRole('article', {
      name: 'Last-mile is the make-or-break',
    });

    expect(card.getAttribute('data-bubble-linked')).toBe('true');
    expect(card.getAttribute('data-bubble-selected')).toBe('false');
    expect(screen.getByText('LINKED')).toBeTruthy();
  });

  it('becomes a keyboard-toggleable checkbox during multi-selection', () => {
    const onActivate = vi.fn();
    render(
      <BubbleCard
        bubble={bubble()}
        isMultiSelecting
        isSelected
        onActivate={onActivate}
      />,
    );

    const card = screen.getByRole('checkbox', {
      name: 'Last-mile is the make-or-break',
    });

    expect(card.getAttribute('aria-checked')).toBe('true');
    expect(card.getAttribute('data-bubble-multi-selecting')).toBe('true');

    fireEvent.keyDown(card, { key: ' ' });

    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});

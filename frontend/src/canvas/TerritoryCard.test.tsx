import { TERRITORY_TITLE_MAX_LENGTH } from '@nuee/shared-types';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bubble, Territory } from '../api';
import { TerritoryCard } from './TerritoryCard';

afterEach(cleanup);

function territoryFixture(overrides: Partial<Territory> = {}): Territory {
  return {
    id: 'territory-one',
    project_id: 'project-one',
    kind: 'manual',
    title: 'Operations',
    position_x: 40,
    position_y: 60,
    visible_count: 2,
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function bubbleFixture(index: number): Bubble {
  return {
    id: `bubble-${index}`,
    project_id: 'project-one',
    territory_id: 'territory-one',
    title: `Bubble ${index}`,
    summary: `Summary ${index}`,
    content: `Content ${index}`,
    created_at: `2026-08-01T10:0${index}:00.000Z`,
    updated_at: `2026-08-01T10:0${index}:00.000Z`,
    source_kind: 'manual',
    source_discussion_id: null,
    source_discussion_title: null,
    source_discussion_deleted_at: null,
    source_message_ids: [],
    source_context_item_ids: [],
  };
}

describe('TerritoryCard visible rows', () => {
  it('renames from a distinct header control with shared-limit validation and Escape cancellation', async () => {
    const renamed = territoryFixture({
      title: 'Customer research',
      updated_at: '2026-08-01T10:01:00.000Z',
    });
    const onRename = vi.fn(async () => renamed);
    const onRenameSaveStatusChange = vi.fn();

    render(
      <TerritoryCard
        bubbles={[]}
        onRename={onRename}
        onRenameSaveStatusChange={onRenameSaveStatusChange}
        territory={territoryFixture()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rename Operations' }));
    const titleInput = screen.getByRole('textbox', {
      name: 'Territory title',
    });
    expect(document.activeElement).toBe(titleInput);

    fireEvent.change(titleInput, { target: { value: '   ' } });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save territory title for Operations',
      }),
    );
    expect(screen.getByText('Enter a territory title.')).not.toBeNull();

    fireEvent.change(titleInput, {
      target: { value: 'x'.repeat(TERRITORY_TITLE_MAX_LENGTH + 1) },
    });
    expect(
      screen.getByText(
        `Use ${TERRITORY_TITLE_MAX_LENGTH} characters or fewer.`,
      ),
    ).not.toBeNull();
    expect(onRename).not.toHaveBeenCalled();

    fireEvent.keyDown(titleInput, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Territory title' })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Rename Operations' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rename Operations' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Territory title' }), {
      target: { value: '  Customer research  ' },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Save territory title for Operations',
      }),
    );

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith(
        'Customer research',
        expect.any(AbortSignal),
      );
    });
    expect(onRenameSaveStatusChange).toHaveBeenCalledWith('saving');
    expect(onRenameSaveStatusChange).toHaveBeenLastCalledWith('saved');
    expect(
      screen.getByText('Territory renamed to Customer research.'),
    ).not.toBeNull();
  });

  it('keeps a failed rename retryable and clears the save error on edit', async () => {
    const onRename = vi
      .fn<(title: string) => Promise<Territory>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(territoryFixture({ title: 'Research' }));
    const onRenameSaveStatusChange = vi.fn();

    render(
      <TerritoryCard
        bubbles={[]}
        onRename={onRename}
        onRenameSaveStatusChange={onRenameSaveStatusChange}
        territory={territoryFixture()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rename Operations' }));
    const input = screen.getByRole('textbox', { name: 'Territory title' });
    fireEvent.change(input, { target: { value: 'Research' } });
    fireEvent.submit(input.closest('form')!);

    expect(
      await screen.findByText('Couldn’t rename the territory. Try again.'),
    ).not.toBeNull();
    expect(onRenameSaveStatusChange).toHaveBeenLastCalledWith('error');

    fireEvent.change(input, { target: { value: 'Research ' } });
    expect(onRenameSaveStatusChange).toHaveBeenLastCalledWith('saved');
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(onRename).toHaveBeenCalledTimes(2));
    expect(onRenameSaveStatusChange).toHaveBeenLastCalledWith('saved');
  });

  it('offers delete only for a manual territory', () => {
    const onDeleteRequest = vi.fn();
    const onRename = vi.fn(async () => territoryFixture());
    const { rerender } = render(
      <TerritoryCard
        bubbles={[]}
        onDeleteRequest={onDeleteRequest}
        onRename={onRename}
        territory={territoryFixture()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete Operations' }));
    expect(onDeleteRequest).toHaveBeenCalledTimes(1);

    rerender(
      <TerritoryCard
        bubbles={[]}
        onDeleteRequest={onDeleteRequest}
        onRename={onRename}
        territory={territoryFixture({ kind: 'ungrouped', title: 'Ungrouped' })}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Delete Ungrouped' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename Ungrouped' })).toBeNull();
  });

  it('renders a labeled empty state without visible-count controls or a footer', () => {
    render(<TerritoryCard bubbles={[]} territory={territoryFixture()} />);

    expect(screen.getByLabelText('0 bubbles total').textContent).toBe('0');
    expect(
      screen.getByRole('status', {
        name: 'This territory doesn’t hold any bubbles yet.',
      }),
    ).not.toBeNull();
    expect(screen.queryByLabelText('Visible bubbles: 2')).toBeNull();
    expect(screen.queryByText(/more bubbles/)).toBeNull();
  });

  it('separates row selection from the reader chevron', () => {
    const bubble = bubbleFixture(1);
    const onBubbleActivate = vi.fn();
    const onBubbleReaderOpen = vi.fn();

    render(
      <TerritoryCard
        bubbles={[bubble]}
        onBubbleActivate={onBubbleActivate}
        onBubbleReaderOpen={onBubbleReaderOpen}
        territory={territoryFixture({ visible_count: 1 })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Bubble 1' }));
    expect(onBubbleReaderOpen).toHaveBeenCalledWith(bubble);
    expect(onBubbleActivate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('article', { name: 'Bubble 1' }));
    expect(onBubbleActivate).toHaveBeenCalledWith(bubble);
    expect(onBubbleReaderOpen).toHaveBeenCalledTimes(1);
  });

  it('uses the row checkbox contract and suppresses reader opening during multi-selection', () => {
    const bubble = bubbleFixture(1);
    const onBubbleActivate = vi.fn();

    render(
      <TerritoryCard
        bubbles={[bubble]}
        isMultiSelecting
        onBubbleActivate={onBubbleActivate}
        territory={territoryFixture({ visible_count: 1 })}
      />,
    );

    const row = screen.getByRole('checkbox', { name: 'Bubble 1' });
    fireEvent.click(row);

    expect(onBubbleActivate).toHaveBeenCalledWith(bubble);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Open Bubble 1' })
        .disabled,
    ).toBe(true);
  });

  it('enables bounded stepper changes and announces the optimistic count', () => {
    const onVisibleCountChange = vi.fn();
    const { rerender } = render(
      <TerritoryCard
        bubbles={[1, 2, 3, 4].map(bubbleFixture)}
        onVisibleCountChange={onVisibleCountChange}
        territory={territoryFixture()}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Show more bubbles in Operations' }),
    );
    expect(onVisibleCountChange).toHaveBeenCalledWith(3);
    expect(screen.getByText('Showing 3 of 4 bubbles in Operations.')).not.toBeNull();

    rerender(
      <TerritoryCard
        bubbles={[1, 2, 3, 4].map(bubbleFixture)}
        onVisibleCountChange={onVisibleCountChange}
        territory={territoryFixture({ visible_count: 1 })}
      />,
    );
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Show fewer bubbles in Operations',
      }).disabled,
    ).toBe(true);
  });

  it('moves from its labeled header with arrow keys without stealing stepper keys', () => {
    const onKeyboardMove = vi.fn();

    render(
      <TerritoryCard
        bubbles={[bubbleFixture(1), bubbleFixture(2)]}
        onKeyboardMove={onKeyboardMove}
        territory={territoryFixture()}
      />,
    );

    const handle = screen.getByLabelText(
      'Move Operations territory. Use the arrow keys.',
    );
    expect(handle.getAttribute('tabindex')).toBe('0');
    expect(handle.getAttribute('aria-keyshortcuts')).toContain('ArrowRight');

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onKeyboardMove).toHaveBeenCalledWith({ x: 1, y: 0 });
    expect(screen.getByRole('status').textContent).toContain(
      'Operations territory moved.',
    );

    fireEvent.keyDown(
      screen.getByRole('button', {
        name: 'Show fewer bubbles in Operations',
      }),
      { key: 'ArrowLeft' },
    );
    expect(onKeyboardMove).toHaveBeenCalledTimes(1);
  });

  it('unlocks every row inside a keyboard-scrollable body without changing its height', () => {
    const bubbles = [1, 2, 3, 4].map(bubbleFixture);
    const { container } = render(
      <TerritoryCard bubbles={bubbles} territory={territoryFixture()} />,
    );
    const moreButton = screen.getByRole('button', {
      name: '2 more bubbles in Operations',
    });
    const body = moreButton.parentElement!;
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({
      bottom: 240,
      height: 180,
      left: 0,
      right: 360,
      top: 60,
      width: 360,
      x: 0,
      y: 60,
      toJSON: () => ({}),
    });

    expect(container.querySelectorAll('[data-bubble-id]')).toHaveLength(2);
    fireEvent.click(moreButton);

    const scrollRegion = screen.getByRole('region', {
      name: 'All bubbles in Operations',
    });
    expect(container.querySelectorAll('[data-bubble-id]')).toHaveLength(4);
    expect(scrollRegion.getAttribute('data-canvas-scroll-region')).toBe('true');
    expect(scrollRegion.getAttribute('tabindex')).toBe('0');
    expect(scrollRegion.style.height).toBe('180px');
    expect(scrollRegion.style.touchAction).toBe('pan-y');
    expect(document.activeElement).toBe(scrollRegion);
    expect(
      screen.getByText('Scrolling enabled for all 4 bubbles in Operations.'),
    ).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: '2 more bubbles in Operations' }),
    ).toBeNull();
  });
});

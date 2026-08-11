import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { Bubble, Territory } from '../src/api';
import { CanvasSurface } from '../src/canvas/CanvasSurface';

const emptyState = <p>Nothing on this canvas</p>;

function territory(overrides: Partial<Territory> = {}): Territory {
  return {
    id: 'territory-1',
    project_id: 'project-123',
    kind: 'composed',
    title: 'Market evidence',
    position_x: 120,
    position_y: -48,
    visible_count: 2,
    created_at: '2026-08-10T08:00:00.000Z',
    updated_at: '2026-08-10T08:00:00.000Z',
    ...overrides,
  };
}

function bubble(overrides: Partial<Bubble> = {}): Bubble {
  return {
    id: 'bubble-1',
    project_id: 'project-123',
    territory_id: 'territory-1',
    title: 'Bubble title must not be the row face',
    summary: 'Demand exists across six hubs.',
    content: 'A longer explanation of the market.',
    created_at: '2026-08-10T09:00:00.000Z',
    updated_at: '2026-08-10T09:00:00.000Z',
    source_kind: 'manual',
    source_discussion_id: null,
    source_discussion_title: null,
    source_discussion_deleted_at: null,
    source_message_ids: [],
    source_context_item_ids: [],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CanvasSurface territory cards', () => {
  it('loads bubbles and territories together and renders non-empty cards', async () => {
    const requestBubbles = vi.fn(async () => [
      bubble(),
      bubble({
        id: 'bubble-2',
        summary: null,
        content: 'Fallback content opening. More detail follows.',
        created_at: '2026-08-10T10:00:00.000Z',
      }),
      bubble({
        id: 'bubble-3',
        summary: 'Hidden row',
        created_at: '2026-08-10T11:00:00.000Z',
      }),
    ]);
    const requestTerritories = vi.fn(async () => [
      territory(),
      territory({ id: 'territory-empty', title: 'Empty territory' }),
    ]);

    render(
      <CanvasSurface
        emptyState={emptyState}
        projectId="project-123"
        requestBubbles={requestBubbles}
        requestTerritories={requestTerritories}
      />,
    );

    expect(screen.getByRole('status', { name: 'Loading canvas' })).toBeTruthy();

    const card = await screen.findByRole('article', {
      name: 'Market evidence',
    });
    expect(within(card).getByText('Demand exists across six hubs.')).toBeTruthy();
    expect(within(card).getByText('Fallback content opening.')).toBeTruthy();
    expect(within(card).queryByText('Bubble title must not be the row face')).toBeNull();
    expect(within(card).getByText('+ 1 more bubble')).toBeTruthy();
    expect(screen.queryByText('Empty territory')).toBeNull();
    expect(card.getAttribute('style')).toContain('left: 120px');
    expect(card.getAttribute('style')).toContain('top: -48px');
  });

  it('shows the empty state only after both collections resolve empty', async () => {
    let resolveBubbles: (bubbles: Bubble[]) => void = () => undefined;
    const pendingBubbles = new Promise<Bubble[]>((resolve) => {
      resolveBubbles = resolve;
    });

    render(
      <CanvasSurface
        emptyState={emptyState}
        projectId="project-123"
        requestBubbles={() => pendingBubbles}
        requestTerritories={async () => []}
      />,
    );

    expect(screen.queryByText('Nothing on this canvas')).toBeNull();
    await act(async () => resolveBubbles([]));
    expect(screen.getByText('Nothing on this canvas')).toBeTruthy();
  });

  it('drags a territory in world coordinates and persists only its final position', async () => {
    const pending = deferred<Territory>();
    const requestPositionUpdate = vi.fn(() => pending.promise);

    render(
      <CanvasSurface
        emptyState={emptyState}
        initialViewport={{ x: 80, y: -40, zoom: 2 }}
        projectId="project-123"
        requestBubbles={async () => [bubble()]}
        requestTerritories={async () => [territory()]}
        requestTerritoryPositionUpdate={requestPositionUpdate}
      />,
    );

    const card = await screen.findByRole('article', { name: 'Market evidence' });
    const header = card.querySelector('header')!;
    const canvas = screen.getByRole('region', { name: 'Project canvas' });

    fireEvent.pointerDown(header, {
      button: 0,
      clientX: 100,
      clientY: 80,
      pointerId: 21,
    });
    fireEvent.pointerMove(canvas, {
      clientX: 180,
      clientY: 140,
      pointerId: 21,
    });

    expect(card.getAttribute('data-territory-state')).toBe('dragging');
    expect(card.style.left).toBe('160px');
    expect(card.style.top).toBe('-18px');
    expect(requestPositionUpdate).not.toHaveBeenCalled();

    fireEvent.pointerUp(canvas, { pointerId: 21 });

    expect(requestPositionUpdate).toHaveBeenCalledWith(
      'project-123',
      'territory-1',
      { position_x: 160, position_y: -18 },
    );
    expect(card.getAttribute('data-territory-state')).toBe('saving');

    await act(async () => {
      pending.resolve(territory({ position_x: 160, position_y: -18 }));
    });

    expect(card.getAttribute('data-territory-state')).toBe('default');
  });

  it('keeps a failed territory move retryable and supports an explicit revert', async () => {
    const moved = territory({ position_x: 155, position_y: -13 });
    const requestPositionUpdate = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce(moved);

    render(
      <CanvasSurface
        emptyState={emptyState}
        projectId="project-123"
        requestBubbles={async () => [bubble()]}
        requestTerritories={async () => [territory()]}
        requestTerritoryPositionUpdate={requestPositionUpdate}
      />,
    );

    const card = await screen.findByRole('article', { name: 'Market evidence' });
    const canvas = screen.getByRole('region', { name: 'Project canvas' });

    fireEvent.pointerDown(card.querySelector('header')!, {
      button: 0,
      clientX: 20,
      clientY: 30,
      pointerId: 22,
    });
    fireEvent.pointerMove(canvas, {
      clientX: 55,
      clientY: 65,
      pointerId: 22,
    });
    await act(async () => {
      fireEvent.pointerUp(canvas, { pointerId: 22 });
      await Promise.resolve();
    });

    expect(card.style.left).toBe('155px');
    expect(card.style.top).toBe('-13px');
    expect(screen.getByRole('alert').textContent).toContain(
      'Couldn’t save “Market evidence” position.',
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await Promise.resolve();
    });

    expect(requestPositionUpdate).toHaveBeenCalledTimes(2);
    expect(requestPositionUpdate.mock.calls[1]).toEqual(
      requestPositionUpdate.mock.calls[0],
    );
    expect(card.getAttribute('data-territory-state')).toBe('default');

    requestPositionUpdate.mockRejectedValueOnce(new Error('Unavailable'));
    fireEvent.pointerDown(card.querySelector('header')!, {
      button: 0,
      clientX: 55,
      clientY: 65,
      pointerId: 23,
    });
    fireEvent.pointerMove(canvas, {
      clientX: 75,
      clientY: 85,
      pointerId: 23,
    });
    await act(async () => {
      fireEvent.pointerUp(canvas, { pointerId: 23 });
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }));

    expect(card.style.left).toBe('155px');
    expect(card.style.top).toBe('-13px');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('compacts territory cards from measured heights and retries a failed batch', async () => {
    const territories = [
      territory({ id: 'territory-a', title: 'A', position_x: 700, position_y: 500 }),
      territory({ id: 'territory-b', title: 'B', position_x: -100, position_y: 50 }),
      territory({ id: 'territory-c', title: 'C', position_x: 0, position_y: 100 }),
    ];
    const bubbles = territories.map((item, index) =>
      bubble({
        id: `bubble-${index}`,
        territory_id: item.id,
        title: `Bubble ${index}`,
      }),
    );
    const compacted = [
      { ...territories[2], position_x: 444, position_y: 50 },
      { ...territories[0], position_x: -100, position_y: 374 },
    ];
    const requestPositionsUpdate = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce(compacted);

    render(
      <CanvasSurface
        emptyState={emptyState}
        projectId="project-123"
        requestBubbles={async () => bubbles}
        requestTerritories={async () => territories}
        requestTerritoryPositionsUpdate={requestPositionsUpdate}
      />,
    );

    const cardA = await screen.findByRole('article', { name: 'A' });
    const cardB = screen.getByRole('article', { name: 'B' });
    const cardC = screen.getByRole('article', { name: 'C' });
    for (const [card, height] of [
      [cardA, 200],
      [cardB, 100],
      [cardC, 300],
    ] as const) {
      Object.defineProperty(card, 'offsetHeight', {
        configurable: true,
        value: height,
      });
    }

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
      await Promise.resolve();
    });

    expect(requestPositionsUpdate).toHaveBeenCalledWith('project-123', {
      positions: [
        { territory_id: 'territory-c', position_x: 444, position_y: 50 },
        { territory_id: 'territory-a', position_x: -100, position_y: 374 },
      ],
    });
    expect(cardA.style.left).toBe('700px');
    expect(cardA.style.top).toBe('500px');
    expect(screen.getByRole('alert').textContent).toContain(
      'The previous layout was restored.',
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await Promise.resolve();
    });

    expect(requestPositionsUpdate).toHaveBeenCalledTimes(2);
    expect(requestPositionsUpdate.mock.calls[1]).toEqual(
      requestPositionsUpdate.mock.calls[0],
    );
    expect(cardA.style.left).toBe('-100px');
    expect(cardA.style.top).toBe('374px');
    expect(cardC.style.left).toBe('444px');
    expect(cardB.style.left).toBe('-100px');
  });
});

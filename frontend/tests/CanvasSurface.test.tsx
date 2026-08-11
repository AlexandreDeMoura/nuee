import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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
});

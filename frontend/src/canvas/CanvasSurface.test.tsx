import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bubble, Territory } from '../api';
import { CanvasSurface } from './CanvasSurface';
import type { ProjectBubbleCollection } from './canvasTypes';

afterEach(cleanup);

function territoryFixture(): Territory {
  return {
    id: 'territory-one',
    project_id: 'project-one',
    kind: 'composed',
    title: 'Operations',
    position_x: 0,
    position_y: 0,
    visible_count: 1,
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
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

describe('CanvasSurface territory scrolling', () => {
  it('leaves wheel events inside an unlocked card body to the scroll region', () => {
    const bubbles = [1, 2, 3].map(bubbleFixture);
    const bubbleCollection: ProjectBubbleCollection = {
      projectId: 'project-one',
      loadState: {
        status: 'ready',
        bubbles,
        territories: [territoryFixture()],
      },
      addBubble: vi.fn(),
      isBubbleRemoved: vi.fn(() => false),
      removeBubble: vi.fn(),
      replaceBubble: vi.fn(),
      retry: vi.fn(),
    };
    render(
      <CanvasSurface
        bubbleCollection={bubbleCollection}
        emptyState={null}
        initialViewport={{ x: 12, y: 24, zoom: 1 }}
        projectId="project-one"
      />,
    );
    const moreButton = screen.getByRole('button', {
      name: '2 more bubbles in Operations',
    });
    const body = moreButton.parentElement!;
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({
      bottom: 180,
      height: 120,
      left: 0,
      right: 360,
      top: 60,
      width: 360,
      x: 0,
      y: 60,
      toJSON: () => ({}),
    });
    fireEvent.click(moreButton);

    const canvas = screen.getByLabelText('Project canvas');
    const scrollRegion = screen.getByRole('region', {
      name: 'All bubbles in Operations',
    });
    const scrollEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 60,
    });
    fireEvent(scrollRegion, scrollEvent);

    expect(scrollEvent.defaultPrevented).toBe(false);
    expect(canvas.getAttribute('data-canvas-x')).toBe('12');
    expect(canvas.getAttribute('data-canvas-y')).toBe('24');

    const canvasWheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 60,
    });
    fireEvent(canvas, canvasWheelEvent);
    expect(canvasWheelEvent.defaultPrevented).toBe(true);
    expect(canvas.getAttribute('data-canvas-y')).toBe('-36');
  });
});

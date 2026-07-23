import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type {
  Bubble,
  BubbleLink,
  Project,
  UpdateProjectViewportInput,
} from '../src/api';
import type { AnalyticsClient } from '../src/analytics';
import {
  CanvasSurface,
  type CanvasMultiSelectionResult,
} from '../src/canvas/CanvasSurface';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

const emptyState = <p>Nothing on this canvas</p>;
const project: Project = {
  id: 'project-123',
  title: 'Canvas project',
  description: 'A project with a persisted canvas.',
  created_at: '2026-07-20T10:00:00.000Z',
  updated_at: '2026-07-20T10:00:00.000Z',
  canvas_viewport_x: 0,
  canvas_viewport_y: 0,
  canvas_zoom: 1,
};

function bubble(overrides: Partial<Bubble> = {}): Bubble {
  return {
    id: 'bubble-1',
    project_id: project.id,
    title: 'Market is real but fragmented',
    summary: 'Demand exists across six hubs, but buyers remain fragmented.',
    content: 'A longer explanation of the market and its demand profile.',
    position_x: 120,
    position_y: -48,
    created_at: '2026-07-19T10:00:00.000Z',
    updated_at: '2026-07-20T10:00:00.000Z',
    source_kind: 'manual',
    source_discussion_id: null,
    source_message_ids: [],
    ...overrides,
  };
}

function projectWithViewport(input: UpdateProjectViewportInput): Project {
  return { ...project, ...input };
}

const requestViewportUpdate = async (
  _projectId: string,
  input: UpdateProjectViewportInput,
) => projectWithViewport(input);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CanvasSurface', () => {
  it('loads bubbles in place and only shows the empty state for an empty project', async () => {
    const pendingBubbles = deferred<Bubble[]>();
    const requestBubbles = vi.fn(() => pendingBubbles.promise);

    render(
      <CanvasSurface
        emptyState={emptyState}
        projectId="project-123"
        requestBubbles={requestBubbles}
      />,
    );

    expect(screen.getByRole('status', { name: 'Loading canvas' })).toBeTruthy();
    expect(screen.queryByText('Nothing on this canvas')).toBeNull();

    await act(async () => pendingBubbles.resolve([]));

    expect(screen.getByText('Nothing on this canvas')).toBeTruthy();
    expect(requestBubbles).toHaveBeenCalledWith(
      'project-123',
      expect.any(AbortSignal),
    );
  });

  it('keeps load failures inside the canvas and retries without replacing the shell', async () => {
    const requestBubbles = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce([]);

    render(
      <CanvasSurface
        emptyState={emptyState}
        projectId="project-123"
        requestBubbles={requestBubbles}
      />,
    );

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Project canvas' })).toBeTruthy();
    expect(screen.queryByText('Nothing on this canvas')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Nothing on this canvas')).toBeTruthy();
    expect(requestBubbles).toHaveBeenCalledTimes(2);
  });

  it('does not present an empty project when bubble records exist', async () => {
    const pendingBubbles = deferred<Bubble[]>();

    render(
      <CanvasSurface
        emptyState={emptyState}
        projectId="project-123"
        requestBubbles={() => pendingBubbles.promise}
      />,
    );

    await act(async () => pendingBubbles.resolve([bubble()]));

    expect(screen.queryByText('Nothing on this canvas')).toBeNull();
    expect(document.querySelectorAll('[data-bubble-id]')).toHaveLength(1);
    expect(screen.getByText('Market is real but fragmented')).toBeTruthy();
  });

  it('creates a bubble in the visible world area and appends it to the canvas', async () => {
    const requestPlacement = vi.fn().mockResolvedValue({
      position_x: 40,
      position_y: 60,
    });
    const createdBubble = bubble({
      id: 'created-in-view',
      title: 'Created in view',
      position_x: 40,
      position_y: 60,
    });
    const requestCreate = vi.fn().mockResolvedValue(createdBubble);

    render(
      <CanvasSurface
        emptyState={({ onCreateBubble }) => (
          <button type="button" onClick={onCreateBubble}>
            Create a bubble
          </button>
        )}
        initialViewport={{ x: 100, y: -50, zoom: 2 }}
        projectId={project.id}
        requestBubbleCreate={requestCreate}
        requestBubbles={async () => []}
        requestBubblePlacement={requestPlacement}
      />,
    );

    await screen.findByRole('button', { name: 'Create a bubble' });
    const canvas = screen.getByRole('region', { name: 'Project canvas' });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      bottom: 600,
      height: 600,
      left: 0,
      right: 800,
      top: 0,
      width: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create a bubble' }));
    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: 'Created in view' },
    });
    fireEvent.change(screen.getByLabelText(/^Content/), {
      target: { value: 'Visible knowledge' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create bubble' }));

    expect(await screen.findByText('Created in view')).toBeTruthy();
    expect(requestPlacement).toHaveBeenCalledWith(project.id, {
      strategy: 'viewport',
      viewport_x: -50,
      viewport_y: 25,
      viewport_width: 400,
      viewport_height: 300,
    });
    expect(requestCreate).toHaveBeenCalledWith(
      project.id,
      expect.objectContaining({ position_x: 40, position_y: 60 }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders each bubble at its persisted world coordinates', async () => {
    render(
      <CanvasSurface
        emptyState={emptyState}
        initialViewport={{ x: 40, y: 25, zoom: 1.2 }}
        projectId="project-123"
        requestBubbles={async () => [
          bubble({ position_x: 182.5, position_y: -64 }),
        ]}
      />,
    );

    const card = await screen.findByRole('article', {
      name: 'Market is real but fragmented',
    });
    const contentLayer = document.querySelector('[data-canvas-content]');

    expect(card.style.left).toBe('182.5px');
    expect(card.style.top).toBe('-64px');
    expect(contentLayer?.getAttribute('style')).toContain(
      'translate(40px, 25px) scale(1.2)',
    );
  });

  it('keeps valid bubbles visible when part of a response cannot be rendered', async () => {
    const requestBubbles = vi
      .fn()
      .mockResolvedValueOnce([
        bubble(),
        bubble({ id: 'wrong-project', project_id: 'project-elsewhere' }),
      ])
      .mockRejectedValueOnce(new Error('Unavailable'));

    render(
      <CanvasSurface
        emptyState={emptyState}
        projectId="project-123"
        requestBubbles={requestBubbles}
      />,
    );

    expect(
      await screen.findByRole('article', {
        name: 'Market is real but fragmented',
      }),
    ).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'Some bubbles couldn’t be displayed.',
    );
    expect(document.querySelector('[data-bubble-id="wrong-project"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('We couldn’t refresh your bubbles.')).toBeTruthy();
    expect(
      screen.getByRole('article', { name: 'Market is real but fragmented' }),
    ).toBeTruthy();
  });

  it('does not start a canvas pan from a bubble card', async () => {
    render(
      <CanvasSurface
        emptyState={emptyState}
        projectId="project-123"
        requestBubbles={async () => [bubble()]}
        requestBubblePositionUpdate={async (_projectId, _bubbleId, input) =>
          bubble({ position_x: input.position_x, position_y: input.position_y })
        }
      />,
    );

    const canvas = screen.getByRole('region', { name: 'Project canvas' });
    const card = await screen.findByRole('article', {
      name: 'Market is real but fragmented',
    });

    fireEvent.pointerDown(card, {
      button: 0,
      clientX: 100,
      clientY: 80,
      pointerId: 17,
    });
    fireEvent.pointerMove(canvas, {
      clientX: 150,
      clientY: 120,
      pointerId: 17,
    });
    fireEvent.pointerUp(canvas, { pointerId: 17 });

    expect(canvas.getAttribute('data-canvas-x')).toBe('0');
    expect(canvas.getAttribute('data-canvas-y')).toBe('0');
  });

  it('selects a bubble without moving it and clears selection from the canvas background', async () => {
    const onBubbleSelectionChange = vi.fn();

    render(
      <CanvasSurface
        emptyState={emptyState}
        projectId={project.id}
        requestBubbles={async () => [bubble()]}
        onBubbleSelectionChange={onBubbleSelectionChange}
      />,
    );

    const card = await screen.findByRole('article', {
      name: 'Market is real but fragmented',
    });
    const canvas = screen.getByRole('region', { name: 'Project canvas' });

    fireEvent.pointerDown(card, {
      button: 0,
      clientX: 100,
      clientY: 80,
      pointerId: 18,
    });
    fireEvent.pointerUp(canvas, {
      clientX: 100,
      clientY: 80,
      pointerId: 18,
    });

    expect(card.getAttribute('data-bubble-selected')).toBe('true');
    expect(card.style.left).toBe('120px');
    expect(card.style.top).toBe('-48px');
    expect(onBubbleSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'bubble-1' }),
    );

    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 20,
      clientY: 20,
      pointerId: 19,
    });

    expect(card.getAttribute('data-bubble-selected')).toBe('false');
    expect(onBubbleSelectionChange).toHaveBeenLastCalledWith(null);
  });

  it('hands feature-selected identifiers and current live records back without moving bubbles', async () => {
    const firstBubble = bubble();
    const secondBubble = bubble({
      id: 'bubble-2',
      title: 'Regulatory lead time',
      content: 'Licensing requires nine to fourteen months.',
      position_x: 420,
      position_y: 160,
    });
    const link: BubbleLink = {
      id: 'link-1',
      project_id: project.id,
      bubble_a_id: 'bubble-1',
      bubble_b_id: 'bubble-2',
      created_at: '2026-07-20T12:00:00.000Z',
    };
    const requestBubbles = vi.fn().mockResolvedValue([
      firstBubble,
      secondBubble,
    ]);
    const requestPositionUpdate = vi.fn();
    const onConfirm = vi.fn<(selection: CanvasMultiSelectionResult) => void>();
    const onBubbleSelectionChange = vi.fn();
    const rendered = render(
      <CanvasSurface
        bubbleLinks={[link]}
        emptyState={emptyState}
        projectId={project.id}
        requestBubbles={requestBubbles}
        requestBubblePositionUpdate={requestPositionUpdate}
        onBubbleSelectionChange={onBubbleSelectionChange}
      />,
    );

    const firstCard = await screen.findByRole('article', {
      name: firstBubble.title,
    });
    const secondCard = screen.getByRole('article', {
      name: secondBubble.title,
    });
    fireEvent.keyDown(firstCard, { key: 'Enter' });

    expect(firstCard.getAttribute('data-bubble-selected')).toBe('true');
    expect(secondCard.getAttribute('data-bubble-linked')).toBe('true');

    rendered.rerender(
      <CanvasSurface
        bubbleLinks={[link]}
        emptyState={emptyState}
        multiSelection={{
          confirmLabel: 'Add to discussion',
          initialBubbleIds: ['bubble-2', 'other-project-bubble'],
          instruction: 'Select bubbles to add as context',
          onCancel: vi.fn(),
          onConfirm,
        }}
        projectId={project.id}
        requestBubbles={requestBubbles}
        requestBubblePositionUpdate={requestPositionUpdate}
        onBubbleSelectionChange={onBubbleSelectionChange}
      />,
    );

    const firstOption = screen.getByRole('checkbox', {
      name: firstBubble.title,
    });
    const secondOption = screen.getByRole('checkbox', {
      name: secondBubble.title,
    });
    const canvas = screen.getByRole('region', { name: 'Project canvas' });

    expect(canvas.getAttribute('data-selection-mode')).toBe('multiple');
    expect(firstOption.getAttribute('aria-checked')).toBe('false');
    expect(secondOption.getAttribute('aria-checked')).toBe('true');
    expect(secondOption.getAttribute('data-bubble-linked')).toBe('false');
    expect(screen.getByText('1 SELECTED')).toBeTruthy();

    fireEvent.pointerDown(firstOption, {
      button: 0,
      clientX: 100,
      clientY: 80,
      pointerId: 31,
    });
    fireEvent.pointerMove(canvas, {
      clientX: 170,
      clientY: 150,
      pointerId: 31,
    });
    fireEvent.pointerUp(canvas, { pointerId: 31 });

    expect(firstOption.style.left).toBe('120px');
    expect(firstOption.style.top).toBe('-48px');
    expect(requestPositionUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('2 SELECTED')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Add to discussion (2 selected)',
      }),
    );

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const result = onConfirm.mock.calls[0]?.[0];
    expect(result?.projectId).toBe(project.id);
    expect(result?.bubbleIds).toEqual(['bubble-2', 'bubble-1']);
    expect(result?.bubbles[0]).toBe(secondBubble);
    expect(result?.bubbles[1]).toBe(firstBubble);
    expect(firstBubble.content).toBe(
      'A longer explanation of the market and its demand profile.',
    );
    expect(onBubbleSelectionChange).toHaveBeenCalledTimes(1);
  });

  it('cancels multi-selection with Escape and restores the previous normal selection', async () => {
    const firstBubble = bubble();
    const secondBubble = bubble({
      id: 'bubble-2',
      title: 'Regulatory lead time',
      position_x: 420,
    });
    const link: BubbleLink = {
      id: 'link-1',
      project_id: project.id,
      bubble_a_id: 'bubble-1',
      bubble_b_id: 'bubble-2',
      created_at: '2026-07-20T12:00:00.000Z',
    };
    const requestBubbles = vi.fn().mockResolvedValue([
      firstBubble,
      secondBubble,
    ]);
    const onCancel = vi.fn();
    const rendered = render(
      <CanvasSurface
        bubbleLinks={[link]}
        emptyState={emptyState}
        projectId={project.id}
        requestBubbles={requestBubbles}
      />,
    );

    const firstCard = await screen.findByRole('article', {
      name: firstBubble.title,
    });
    fireEvent.keyDown(firstCard, { key: 'Enter' });

    rendered.rerender(
      <CanvasSurface
        bubbleLinks={[link]}
        emptyState={emptyState}
        multiSelection={{
          initialBubbleIds: ['bubble-2'],
          onCancel,
          onConfirm: vi.fn(),
        }}
        projectId={project.id}
        requestBubbles={requestBubbles}
      />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);

    rendered.rerender(
      <CanvasSurface
        bubbleLinks={[link]}
        emptyState={emptyState}
        projectId={project.id}
        requestBubbles={requestBubbles}
      />,
    );

    const restoredFirstCard = screen.getByRole('article', {
      name: firstBubble.title,
    });
    const restoredSecondCard = screen.getByRole('article', {
      name: secondBubble.title,
    });

    expect(
      screen.getByRole('region', { name: 'Project canvas' }).getAttribute(
        'data-selection-mode',
      ),
    ).toBe('single');
    expect(restoredFirstCard.getAttribute('data-bubble-selected')).toBe('true');
    expect(restoredSecondCard.getAttribute('data-bubble-linked')).toBe('true');
    expect(restoredFirstCard.style.left).toBe('120px');
    expect(restoredFirstCard.style.top).toBe('-48px');
  });

  it('drags one bubble optimistically in world coordinates and persists only its final position', async () => {
    const pendingPosition = deferred<Bubble>();
    const requestPositionUpdate = vi.fn(() => pendingPosition.promise);
    const untouchedBubble = bubble({
      id: 'bubble-2',
      title: 'Untouched bubble',
      position_x: 400,
      position_y: 300,
    });

    render(
      <CanvasSurface
        emptyState={emptyState}
        initialViewport={{ x: 80, y: -40, zoom: 2 }}
        projectId={project.id}
        requestBubbles={async () => [bubble(), untouchedBubble]}
        requestBubblePositionUpdate={requestPositionUpdate}
      />,
    );

    const movedCard = await screen.findByRole('article', {
      name: 'Market is real but fragmented',
    });
    const untouchedCard = screen.getByRole('article', {
      name: 'Untouched bubble',
    });
    const canvas = screen.getByRole('region', { name: 'Project canvas' });

    fireEvent.pointerDown(movedCard, {
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

    expect(movedCard.getAttribute('data-bubble-state')).toBe('dragging');
    expect(movedCard.style.left).toBe('160px');
    expect(movedCard.style.top).toBe('-18px');
    expect(untouchedCard.style.left).toBe('400px');
    expect(untouchedCard.style.top).toBe('300px');
    expect(requestPositionUpdate).not.toHaveBeenCalled();

    fireEvent.pointerUp(canvas, { pointerId: 21 });

    expect(requestPositionUpdate).toHaveBeenCalledWith(
      project.id,
      'bubble-1',
      { position_x: 160, position_y: -18 },
    );
    expect(movedCard.getAttribute('data-bubble-state')).toBe('saving');

    await act(async () => {
      pendingPosition.resolve(
        bubble({ position_x: 160, position_y: -18 }),
      );
    });

    expect(movedCard.getAttribute('data-bubble-state')).toBe('default');
    expect(untouchedCard.style.left).toBe('400px');
    expect(untouchedCard.style.top).toBe('300px');
  });

  it('retains a failed local move and retries the exact position before recording analytics', async () => {
    const track = vi.fn<AnalyticsClient['track']>();
    const movedBubble = bubble({ position_x: 155, position_y: -13 });
    const requestPositionUpdate = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce(movedBubble);

    render(
      <CanvasSurface
        analyticsClient={{ track }}
        emptyState={emptyState}
        projectId={project.id}
        requestBubbles={async () => [bubble()]}
        requestBubblePositionUpdate={requestPositionUpdate}
      />,
    );

    const card = await screen.findByRole('article', {
      name: 'Market is real but fragmented',
    });
    const canvas = screen.getByRole('region', { name: 'Project canvas' });

    fireEvent.pointerDown(card, {
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
    expect(card.getAttribute('data-bubble-state')).toBe('error');
    expect(screen.getByRole('alert').textContent).toContain(
      'Couldn’t save “Market is real but fragmented” position.',
    );
    expect(track).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await Promise.resolve();
    });

    expect(requestPositionUpdate).toHaveBeenCalledTimes(2);
    expect(requestPositionUpdate.mock.calls[1]).toEqual(
      requestPositionUpdate.mock.calls[0],
    );
    expect(card.getAttribute('data-bubble-state')).toBe('default');
    expect(screen.queryByText(/Couldn’t save .* position/)).toBeNull();
    expect(track).toHaveBeenCalledWith('bubble_moved', {
      project_id: project.id,
      bubble_id: 'bubble-1',
    });
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('lets the user explicitly revert a failed move to the persisted position', async () => {
    const requestPositionUpdate = vi
      .fn()
      .mockRejectedValue(new Error('Unavailable'));

    render(
      <CanvasSurface
        emptyState={emptyState}
        projectId={project.id}
        requestBubbles={async () => [bubble()]}
        requestBubblePositionUpdate={requestPositionUpdate}
      />,
    );

    const card = await screen.findByRole('article', {
      name: 'Market is real but fragmented',
    });
    const canvas = screen.getByRole('region', { name: 'Project canvas' });

    fireEvent.pointerDown(card, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerId: 23,
    });
    fireEvent.pointerMove(canvas, {
      clientX: 60,
      clientY: 70,
      pointerId: 23,
    });

    await act(async () => {
      fireEvent.pointerUp(canvas, { pointerId: 23 });
      await Promise.resolve();
    });

    expect(card.style.left).toBe('170px');
    expect(card.style.top).toBe('12px');

    fireEvent.click(screen.getByRole('button', { name: 'Revert' }));

    expect(card.style.left).toBe('120px');
    expect(card.style.top).toBe('-48px');
    expect(card.getAttribute('data-bubble-state')).toBe('default');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(requestPositionUpdate).toHaveBeenCalledTimes(1);
  });

  it('pans the viewport by dragging the canvas background', async () => {
    render(
      <CanvasSurface
        emptyState={emptyState}
        projectId="project-123"
        requestBubbles={async () => []}
        requestViewportUpdate={requestViewportUpdate}
      />,
    );

    await screen.findByText('Nothing on this canvas');
    const canvas = screen.getByRole('region', { name: 'Project canvas' });

    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 100,
      clientY: 80,
      pointerId: 7,
    });
    fireEvent.pointerMove(canvas, {
      clientX: 146,
      clientY: 111,
      pointerId: 7,
    });
    fireEvent.pointerUp(canvas, { pointerId: 7 });

    expect(canvas.getAttribute('data-canvas-x')).toBe('46');
    expect(canvas.getAttribute('data-canvas-y')).toBe('31');
    expect(canvas.className).toContain('cursor-grab');
    expect(canvas.className).not.toContain('cursor-grabbing');
  });

  it('contains trackpad pan and pinch-to-zoom gestures inside the canvas', async () => {
    const parentWheelListener = vi.fn();
    const rendered = render(
      <div onWheel={parentWheelListener}>
        <CanvasSurface
          emptyState={emptyState}
          projectId="project-123"
          requestBubbles={async () => []}
          requestViewportUpdate={requestViewportUpdate}
        />
      </div>,
    );

    await screen.findByText('Nothing on this canvas');
    const canvas = screen.getByRole('region', { name: 'Project canvas' });
    const panEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 12,
      deltaY: 30,
    });

    fireEvent(canvas, panEvent);

    expect(panEvent.defaultPrevented).toBe(true);
    expect(parentWheelListener).not.toHaveBeenCalled();
    expect(canvas.getAttribute('data-canvas-x')).toBe('-12');
    expect(canvas.getAttribute('data-canvas-y')).toBe('-30');

    const zoomEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100,
      ctrlKey: true,
      deltaY: -100,
    });
    fireEvent(canvas, zoomEvent);

    expect(zoomEvent.defaultPrevented).toBe(true);
    expect(Number(canvas.getAttribute('data-canvas-zoom'))).toBeGreaterThan(1);
    expect(screen.getByRole('button', { name: 'Reset zoom to 100%' }).textContent).not.toBe(
      '100%',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom to 100%' }));
    expect(canvas.getAttribute('data-canvas-zoom')).toBe('1');
    expect(parentWheelListener).not.toHaveBeenCalled();

    rendered.unmount();
  });

  it('restores a persisted project viewport on mount', async () => {
    render(
      <CanvasSurface
        emptyState={emptyState}
        initialViewport={{ x: 184.5, y: -96, zoom: 1.35 }}
        projectId="project-123"
        requestBubbles={async () => []}
        requestViewportUpdate={requestViewportUpdate}
      />,
    );

    await screen.findByText('Nothing on this canvas');
    const canvas = screen.getByRole('region', { name: 'Project canvas' });

    expect(canvas.getAttribute('data-canvas-x')).toBe('184.5');
    expect(canvas.getAttribute('data-canvas-y')).toBe('-96');
    expect(canvas.getAttribute('data-canvas-zoom')).toBe('1.35');
    expect(screen.getByRole('button', { name: 'Reset zoom to 100%' }).textContent).toBe(
      '135%',
    );
  });

  it('coalesces a continuous gesture into one viewport write', async () => {
    vi.useFakeTimers();
    const requestUpdate = vi.fn(
      async (_projectId: string, input: UpdateProjectViewportInput) =>
        projectWithViewport(input),
    );

    render(
      <CanvasSurface
        emptyState={emptyState}
        projectId="project-123"
        requestBubbles={async () => []}
        requestViewportUpdate={requestUpdate}
        viewportSaveDelayMs={400}
      />,
    );

    await act(async () => undefined);
    const canvas = screen.getByRole('region', { name: 'Project canvas' });

    for (const [deltaX, deltaY] of [
      [10, 20],
      [5, -2],
      [-3, 4],
    ]) {
      fireEvent(
        canvas,
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaX,
          deltaY,
        }),
      );
    }

    expect(requestUpdate).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });

    expect(requestUpdate).toHaveBeenCalledTimes(1);
    expect(requestUpdate).toHaveBeenCalledWith(
      'project-123',
      {
        canvas_viewport_x: -12,
        canvas_viewport_y: -22,
        canvas_zoom: 1,
      },
      { keepalive: false },
    );
  });

  it('flushes the latest pending viewport before SPA navigation', async () => {
    vi.useFakeTimers();
    const requestUpdate = vi.fn(
      async (_projectId: string, input: UpdateProjectViewportInput) =>
        projectWithViewport(input),
    );

    render(
      <CanvasSurface
        emptyState={emptyState}
        projectId="project-123"
        requestBubbles={async () => []}
        requestViewportUpdate={requestUpdate}
        viewportSaveDelayMs={10_000}
      />,
    );

    await act(async () => undefined);
    const canvas = screen.getByRole('region', { name: 'Project canvas' });
    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: 40,
      clientY: 50,
      pointerId: 9,
    });
    fireEvent.pointerMove(canvas, {
      clientX: 73,
      clientY: 68,
      pointerId: 9,
    });
    fireEvent.pointerUp(canvas, { pointerId: 9 });

    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'));
      await Promise.resolve();
    });

    expect(requestUpdate).toHaveBeenCalledTimes(1);
    expect(requestUpdate).toHaveBeenCalledWith(
      'project-123',
      {
        canvas_viewport_x: 33,
        canvas_viewport_y: 18,
        canvas_zoom: 1,
      },
      { keepalive: true },
    );
  });

  it('retains the unsaved viewport after failure and retries that exact state', async () => {
    vi.useFakeTimers();
    const requestUpdate = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockImplementationOnce(
        async (_projectId: string, input: UpdateProjectViewportInput) =>
          projectWithViewport(input),
      );

    render(
      <CanvasSurface
        emptyState={emptyState}
        projectId="project-123"
        requestBubbles={async () => []}
        requestViewportUpdate={requestUpdate}
        viewportSaveDelayMs={0}
      />,
    );

    await act(async () => undefined);
    const canvas = screen.getByRole('region', { name: 'Project canvas' });
    fireEvent(
      canvas,
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaX: 25,
        deltaY: -14,
      }),
    );

    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });

    expect(screen.getByRole('alert').textContent).toContain(
      'Couldn’t save this canvas view.',
    );
    expect(canvas.getAttribute('data-canvas-x')).toBe('-25');
    expect(canvas.getAttribute('data-canvas-y')).toBe('14');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
      await Promise.resolve();
    });

    expect(requestUpdate).toHaveBeenCalledTimes(2);
    expect(requestUpdate.mock.calls[1]?.[1]).toEqual(
      requestUpdate.mock.calls[0]?.[1],
    );
    expect(screen.queryByText('Couldn’t save this canvas view.')).toBeNull();
  });
});

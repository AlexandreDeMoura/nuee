import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Bubble } from '../src/api';
import { CanvasSurface } from '../src/canvas/CanvasSurface';

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

afterEach(() => {
  cleanup();
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
    const bubble = { id: 'bubble-1' } as Bubble;
    const pendingBubbles = deferred<Bubble[]>();

    render(
      <CanvasSurface
        emptyState={emptyState}
        projectId="project-123"
        requestBubbles={() => pendingBubbles.promise}
      />,
    );

    await act(async () => pendingBubbles.resolve([bubble]));

    expect(screen.queryByText('Nothing on this canvas')).toBeNull();
    expect(document.querySelectorAll('[data-bubble-id]')).toHaveLength(0);
  });

  it('pans the viewport by dragging the canvas background', async () => {
    render(
      <CanvasSurface
        emptyState={emptyState}
        projectId="project-123"
        requestBubbles={async () => []}
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
});

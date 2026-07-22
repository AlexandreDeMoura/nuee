import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Bubble, Project, UpdateProjectViewportInput } from '../src/api';
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

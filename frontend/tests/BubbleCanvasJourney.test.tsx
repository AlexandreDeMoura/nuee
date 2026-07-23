import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import App from '../src/App';
import type {
  Bubble,
  BubbleLink,
  BubblePositionUpdate,
  Project,
} from '../src/api';
import { BUBBLE_CARD_HEIGHT, BUBBLE_CARD_WIDTH } from '../src/canvas/compactLayout';
import { ProjectWorkspace } from '../src/workspace/ProjectWorkspace';

const projectId = 'project-bubble-journey';

function response(body: unknown, status = 200): Response {
  return {
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}

function noContentResponse(): Response {
  return response(undefined, 204);
}

function bubble(overrides: Partial<Bubble> = {}): Bubble {
  return {
    id: 'bubble-anchor',
    project_id: projectId,
    title: 'Existing launch constraint',
    summary: 'Licensing remains the longest lead-time item.',
    content: 'The current licensing estimate is nine to fourteen months.',
    position_x: -320,
    position_y: 120,
    created_at: '2026-07-23T08:00:00.000Z',
    updated_at: '2026-07-23T08:00:00.000Z',
    source_kind: 'discussion',
    source_discussion_id: 'discussion-1',
    source_message_ids: ['message-1', 'message-2'],
    ...overrides,
  };
}

function bubblePositions(bubbles: readonly Bubble[]) {
  return Object.fromEntries(
    bubbles.map((candidate) => [
      candidate.id,
      {
        position_x: candidate.position_x,
        position_y: candidate.position_y,
      },
    ]),
  );
}

function expectNoOverlaps(bubbles: readonly Bubble[]) {
  for (let firstIndex = 0; firstIndex < bubbles.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < bubbles.length;
      secondIndex += 1
    ) {
      const first = bubbles[firstIndex];
      const second = bubbles[secondIndex];
      const overlaps =
        first.position_x < second.position_x + BUBBLE_CARD_WIDTH &&
        first.position_x + BUBBLE_CARD_WIDTH > second.position_x &&
        first.position_y < second.position_y + BUBBLE_CARD_HEIGHT &&
        first.position_y + BUBBLE_CARD_HEIGHT > second.position_y;

      expect(overlaps).toBe(false);
    }
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('bubble canvas journey', () => {
  it('creates, moves, edits, links, inspects, compacts, reloads, and deletes persisted knowledge', async () => {
    let persistedProject: Project = {
      id: projectId,
      title: 'Bubble canvas journey',
      description: 'Exercise durable project knowledge from the canvas.',
      created_at: '2026-07-23T08:00:00.000Z',
      updated_at: '2026-07-23T08:00:00.000Z',
      canvas_viewport_x: 0,
      canvas_viewport_y: 0,
      canvas_zoom: 1,
    };
    let persistedBubbles: Bubble[] = [bubble()];
    let persistedLinks: BubbleLink[] = [];
    const frozenDiscussions = [
      {
        id: 'discussion-1',
        frozen_context: [
          {
            bubble_id: 'bubble-anchor',
            title: 'Existing launch constraint',
            content: 'The current licensing estimate is nine to fourteen months.',
          },
        ],
      },
    ];
    const frozenDiscussionsBeforeDeletion = JSON.parse(
      JSON.stringify(frozenDiscussions),
    ) as typeof frozenDiscussions;

    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const rawUrl =
          typeof input === 'string' || input instanceof URL ? input : input.url;
        const url = new URL(rawUrl);
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        const requestBody = init?.body
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : {};

        if (method === 'GET' && url.pathname === '/projects') {
          return response([persistedProject]);
        }

        if (method === 'GET' && url.pathname === `/projects/${projectId}`) {
          return response(persistedProject);
        }

        if (
          method === 'GET' &&
          url.pathname === `/projects/${projectId}/bubbles`
        ) {
          return response(persistedBubbles);
        }

        if (
          method === 'GET' &&
          url.pathname === `/projects/${projectId}/bubble-links`
        ) {
          return response(persistedLinks);
        }

        if (
          method === 'POST' &&
          url.pathname === `/projects/${projectId}/bubbles/placement`
        ) {
          return response({ position_x: 500, position_y: 300 });
        }

        if (
          method === 'POST' &&
          url.pathname === `/projects/${projectId}/bubbles`
        ) {
          const createdBubble = bubble({
            id: 'bubble-created',
            title: String(requestBody.title),
            summary:
              requestBody.summary === null ? null : String(requestBody.summary),
            content: String(requestBody.content),
            position_x: Number(requestBody.position_x),
            position_y: Number(requestBody.position_y),
            created_at: '2026-07-23T09:00:00.000Z',
            updated_at: '2026-07-23T09:00:00.000Z',
            source_kind: 'manual',
            source_discussion_id: null,
            source_message_ids: [],
          });
          persistedBubbles = [...persistedBubbles, createdBubble];
          return response(createdBubble, 201);
        }

        if (
          method === 'PATCH' &&
          url.pathname === `/projects/${projectId}/bubbles/positions`
        ) {
          const positions = requestBody.positions as BubblePositionUpdate[];
          const positionsById = new Map(
            positions.map((position) => [position.bubble_id, position]),
          );
          persistedBubbles = persistedBubbles.map((candidate) => {
            const position = positionsById.get(candidate.id);
            return position
              ? {
                  ...candidate,
                  position_x: position.position_x,
                  position_y: position.position_y,
                }
              : candidate;
          });

          return response(
            positions.map((position) =>
              persistedBubbles.find(
                (candidate) => candidate.id === position.bubble_id,
              ),
            ),
          );
        }

        if (
          method === 'PATCH' &&
          url.pathname === `/projects/${projectId}/viewport`
        ) {
          persistedProject = {
            ...persistedProject,
            canvas_viewport_x: Number(requestBody.canvas_viewport_x),
            canvas_viewport_y: Number(requestBody.canvas_viewport_y),
            canvas_zoom: Number(requestBody.canvas_zoom),
          };
          return response(persistedProject);
        }

        const positionMatch = url.pathname.match(
          new RegExp(`^/projects/${projectId}/bubbles/([^/]+)/position$`),
        );

        if (method === 'PATCH' && positionMatch) {
          const bubbleId = decodeURIComponent(positionMatch[1]);
          let repositionedBubble: Bubble | undefined;
          persistedBubbles = persistedBubbles.map((candidate) => {
            if (candidate.id !== bubbleId) {
              return candidate;
            }

            repositionedBubble = {
              ...candidate,
              position_x: Number(requestBody.position_x),
              position_y: Number(requestBody.position_y),
            };
            return repositionedBubble;
          });
          return response(repositionedBubble);
        }

        const bubbleMatch = url.pathname.match(
          new RegExp(`^/projects/${projectId}/bubbles/([^/]+)$`),
        );

        if (method === 'PATCH' && bubbleMatch) {
          const bubbleId = decodeURIComponent(bubbleMatch[1]);
          let updatedBubble: Bubble | undefined;
          persistedBubbles = persistedBubbles.map((candidate) => {
            if (candidate.id !== bubbleId) {
              return candidate;
            }

            updatedBubble = {
              ...candidate,
              title: String(requestBody.title),
              summary:
                requestBody.summary === null ? null : String(requestBody.summary),
              content: String(requestBody.content),
              updated_at: '2026-07-23T10:00:00.000Z',
            };
            return updatedBubble;
          });
          return response(updatedBubble);
        }

        if (
          method === 'POST' &&
          url.pathname === `/projects/${projectId}/bubble-links`
        ) {
          const endpointIds = [
            String(requestBody.bubble_a_id),
            String(requestBody.bubble_b_id),
          ].sort();
          const createdLink: BubbleLink = {
            id: 'link-journey',
            project_id: projectId,
            bubble_a_id: endpointIds[0],
            bubble_b_id: endpointIds[1],
            created_at: '2026-07-23T10:05:00.000Z',
          };
          persistedLinks = [createdLink];
          return response(createdLink, 201);
        }

        if (method === 'DELETE' && bubbleMatch) {
          const bubbleId = decodeURIComponent(bubbleMatch[1]);
          persistedBubbles = persistedBubbles.filter(
            (candidate) => candidate.id !== bubbleId,
          );
          persistedLinks = persistedLinks.filter(
            (link) =>
              link.bubble_a_id !== bubbleId && link.bubble_b_id !== bubbleId,
          );
          return noContentResponse();
        }

        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const firstSession = render(<App />);

    fireEvent.click(
      await screen.findByRole('link', { name: /Bubble canvas journey/ }),
    );

    const anchorCard = await screen.findByRole('article', {
      name: 'Existing launch constraint',
    });
    const anchorPositionBeforeMove = {
      left: anchorCard.style.left,
      top: anchorCard.style.top,
    };

    fireEvent.click(screen.getByRole('button', { name: 'Bubble' }));
    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: 'Reusable market thesis' },
    });
    fireEvent.change(screen.getByLabelText(/^Summary/), {
      target: { value: 'A focused segment can support the initial launch.' },
    });
    fireEvent.change(screen.getByLabelText(/^Content/), {
      target: {
        value: 'Demand is fragmented, but the first segment is large enough.',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create bubble' }));

    const createdCard = await screen.findByRole('article', {
      name: 'Reusable market thesis',
    });
    expect(createdCard.textContent).toContain(
      'A focused segment can support the initial launch.',
    );

    const canvas = screen.getByRole('region', { name: 'Project canvas' });
    fireEvent.pointerDown(createdCard, {
      button: 0,
      clientX: 100,
      clientY: 80,
      pointerId: 31,
    });
    fireEvent.pointerMove(canvas, {
      clientX: 180,
      clientY: 120,
      pointerId: 31,
    });
    fireEvent.pointerUp(canvas, { pointerId: 31 });

    await waitFor(() =>
      expect(
        persistedBubbles.find((candidate) => candidate.id === 'bubble-created'),
      ).toMatchObject({ position_x: 580, position_y: 340 }),
    );
    expect(anchorCard.style.left).toBe(anchorPositionBeforeMove.left);
    expect(anchorCard.style.top).toBe(anchorPositionBeforeMove.top);

    fireEvent.keyDown(createdCard, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit bubble' }));
    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: 'Focused market thesis' },
    });
    fireEvent.change(screen.getByLabelText(/^Summary/), {
      target: { value: 'The first buyer segment supports a focused launch.' },
    });
    fireEvent.change(screen.getByLabelText(/^Content/), {
      target: {
        value:
          'Demand remains fragmented, but the first buyer segment is large enough for launch.',
      },
    });

    await waitFor(
      () =>
        expect(
          persistedBubbles.find(
            (candidate) => candidate.id === 'bubble-created',
          ),
        ).toMatchObject({
          title: 'Focused market thesis',
          summary: 'The first buyer segment supports a focused launch.',
          content:
            'Demand remains fragmented, but the first buyer segment is large enough for launch.',
          updated_at: '2026-07-23T10:00:00.000Z',
        }),
      { timeout: 1_500 },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));

    fireEvent.change(screen.getByLabelText('Bubble to link'), {
      target: { value: 'bubble-anchor' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));

    const updatedCard = await screen.findByRole('article', {
      name: 'Focused market thesis',
    });
    await waitFor(() =>
      expect(anchorCard.getAttribute('data-bubble-linked')).toBe('true'),
    );
    expect(updatedCard.getAttribute('data-bubble-selected')).toBe('true');
    expect(persistedLinks).toEqual([
      expect.objectContaining({
        bubble_a_id: 'bubble-anchor',
        bubble_b_id: 'bubble-created',
      }),
    ]);

    const inspector = document.querySelector(
      '[data-inspector-bubble-id="bubble-created"]',
    ) as HTMLElement;
    expect(within(inspector).getByText('Focused market thesis')).toBeTruthy();
    expect(
      within(inspector).getByText(
        'The first buyer segment supports a focused launch.',
      ),
    ).toBeTruthy();
    expect(
      within(inspector).getByText(
        'Demand remains fragmented, but the first buyer segment is large enough for launch.',
      ),
    ).toBeTruthy();
    expect(inspector.querySelector('time')?.dateTime).toBe(
      '2026-07-23T10:00:00.000Z',
    );
    expect(document.querySelector('[data-canvas-content] svg')).toBeNull();

    const contentBeforeCompact = Object.fromEntries(
      persistedBubbles.map((candidate) => [
        candidate.id,
        {
          title: candidate.title,
          summary: candidate.summary,
          content: candidate.content,
          updated_at: candidate.updated_at,
        },
      ]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }));

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Compact' }).hasAttribute('disabled'),
      ).toBe(false),
    );
    expectNoOverlaps(persistedBubbles);
    expect(
      Object.fromEntries(
        persistedBubbles.map((candidate) => [
          candidate.id,
          {
            title: candidate.title,
            summary: candidate.summary,
            content: candidate.content,
            updated_at: candidate.updated_at,
          },
        ]),
      ),
    ).toEqual(contentBeforeCompact);
    const compactedPositions = bubblePositions(persistedBubbles);

    fireEvent(
      canvas,
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaX: 24,
        deltaY: -16,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    const expectedViewport = {
      canvas_viewport_x: Number(canvas.getAttribute('data-canvas-x')),
      canvas_viewport_y: Number(canvas.getAttribute('data-canvas-y')),
      canvas_zoom: Number(canvas.getAttribute('data-canvas-zoom')),
    };

    await waitFor(
      () => expect(persistedProject).toMatchObject(expectedViewport),
      { timeout: 1_500 },
    );

    firstSession.unmount();
    render(<App />);

    const reloadedCreatedCard = await screen.findByRole('article', {
      name: 'Focused market thesis',
    });
    const reloadedAnchorCard = screen.getByRole('article', {
      name: 'Existing launch constraint',
    });
    const reloadedCanvas = screen.getByRole('region', {
      name: 'Project canvas',
    });

    expect(reloadedCanvas.getAttribute('data-canvas-x')).toBe(
      String(expectedViewport.canvas_viewport_x),
    );
    expect(reloadedCanvas.getAttribute('data-canvas-y')).toBe(
      String(expectedViewport.canvas_viewport_y),
    );
    expect(reloadedCanvas.getAttribute('data-canvas-zoom')).toBe(
      String(expectedViewport.canvas_zoom),
    );
    expect(reloadedCreatedCard.style.left).toBe(
      `${compactedPositions['bubble-created'].position_x}px`,
    );
    expect(reloadedCreatedCard.style.top).toBe(
      `${compactedPositions['bubble-created'].position_y}px`,
    );
    expect(reloadedAnchorCard.style.left).toBe(
      `${compactedPositions['bubble-anchor'].position_x}px`,
    );
    expect(reloadedAnchorCard.style.top).toBe(
      `${compactedPositions['bubble-anchor'].position_y}px`,
    );

    fireEvent.keyDown(reloadedCreatedCard, { key: 'Enter' });
    expect(reloadedCreatedCard.getAttribute('data-bubble-selected')).toBe('true');
    expect(reloadedAnchorCard.getAttribute('data-bubble-linked')).toBe('true');
    expect(
      screen.getAllByText('Existing launch constraint').length,
    ).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('[data-canvas-content] svg')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete bubble' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete bubble',
      }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole('article', { name: 'Focused market thesis' }),
      ).toBeNull(),
    );
    expect(persistedLinks).toEqual([]);
    expect(frozenDiscussions).toEqual(frozenDiscussionsBeforeDeletion);

    cleanup();
    render(<App />);

    expect(
      await screen.findByRole('article', {
        name: 'Existing launch constraint',
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('article', { name: 'Focused market thesis' }),
    ).toBeNull();
    expect(persistedBubbles.map((candidate) => candidate.id)).toEqual([
      'bubble-anchor',
    ]);
    expect(persistedLinks).toEqual([]);
    expect(frozenDiscussions).toEqual(frozenDiscussionsBeforeDeletion);
  });

  it('cancels an owning feature multi-selection without changing bubble data or positions', async () => {
    const first = bubble();
    const second = bubble({
      id: 'bubble-second',
      title: 'Second context candidate',
      position_x: 420,
      position_y: -80,
      source_kind: 'manual',
      source_discussion_id: null,
      source_message_ids: [],
    });
    const persistedBubbles = [first, second];
    const beforeCancellation = JSON.parse(
      JSON.stringify(persistedBubbles),
    ) as Bubble[];
    const requestPositionUpdate = vi.fn();
    const requestPositionsUpdate = vi.fn();
    const requestBubbleUpdate = vi.fn();

    function MultiSelectionHarness() {
      const [isSelecting, setIsSelecting] = useState(true);

      return (
        <ProjectWorkspace
          canvasMultiSelection={
            isSelecting
              ? {
                  initialBubbleIds: [first.id],
                  instruction: 'Choose frozen discussion context',
                  onCancel: () => setIsSelecting(false),
                  onConfirm: vi.fn(),
                }
              : null
          }
          project={{
            id: projectId,
            title: 'Bubble canvas journey',
            description: 'Cancel selection without changing knowledge.',
            created_at: '2026-07-23T08:00:00.000Z',
            updated_at: '2026-07-23T08:00:00.000Z',
            canvas_viewport_x: 12,
            canvas_viewport_y: -18,
            canvas_zoom: 1.1,
          }}
          requestBubbleLinks={async () => []}
          requestBubbles={async () => persistedBubbles}
          requestBubblePositionUpdate={requestPositionUpdate}
          requestBubblePositionsUpdate={requestPositionsUpdate}
          requestBubbleUpdate={requestBubbleUpdate}
        />
      );
    }

    render(<MultiSelectionHarness />);

    const firstCard = await screen.findByRole('checkbox', {
      name: first.title,
    });
    const secondCard = screen.getByRole('checkbox', {
      name: second.title,
    });
    const positionsBeforeCancellation = {
      first: { left: firstCard.style.left, top: firstCard.style.top },
      second: { left: secondCard.style.left, top: secondCard.style.top },
    };

    fireEvent.pointerDown(secondCard, {
      button: 0,
      clientX: 100,
      clientY: 80,
      pointerId: 32,
    });
    expect(secondCard.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(
        screen
          .getByRole('region', { name: 'Project canvas' })
          .getAttribute('data-selection-mode'),
      ).toBe('single'),
    );
    const restoredFirstCard = screen.getByRole('article', {
      name: first.title,
    });
    const restoredSecondCard = screen.getByRole('article', {
      name: second.title,
    });

    expect({
      first: {
        left: restoredFirstCard.style.left,
        top: restoredFirstCard.style.top,
      },
      second: {
        left: restoredSecondCard.style.left,
        top: restoredSecondCard.style.top,
      },
    }).toEqual(positionsBeforeCancellation);
    expect(persistedBubbles).toEqual(beforeCancellation);
    expect(requestPositionUpdate).not.toHaveBeenCalled();
    expect(requestPositionsUpdate).not.toHaveBeenCalled();
    expect(requestBubbleUpdate).not.toHaveBeenCalled();
  });
});

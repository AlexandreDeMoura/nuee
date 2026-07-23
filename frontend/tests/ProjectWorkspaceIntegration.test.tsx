import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type {
  Bubble,
  BubbleLink,
  Project,
  UpdateBubbleInput,
} from '../src/api';
import type { AnalyticsClient } from '../src/analytics';
import {
  ProjectWorkspace,
  type WorkspaceInspectorSelection,
} from '../src/workspace/ProjectWorkspace';

const project: Project = {
  id: 'project-123',
  title: 'Launch plan',
  description: 'Explore the launch constraints.',
  created_at: '2026-07-20T10:00:00.000Z',
  updated_at: '2026-07-20T10:00:00.000Z',
  canvas_viewport_x: 0,
  canvas_viewport_y: 0,
  canvas_zoom: 1,
};

const requestEmptyBubbles = async () => [];

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function bubble(overrides: Partial<Bubble> = {}): Bubble {
  return {
    id: 'bubble-1',
    project_id: project.id,
    title: 'Market is real but fragmented',
    summary: 'Demand exists, but buyers remain fragmented.',
    content: 'Complete market knowledge.',
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('workspace integration contracts', () => {
  it('restores the viewport supplied by the loaded project', async () => {
    render(
      <ProjectWorkspace
        project={{
          ...project,
          canvas_viewport_x: 96,
          canvas_viewport_y: -144,
          canvas_zoom: 0.75,
        }}
        requestBubbles={requestEmptyBubbles}
      />,
    );

    await screen.findByRole('button', { name: 'Start a discussion' });
    const canvas = screen.getByRole('region', { name: 'Project canvas' });

    expect(canvas.getAttribute('data-canvas-x')).toBe('96');
    expect(canvas.getAttribute('data-canvas-y')).toBe('-144');
    expect(canvas.getAttribute('data-canvas-zoom')).toBe('0.75');
  });

  it('dispatches each empty-canvas action to its owning feature callback', async () => {
    const startDiscussion = vi.fn();
    const createBubble = vi.fn();
    const uploadDocument = vi.fn();

    render(
      <ProjectWorkspace
        project={project}
        requestBubbles={requestEmptyBubbles}
        emptyActionHandlers={{
          'start-discussion': startDiscussion,
          'create-bubble': createBubble,
          'upload-document': uploadDocument,
        }}
      />,
    );

    await screen.findByRole('button', { name: 'Start a discussion' });
    fireEvent.click(screen.getByRole('button', { name: 'Start a discussion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create a bubble' }));
    fireEvent.click(screen.getByRole('button', { name: 'Upload a document' }));

    expect(startDiscussion).toHaveBeenCalledTimes(1);
    expect(createBubble).toHaveBeenCalledTimes(1);
    expect(uploadDocument).toHaveBeenCalledTimes(1);
  });

  it('shows one supplied panel at a time and does not navigate while switching', () => {
    window.history.replaceState({}, '', `/projects/${project.id}`);

    render(
      <ProjectWorkspace
        project={project}
        requestBubbles={requestEmptyBubbles}
        panelSlots={{
          discussions: <p>Supplied discussion list</p>,
          documents: <p>Supplied document list</p>,
          project: <p>Supplied project editor</p>,
        }}
      />,
    );

    const projectTab = screen.getByRole('tab', { name: 'Project' });
    const discussionsTab = screen.getByRole('tab', { name: 'Discussions' });
    const documentsTab = screen.getByRole('tab', { name: 'Documents' });

    expect(projectTab.getAttribute('aria-selected')).toBe('true');
    expect(projectTab.getAttribute('data-active')).toBe('true');
    expect(screen.getByText('Supplied project editor')).toBeTruthy();
    expect(screen.queryByText('Supplied discussion list')).toBeNull();

    fireEvent.click(discussionsTab);

    expect(discussionsTab.getAttribute('aria-selected')).toBe('true');
    expect(projectTab.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByText('Supplied discussion list')).toBeTruthy();
    expect(screen.queryByText('Supplied project editor')).toBeNull();

    fireEvent.click(documentsTab);

    expect(documentsTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Supplied document list')).toBeTruthy();
    expect(screen.queryByText('Supplied discussion list')).toBeNull();
    expect(window.location.pathname).toBe(`/projects/${project.id}`);
  });

  it('provides intentional empty states for unsupplied collection panels', () => {
    render(
      <ProjectWorkspace project={project} requestBubbles={requestEmptyBubbles} />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Discussions' }));
    expect(screen.getByText('No discussions yet')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
    expect(screen.getByText('No documents yet')).toBeTruthy();
    expect(screen.queryByText('No discussions yet')).toBeNull();
  });

  it('gates Inspector content on a valid selection and clears invalid details', () => {
    const validSelection: WorkspaceInspectorSelection = {
      id: 'bubble-42',
      kind: 'bubble',
    };
    const onInvalidated = vi.fn();
    const rendered = render(
      <ProjectWorkspace
        project={project}
        requestBubbles={requestEmptyBubbles}
        inspectorSelection={validSelection}
        onInspectorSelectionInvalidated={onInvalidated}
        panelSlots={{
          inspector: (selection) => <p>Inspecting {selection.id}</p>,
        }}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Inspector' }));
    expect(screen.getByText('Inspecting bubble-42')).toBeTruthy();
    expect(screen.queryByText('Nothing selected')).toBeNull();

    const invalidSelection: WorkspaceInspectorSelection = {
      ...validSelection,
      isValid: false,
    };
    rendered.rerender(
      <ProjectWorkspace
        project={project}
        requestBubbles={requestEmptyBubbles}
        inspectorSelection={invalidSelection}
        onInspectorSelectionInvalidated={onInvalidated}
        panelSlots={{
          inspector: (selection) => <p>Inspecting {selection.id}</p>,
        }}
      />,
    );

    expect(screen.queryByText('Inspecting bubble-42')).toBeNull();
    expect(screen.getByText('Nothing selected')).toBeTruthy();
    expect(onInvalidated).toHaveBeenCalledWith(invalidSelection);
  });

  it('opens the Inspector from a selected bubble and ignores a stale edit response after selection changes', async () => {
    const firstSave = deferred<Bubble>();
    const requestUpdate = vi.fn(
      (
        projectId: string,
        bubbleId: string,
        input: UpdateBubbleInput,
        signal?: AbortSignal,
      ) => {
        void projectId;
        void bubbleId;
        void input;
        void signal;
        return firstSave.promise;
      },
    );
    const track = vi.fn<AnalyticsClient['track']>();
    const secondBubble = bubble({
      id: 'bubble-2',
      title: 'Regulatory lead time',
      summary: null,
      content: 'Licensing requires nine to fourteen months.',
      position_x: 420,
      position_y: 160,
    });

    render(
      <ProjectWorkspace
        analyticsClient={{ track }}
        bubbleSaveDelayMs={0}
        project={project}
        requestBubbles={async () => [bubble(), secondBubble]}
        requestBubbleUpdate={requestUpdate}
      />,
    );

    const firstCard = await screen.findByRole('article', {
      name: 'Market is real but fragmented',
    });
    fireEvent.keyDown(firstCard, { key: 'Enter' });

    expect(screen.getByRole('tab', { name: 'Inspector' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(firstCard.getAttribute('data-bubble-selected')).toBe('true');
    expect(
      document.querySelector('[data-inspector-bubble-id="bubble-1"]'),
    ).toBeTruthy();
    expect(track).toHaveBeenCalledWith('bubble_inspected', {
      project_id: project.id,
      bubble_id: 'bubble-1',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit bubble' }));
    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: 'A response that will become stale' },
    });
    await waitFor(() => expect(requestUpdate).toHaveBeenCalledTimes(1));
    const firstSignal = requestUpdate.mock.calls[0]?.[3];

    const secondCard = screen.getByRole('article', {
      name: 'Regulatory lead time',
    });
    fireEvent.keyDown(secondCard, { key: 'Enter' });

    expect(firstSignal?.aborted).toBe(true);
    expect(firstCard.getAttribute('data-bubble-selected')).toBe('false');
    expect(secondCard.getAttribute('data-bubble-selected')).toBe('true');
    const secondInspector = document.querySelector(
      '[data-inspector-bubble-id="bubble-2"]',
    );
    expect(secondInspector).toBeTruthy();
    expect(secondInspector?.textContent).toContain(
      'Licensing requires nine to fourteen months.',
    );

    await act(async () => {
      firstSave.resolve(
        bubble({
          title: 'A response that will become stale',
          updated_at: '2026-07-23T10:00:00.000Z',
        }),
      );
    });

    expect(
      document.querySelector('[data-inspector-bubble-id="bubble-2"]'),
    ).toBeTruthy();
    expect(
      screen.getByRole('article', { name: 'Market is real but fragmented' }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('article', {
        name: 'A response that will become stale',
      }),
    ).toBeNull();
  });

  it('refreshes the selected Inspector and canvas card after a successful edit', async () => {
    const updatedBubble = bubble({
      title: 'Updated market thesis',
      summary: 'The fragmented market can still support focused entry.',
      content: 'Complete revised market knowledge.',
      updated_at: '2026-07-23T10:00:00.000Z',
    });
    const requestUpdate = vi.fn().mockResolvedValue(updatedBubble);

    render(
      <ProjectWorkspace
        bubbleSaveDelayMs={0}
        project={project}
        requestBubbles={async () => [bubble()]}
        requestBubbleUpdate={requestUpdate}
      />,
    );

    const card = await screen.findByRole('article', {
      name: 'Market is real but fragmented',
    });
    const originalLeft = card.style.left;
    const originalTop = card.style.top;
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit bubble' }));
    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: updatedBubble.title },
    });
    fireEvent.change(screen.getByLabelText(/^Summary/), {
      target: { value: updatedBubble.summary },
    });
    fireEvent.change(screen.getByLabelText(/^Content/), {
      target: { value: updatedBubble.content },
    });

    const updatedCard = await screen.findByRole('article', {
      name: 'Updated market thesis',
    });
    expect(updatedCard.style.left).toBe(originalLeft);
    expect(updatedCard.style.top).toBe(originalTop);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Done editing' }).hasAttribute('disabled')).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));

    const inspector = document.querySelector(
      '[data-inspector-bubble-id="bubble-1"]',
    );
    expect(inspector?.textContent).toContain('Updated market thesis');
    expect(inspector?.textContent).toContain(
      'The fragmented market can still support focused entry.',
    );
    expect(inspector?.textContent).toContain(
      'Complete revised market knowledge.',
    );
  });

  it('highlights only direct symmetric links and updates after unlinking', async () => {
    const secondBubble = bubble({
      id: 'bubble-2',
      title: 'Regulatory lead time',
      position_x: 420,
    });
    const thirdBubble = bubble({
      id: 'bubble-3',
      title: 'Unrelated operations note',
      position_x: 720,
    });
    const link: BubbleLink = {
      id: 'link-1',
      project_id: project.id,
      bubble_a_id: 'bubble-1',
      bubble_b_id: 'bubble-2',
      created_at: '2026-07-23T10:00:00.000Z',
    };
    const requestDeleteLink = vi.fn().mockResolvedValue(undefined);

    render(
      <ProjectWorkspace
        project={project}
        requestBubbles={async () => [bubble(), secondBubble, thirdBubble]}
        requestBubbleLinks={async () => [link]}
        requestBubbleLinkDelete={requestDeleteLink}
      />,
    );

    const firstCard = await screen.findByRole('article', {
      name: 'Market is real but fragmented',
    });
    const secondCard = screen.getByRole('article', {
      name: 'Regulatory lead time',
    });
    const thirdCard = screen.getByRole('article', {
      name: 'Unrelated operations note',
    });

    fireEvent.keyDown(secondCard, { key: 'Enter' });

    expect(firstCard.getAttribute('data-bubble-linked')).toBe('true');
    expect(secondCard.getAttribute('data-bubble-selected')).toBe('true');
    expect(thirdCard.getAttribute('data-bubble-linked')).toBe('false');
    expect(document.querySelector('[data-canvas-content] svg')).toBeNull();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Unlink Market is real but fragmented',
      }),
    );

    await waitFor(() =>
      expect(firstCard.getAttribute('data-bubble-linked')).toBe('false'),
    );
    expect(requestDeleteLink).toHaveBeenCalledWith(
      project.id,
      'bubble-2',
      'bubble-1',
    );
  });

  it('removes a deleted bubble, its link state, and stale Inspector selection', async () => {
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
      created_at: '2026-07-23T10:00:00.000Z',
    };
    const requestDelete = vi.fn().mockResolvedValue(undefined);
    const track = vi.fn<AnalyticsClient['track']>();

    render(
      <ProjectWorkspace
        analyticsClient={{ track }}
        project={project}
        requestBubbleDelete={requestDelete}
        requestBubbles={async () => [bubble(), secondBubble]}
        requestBubbleLinks={async () => [link]}
      />,
    );

    const firstCard = await screen.findByRole('article', {
      name: 'Market is real but fragmented',
    });
    fireEvent.keyDown(firstCard, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete bubble' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete bubble',
      }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole('article', {
          name: 'Market is real but fragmented',
        }),
      ).toBeNull(),
    );
    expect(screen.getByText('Nothing selected')).toBeTruthy();

    const retainedCard = screen.getByRole('article', {
      name: 'Regulatory lead time',
    });
    fireEvent.keyDown(retainedCard, { key: 'Enter' });
    expect(retainedCard.getAttribute('data-bubble-linked')).toBe('false');
    expect(screen.getByText('No bubbles are directly linked yet.')).toBeTruthy();
    expect(requestDelete).toHaveBeenCalledWith(
      project.id,
      'bubble-1',
      expect.any(AbortSignal),
    );
    expect(track).toHaveBeenCalledWith('bubble_deleted', {
      project_id: project.id,
      bubble_id: 'bubble-1',
    });
  });

  it('supports focus-moving keyboard navigation and named native tooltips', () => {
    render(
      <ProjectWorkspace project={project} requestBubbles={requestEmptyBubbles} />,
    );

    const projectTab = screen.getByRole('tab', { name: 'Project' });
    expect(projectTab.getAttribute('title')).toBe('Project');

    projectTab.focus();
    fireEvent.keyDown(projectTab, { key: 'ArrowDown' });

    const inspectorTab = screen.getByRole('tab', { name: 'Inspector' });
    expect(document.activeElement).toBe(inspectorTab);
    expect(inspectorTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Nothing selected')).toBeTruthy();

    fireEvent.keyDown(inspectorTab, { key: 'Home' });

    const discussionsTab = screen.getByRole('tab', { name: 'Discussions' });
    expect(document.activeElement).toBe(discussionsTab);
    expect(discussionsTab.getAttribute('aria-selected')).toBe('true');
  });
});

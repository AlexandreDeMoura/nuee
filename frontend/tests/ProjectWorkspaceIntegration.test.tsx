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
  CreateDiscussionInput,
  DiscussionDetails,
  DocumentSummary,
  DocumentUploadPolicy,
  KnowledgeExtractionProposalResponse,
  KnowledgeExtractionResolutionResponse,
  Project,
  UpdateBubbleInput,
} from '../src/api';
import { ApiError } from '../src/api';
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

function activateButtonWithKeyboard(
  button: HTMLElement,
  key: 'Enter' | ' ' = 'Enter',
) {
  button.focus();
  expect(document.activeElement).toBe(button);
  fireEvent.keyDown(button, { key });
  fireEvent.click(button, { detail: 0 });
  fireEvent.keyUp(button, { key });
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
    source_discussion_title: null,
    source_discussion_deleted_at: null,
    source_message_ids: [],
    source_context_item_ids: [],
    ...overrides,
  };
}

const documentUploadPolicy: DocumentUploadPolicy = {
  max_documents_per_project: 25,
  max_file_size_bytes: 10 * 1024 * 1024,
  max_files_per_request: 1,
  max_project_storage_bytes: 100 * 1024 * 1024,
  supported_formats: [
    {
      category: 'plain_text',
      extensions: ['.txt'],
      mime_types: ['text/plain'],
    },
  ],
};

function documentSummary(
  overrides: Partial<DocumentSummary> = {},
): DocumentSummary {
  return {
    can_retry: false,
    created_at: '2026-07-20T10:00:00.000Z',
    format: 'plain_text',
    id: 'document-1',
    mime_type: 'text/plain',
    original_filename: 'launch-brief.txt',
    processing_error_code: null,
    project_id: project.id,
    size_bytes: 1_024,
    title: 'Launch brief',
    processing_status: 'ready',
    updated_at: '2026-07-20T10:00:01.000Z',
    ...overrides,
  } as DocumentSummary;
}

function discussionDetails(
  overrides: Partial<DiscussionDetails> = {},
): DiscussionDetails {
  return {
    id: 'discussion-1',
    project_id: project.id,
    title: 'Frozen sources',
    frozen_context: {
      version: 1,
      items: [
        {
          id: 'context-project',
          source_kind: 'project_description',
          source_id: project.id,
          source_title: 'Project description',
          frozen_content: 'The frozen project description.',
          created_at: '2026-07-28T08:00:00.000Z',
          display_order: 0,
        },
        {
          id: 'context-bubble',
          source_kind: 'bubble',
          source_id: 'bubble-1',
          source_title: 'Frozen market evidence',
          frozen_content: 'The immutable market evidence.',
          created_at: '2026-07-28T08:00:00.000Z',
          display_order: 1,
        },
      ],
    },
    created_at: '2026-07-28T08:00:00.000Z',
    updated_at: '2026-07-28T08:00:00.001Z',
    last_activity_at: '2026-07-28T08:00:00.001Z',
    messages: [],
    ...overrides,
  };
}

function extractionProposalResponse(): KnowledgeExtractionProposalResponse {
  return {
    created_at: '2026-07-30T08:00:00.000Z',
    discussion_id: 'discussion-1',
    expires_at: '2026-07-31T08:00:00.000Z',
    id: 'extraction-1',
    project_id: project.id,
    proposal: {
      content: 'Licensing must be resolved before launch.',
      summary: 'Licensing is the longest lead-time constraint.',
      title: 'Launch licensing constraint',
    },
    source: {
      frozen_context_item_ids: [],
      message_ids: ['message-assistant-1'],
    },
    status: 'ready',
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('workspace integration contracts', () => {
  it('lands on the canvas without reopening a discussion', async () => {
    render(
      <ProjectWorkspace
        project={project}
        requestBubbles={requestEmptyBubbles}
      />,
    );

    await screen.findByRole('button', { name: 'Start a discussion' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      document.querySelector('[data-workspace-content]')?.hasAttribute('inert'),
    ).toBe(false);
  });

  it('opens and minimizes a write-first discussion above inert workspace content', async () => {
    const onDraftSubmit = vi.fn();

    render(
      <ProjectWorkspace
        project={project}
        requestBubbles={requestEmptyBubbles}
        onDiscussionDraftSubmit={onDraftSubmit}
      />,
    );

    const startButton = await screen.findByRole('button', {
      name: 'Start a discussion',
    });
    startButton.focus();
    fireEvent.click(startButton);

    expect(
      screen.getByRole('dialog', { name: 'New discussion' }),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-workspace-content]')?.hasAttribute('inert'),
    ).toBe(true);

    const prompt = screen.getByRole('textbox', {
      name: 'Discussion prompt',
    });
    fireEvent.change(prompt, {
      target: { value: '  What blocks the launch?  ' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue discussion' }),
    );

    expect(onDraftSubmit).toHaveBeenCalledWith('What blocks the launch?');

    fireEvent.click(
      screen.getByRole('button', { name: 'Minimize discussion' }),
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      document.querySelector('[data-workspace-content]')?.hasAttribute('inert'),
    ).toBe(false);
    expect(document.activeElement).toBe(startButton);
  });

  it('keeps the canvas inert while the discussion and frozen Inspector share one modal focus region', async () => {
    const persisted = discussionDetails();

    render(
      <ProjectWorkspace
        discussionCount={1}
        discussionLifecycleRequests={{
          get: async () => persisted,
        }}
        discussionPanelRequests={{
          list: async () => [
            {
              id: persisted.id,
              project_id: persisted.project_id,
              title: persisted.title,
              created_at: persisted.created_at,
              updated_at: persisted.updated_at,
              last_activity_at: persisted.last_activity_at,
              is_active: true,
            },
          ],
          recordOpen: async () => persisted,
        }}
        project={project}
        requestBubbles={requestEmptyBubbles}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Open discussion: Frozen sources',
      }),
    );
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Inspect frozen context: Frozen market evidence',
      }),
    );

    const modal = screen.getByRole('dialog', { name: 'Frozen sources' });
    const inspector = within(modal).getByRole('region', {
      name: 'Frozen market evidence',
    });
    expect(inspector.textContent).toContain('The immutable market evidence.');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(
      document.querySelector('[data-workspace-content]')?.hasAttribute('inert'),
    ).toBe(true);
    expect(
      document
        .querySelector('[data-workspace-content]')
        ?.getAttribute('aria-hidden'),
    ).toBe('true');

    const closeInspector = within(modal).getByRole('button', {
      name: 'Close frozen context Inspector',
    });
    expect(document.activeElement).toBe(closeInspector);
    const firstModalAction = within(modal).getByRole('button', {
      name: 'Extract knowledge from discussion',
    });
    const lastModalAction = within(modal).getByRole('textbox', {
      name: 'Discussion message',
    });
    firstModalAction.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastModalAction);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', {
      name: 'Frozen market evidence',
    })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Frozen sources' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      document.querySelector('[data-workspace-content]')?.hasAttribute('inert'),
    ).toBe(false);
  });

  it('guides a keyboard extraction through all three request steps and adds the approved bubble', async () => {
    const persisted = discussionDetails({
      title: 'Launch review',
      messages: [
        {
          content: 'What blocks the launch?',
          created_at: '2026-07-28T08:00:00.000Z',
          discussion_id: 'discussion-1',
          id: 'message-user-1',
          request_id: 'request-1',
          role: 'user',
          status: 'completed',
        },
        {
          content: 'Licensing is the longest lead-time constraint.',
          created_at: '2026-07-28T08:00:00.001Z',
          discussion_id: 'discussion-1',
          id: 'message-assistant-1',
          request_id: null,
          role: 'assistant',
          status: 'completed',
        },
      ],
    });
    const extractedBubble = bubble({
      content: 'Licensing must be resolved before launch.',
      id: 'bubble-extracted',
      position_x: 696,
      position_y: -120,
      source_discussion_id: persisted.id,
      source_discussion_title: persisted.title,
      source_kind: 'discussion',
      source_message_ids: [
        'message-user-1',
        'message-assistant-1',
      ],
      summary: 'Licensing is the longest lead-time constraint.',
      title: 'Launch licensing constraint',
    });
    const guidedProposal = {
      ...extractionProposalResponse(),
      source: {
        frozen_context_item_ids: [],
        message_ids: [
          'message-user-1',
          'message-assistant-1',
        ],
      },
    };
    const create = vi.fn(async () => guidedProposal);
    const resolution = deferred<KnowledgeExtractionResolutionResponse>();
    const resolve = vi.fn(() => resolution.promise);
    const recordOpen = vi.fn(async () => persisted);

    render(
      <ProjectWorkspace
        discussionCount={1}
        discussionLifecycleRequests={{ get: async () => persisted }}
        discussionPanelRequests={{
          list: async () => [
            {
              created_at: persisted.created_at,
              id: persisted.id,
              is_active: true,
              last_activity_at: persisted.last_activity_at,
              project_id: persisted.project_id,
              title: persisted.title,
              updated_at: persisted.updated_at,
            },
          ],
          recordOpen,
        }}
        extractionRequests={{
          create,
          resolve,
        }}
        project={project}
        requestBubbleLinks={async () => []}
        requestBubbles={requestEmptyBubbles}
      />,
    );

    activateButtonWithKeyboard(
      await screen.findByRole('button', {
        name: 'Open discussion: Launch review',
      }),
    );
    activateButtonWithKeyboard(
      await screen.findByRole('button', {
        name: 'Extract knowledge from this response',
      }),
    );

    activateButtonWithKeyboard(
      screen.getByRole('button', { name: 'Select all' }),
      ' ',
    );
    expect(
      screen.getByText('2 of 2 messages').getAttribute('role'),
    ).toBe('status');

    const instructions = screen.getByRole('textbox', {
      name: /Tell Nuée/,
    });
    instructions.focus();
    expect(document.activeElement).toBe(instructions);
    fireEvent.change(instructions, {
      target: {
        value: 'Frame this as a launch decision and keep the caveat.',
      },
    });

    activateButtonWithKeyboard(
      screen.getByRole('radio', { name: /Detailed/ }),
      ' ',
    );
    activateButtonWithKeyboard(
      screen.getByRole('button', { name: 'Generate bubble' }),
    );

    expect(create).toHaveBeenCalledWith(
      project.id,
      persisted.id,
      {
        detail_level: 'detailed',
        frozen_context_item_ids: [],
        idempotency_key: expect.any(String),
        instructions:
          'Frame this as a launch decision and keep the caveat.',
        message_ids: [
          'message-user-1',
          'message-assistant-1',
        ],
      },
      expect.any(AbortSignal),
    );
    activateButtonWithKeyboard(
      await screen.findByRole('button', {
        name: 'Approve as new bubble',
      }),
    );

    expect(resolve).toHaveBeenCalledWith(
      project.id,
      persisted.id,
      'extraction-1',
      {
        kind: 'new_bubble',
        proposal: guidedProposal.proposal,
      },
      expect.any(AbortSignal),
    );
    expect(
      document.querySelector(
        `[data-bubble-id="${extractedBubble.id}"]`,
      ),
    ).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: 'Approving…',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    resolution.resolve({
      discussion_id: persisted.id,
      id: 'extraction-1',
      project_id: project.id,
      resolution: {
        bubble: extractedBubble,
        kind: 'new_bubble',
      },
      status: 'resolved',
    });

    const card = await waitFor(() => {
      const persistedCard = document.querySelector<HTMLElement>(
        `[data-bubble-id="${extractedBubble.id}"]`,
      );

      expect(persistedCard).not.toBeNull();
      return persistedCard as HTMLElement;
    });
    expect(card.style.left).toBe('696px');
    expect(card.style.top).toBe('-120px');
    expect(
      document.querySelectorAll(
        `[data-bubble-id="${extractedBubble.id}"]`,
      ),
    ).toHaveLength(1);
    expect(
      screen.queryByRole('heading', {
        name: 'Review knowledge proposal',
      }),
    ).toBeNull();
    expect(recordOpen).toHaveBeenCalledTimes(1);
  });

  it('selects one extraction target by keyboard, refreshes conflicts, and replaces the canonical bubble after reconfirmation', async () => {
    const persisted = discussionDetails({
      title: 'Launch review',
      messages: [
        {
          content: 'What blocks the launch?',
          created_at: '2026-07-28T08:00:00.000Z',
          discussion_id: 'discussion-1',
          id: 'message-user-1',
          request_id: 'request-1',
          role: 'user',
          status: 'completed',
        },
        {
          content: 'Licensing is the longest lead-time constraint.',
          created_at: '2026-07-28T08:00:00.001Z',
          discussion_id: 'discussion-1',
          id: 'message-assistant-1',
          request_id: null,
          role: 'assistant',
          status: 'completed',
        },
      ],
    });
    const target = bubble({
      content: `## Market evidence

**Demand** remains fragmented.`,
      summary: null,
    });
    const linkedBubble = bubble({
      id: 'bubble-2',
      position_x: 420,
      title: 'Regulatory lead time',
    });
    const foreignBubble = bubble({
      id: 'foreign-bubble',
      project_id: 'another-project',
      title: 'Another project target',
    });
    const link: BubbleLink = {
      bubble_a_id: target.id,
      bubble_b_id: linkedBubble.id,
      created_at: '2026-07-20T11:00:00.000Z',
      id: 'link-1',
      project_id: project.id,
    };
    const changedTarget = {
      content: 'The current target changed in another tab.',
      id: target.id,
      summary: 'A newer target summary.',
      title: 'Market thesis changed elsewhere',
      updated_at: '2026-07-30T09:00:00.000Z',
    };
    const updatedTarget = bubble({
      content: extractionProposalResponse().proposal.content,
      position_x: 999,
      position_y: 999,
      source_discussion_id: persisted.id,
      source_discussion_title: persisted.title,
      source_kind: 'discussion',
      source_message_ids: ['message-assistant-1'],
      summary: extractionProposalResponse().proposal.summary,
      title: extractionProposalResponse().proposal.title,
      updated_at: '2026-07-30T09:01:00.000Z',
    });
    const updatedResponse: KnowledgeExtractionResolutionResponse = {
      discussion_id: persisted.id,
      id: 'extraction-1',
      project_id: project.id,
      resolution: {
        bubble: updatedTarget,
        kind: 'update_bubble',
      },
      status: 'resolved',
    };
    const resolve = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(409, {
          code: 'KNOWLEDGE_EXTRACTION_TARGET_CHANGED',
          current_target: changedTarget,
          message:
            'The target bubble changed after it was selected. Review the current target before confirming again.',
        }),
      )
      .mockResolvedValueOnce(updatedResponse);
    const track = vi.fn<AnalyticsClient['track']>();

    render(
      <ProjectWorkspace
        analyticsClient={{ track }}
        discussionCount={1}
        discussionLifecycleRequests={{ get: async () => persisted }}
        discussionPanelRequests={{
          list: async () => [
            {
              created_at: persisted.created_at,
              id: persisted.id,
              is_active: true,
              last_activity_at: persisted.last_activity_at,
              project_id: persisted.project_id,
              title: persisted.title,
              updated_at: persisted.updated_at,
            },
          ],
          recordOpen: async () => persisted,
        }}
        extractionRequests={{
          create: async () => extractionProposalResponse(),
          resolve,
        }}
        project={project}
        requestBubbleLinks={async () => [link]}
        requestBubbles={async () => [
          target,
          linkedBubble,
          foreignBubble,
        ]}
      />,
    );

    const targetCard = await screen.findByRole('article', {
      name: target.title,
    });
    const originalLeft = targetCard.style.left;
    const originalTop = targetCard.style.top;
    fireEvent.keyDown(targetCard, { key: 'Enter' });
    activateButtonWithKeyboard(
      screen.getByRole('tab', { name: 'Discussions' }),
    );
    activateButtonWithKeyboard(
      await screen.findByRole('button', {
        name: 'Open discussion: Launch review',
      }),
    );
    activateButtonWithKeyboard(
      await screen.findByRole('button', {
        name: 'Extract knowledge from this response',
      }),
    );
    activateButtonWithKeyboard(
      screen.getByRole('button', { name: 'Generate bubble' }),
    );
    activateButtonWithKeyboard(
      await screen.findByRole('button', {
        name: 'Update an existing bubble',
      }),
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      document.querySelector('[data-workspace-content]')?.hasAttribute('inert'),
    ).toBe(false);
    expect(
      screen.getByRole('toolbar', { name: 'Bubble selection' }).textContent,
    ).toContain('Choose one bubble to update');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Cancel' }),
    );
    expect(
      screen.queryByRole('checkbox', { name: foreignBubble.title }),
    ).toBeNull();

    activateButtonWithKeyboard(
      screen.getByRole('button', { name: 'Cancel' }),
    );

    expect(
      await screen.findByRole('heading', {
        name: 'Review knowledge proposal',
      }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Title',
        }) as HTMLInputElement
      ).value,
    ).toBe(extractionProposalResponse().proposal.title);
    expect(resolve).not.toHaveBeenCalled();

    activateButtonWithKeyboard(
      screen.getByRole('button', {
        name: 'Update an existing bubble',
      }),
    );
    const targetOption = await screen.findByRole('checkbox', {
      name: target.title,
    });
    const linkedOption = screen.getByRole('checkbox', {
      name: linkedBubble.title,
    });
    fireEvent.keyDown(targetOption, { key: 'Enter' });
    fireEvent.keyDown(linkedOption, { key: 'Enter' });

    expect(targetOption.getAttribute('aria-checked')).toBe('false');
    expect(linkedOption.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('1 SELECTED')).toBeTruthy();

    fireEvent.keyDown(targetOption, { key: 'Enter' });
    activateButtonWithKeyboard(
      screen.getByRole('button', {
        name: 'Use this bubble (1 selected)',
      }),
    );

    expect(
      await screen.findByText('Selected update target'),
    ).toBeTruthy();
    expect(
      within(
        screen.getByText('Selected update target').closest('section') as HTMLElement,
      ).getByText('Market evidence Demand remains fragmented.'),
    ).toBeTruthy();
    expect(screen.getAllByText(target.title).length).toBeGreaterThan(1);
    expect(resolve).not.toHaveBeenCalled();
    expect(
      document.querySelector(`[data-bubble-id="${target.id}"]`)
        ?.textContent,
    ).toContain(target.title);

    activateButtonWithKeyboard(
      screen.getByRole('button', { name: 'Confirm bubble update' }),
    );

    expect(resolve).toHaveBeenNthCalledWith(
      1,
      project.id,
      persisted.id,
      'extraction-1',
      {
        expected_updated_at: target.updated_at,
        kind: 'update_bubble',
        proposal: extractionProposalResponse().proposal,
        target_bubble_id: target.id,
      },
      expect.any(AbortSignal),
    );
    expect(
      await screen.findByText('The target bubble changed'),
    ).toBeTruthy();
    expect(screen.getByText(changedTarget.title)).toBeTruthy();
    expect(
      document.querySelector(`[data-bubble-id="${target.id}"]`)
        ?.textContent,
    ).toContain(target.title);

    activateButtonWithKeyboard(
      screen.getByRole('button', { name: 'Confirm bubble update' }),
    );

    expect(resolve).toHaveBeenNthCalledWith(
      2,
      project.id,
      persisted.id,
      'extraction-1',
      {
        expected_updated_at: changedTarget.updated_at,
        kind: 'update_bubble',
        proposal: extractionProposalResponse().proposal,
        target_bubble_id: target.id,
      },
      expect.any(AbortSignal),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', {
          name: 'Review knowledge proposal',
        }),
      ).toBeNull(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Minimize discussion' }),
    );

    const updatedCard = await screen.findByRole('article', {
      name: updatedTarget.title,
    });
    expect(updatedCard.style.left).toBe(originalLeft);
    expect(updatedCard.style.top).toBe(originalTop);
    expect(updatedCard.getAttribute('data-bubble-selected')).toBe('true');
    expect(
      screen
        .getByRole('article', { name: linkedBubble.title })
        .getAttribute('data-bubble-linked'),
    ).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: 'Inspector' }));
    const inspector = document.querySelector(
      `[data-inspector-bubble-id="${target.id}"]`,
    );
    expect(inspector?.textContent).toContain(updatedTarget.title);
    expect(inspector?.textContent).toContain(updatedTarget.content);

    const extractionResolutionEvents = track.mock.calls.filter(
      ([event]) =>
        event === 'knowledge_extraction_resolution_finished',
    );

    expect(extractionResolutionEvents).toEqual([
      [
        'knowledge_extraction_resolution_finished',
        expect.objectContaining({
          project_id: project.id,
          discussion_id: persisted.id,
          resolution: 'update_bubble',
          status: 'target_changed',
          latency_ms: expect.any(Number),
        }),
      ],
      [
        'knowledge_extraction_resolution_finished',
        expect.objectContaining({
          project_id: project.id,
          discussion_id: persisted.id,
          resolution: 'update_bubble',
          status: 'succeeded',
          latency_ms: expect.any(Number),
        }),
      ],
    ]);

    const serializedEvents = JSON.stringify(
      track.mock.calls.filter(([event]) =>
        event.startsWith('knowledge_extraction_'),
      ),
    );

    for (const forbiddenContent of [
      persisted.messages[0].content,
      persisted.messages[1].content,
      persisted.title,
      extractionProposalResponse().proposal.title,
      extractionProposalResponse().proposal.summary,
      extractionProposalResponse().proposal.content,
      target.title,
      target.content,
      changedTarget.title,
      changedTarget.content,
      updatedTarget.title,
      updatedTarget.content,
    ]) {
      expect(serializedEvents).not.toContain(forbiddenContent);
    }
  });

  it('can start a discussion from the panel when the canvas is not empty', async () => {
    render(
      <ProjectWorkspace
        discussionPanelRequests={{ list: async () => [] }}
        project={project}
        requestBubbles={async () => [bubble()]}
      />,
    );

    await screen.findByRole('region', { name: 'Project canvas' });
    expect(
      screen.queryByRole('button', { name: 'Start a discussion' }),
    ).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Discussions' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Start a discussion' }),
    );

    expect(
      screen.getByRole('dialog', { name: 'New discussion' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('combobox', { name: 'Discussion prompt' }),
    ).toBeTruthy();
  });

  it('starts a discussion from the populated canvas action bar', async () => {
    render(
      <ProjectWorkspace
        project={project}
        requestBubbles={async () => [bubble()]}
      />,
    );

    const startButton = await screen.findByRole('button', {
      name: 'New discussion',
    });
    startButton.focus();
    fireEvent.click(startButton);

    expect(
      screen.getByRole('dialog', { name: 'New discussion' }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Minimize discussion' }),
    );

    expect(document.activeElement).toBe(startButton);
  });

  it('submits write-first drafts directly with project context only', async () => {
    const creation = deferred<DiscussionDetails>();
    const create = vi.fn(() => creation.promise);

    render(
      <ProjectWorkspace
        discussionLifecycleRequests={{ create }}
        project={project}
        requestBubbles={requestEmptyBubbles}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Start a discussion' }),
    );
    const prompt = screen.getByRole('combobox', {
      name: 'Discussion prompt',
    });
    fireEvent.change(prompt, {
      target: { value: 'What blocks the launch?' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue discussion' }),
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      project.id,
      {
        project_id: project.id,
        first_prompt: 'What blocks the launch?',
        idempotency_key: expect.any(String),
        bubble_ids: [],
        document_ids: [],
      },
      expect.any(AbortSignal),
    );
    expect(
      screen.queryByRole('heading', { name: 'Choose what Nuée should use' }),
    ).toBeNull();
  });

  it('seeds the selected canvas bubble as a removable draft chip', async () => {
    const selectedBubble = bubble();
    const create = vi.fn(
      () => new Promise<DiscussionDetails>(() => undefined),
    );

    render(
      <ProjectWorkspace
        discussionLifecycleRequests={{ create }}
        project={project}
        requestBubbles={async () => [selectedBubble]}
      />,
    );

    const bubbleCard = await screen.findByRole('article', {
      name: selectedBubble.title,
    });
    fireEvent.keyDown(bubbleCard, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'New discussion' }));

    const chip = document.querySelector(
      `[data-discussion-mention-chip="bubble:${selectedBubble.id}"]`,
    );
    expect(chip?.textContent).toContain(selectedBubble.title);
    expect(
      document
        .querySelector('[aria-label="Project canvas"]')
        ?.getAttribute('data-selection-mode'),
    ).toBe('single');

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Discussion prompt' }),
      { target: { value: 'Which evidence should guide the launch?' } },
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue discussion' }),
    );

    expect(create).toHaveBeenCalledWith(
      project.id,
      expect.objectContaining({
        bubble_ids: [selectedBubble.id],
        document_ids: [],
        first_prompt: 'Which evidence should guide the launch?',
      }),
      expect.any(AbortSignal),
    );
  });

  it('attaches ready whole documents in the draft without activating the Documents panel selector', async () => {
    const readyDocument = documentSummary();
    const pendingDocument = documentSummary({
      id: 'document-pending',
      processing_status: 'processing',
      title: 'Market research',
    });
    const create = vi.fn(
      () => new Promise<DiscussionDetails>(() => undefined),
    );

    render(
      <ProjectWorkspace
        discussionLifecycleRequests={{ create }}
        documentLibraryRequests={{
          list: async () => [readyDocument, pendingDocument],
          policy: async () => documentUploadPolicy,
        }}
        project={project}
        requestBubbles={requestEmptyBubbles}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Start a discussion' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Discussion prompt' }),
      ).toBeTruthy(),
    );
    const prompt = screen.getByRole<HTMLTextAreaElement>('combobox', {
      name: 'Discussion prompt',
    });
    fireEvent.change(prompt, {
      target: {
        selectionStart: 'Summarize @'.length,
        value: 'Summarize @',
      },
    });

    const readyOption = await screen.findByRole('option', {
      name: /Launch brief/,
    });
    expect(
      screen.getByRole<HTMLButtonElement>('option', {
        name: /Market research/,
      }).disabled,
    ).toBe(true);
    fireEvent.click(readyOption);
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue discussion' }),
    );

    expect(create).toHaveBeenCalledWith(
      project.id,
      expect.objectContaining({
        bubble_ids: [],
        document_ids: [readyDocument.id],
        first_prompt: 'Summarize Launch brief',
      }),
      expect.any(AbortSignal),
    );
    expect(
      screen.queryByRole('heading', {
        name: 'Choose documents for this discussion',
      }),
    ).toBeNull();
  });

  it('keeps a failed inline-context submission recoverable with the same request identity', async () => {
    const inputs: CreateDiscussionInput[] = [];
    const create = vi.fn(
      async (
        _requestedProjectId: string,
        input: CreateDiscussionInput,
      ) => {
        inputs.push(input);

        if (inputs.length === 1) {
          throw new ApiError(503, {
            code: 'DISCUSSION_SNAPSHOT_PERSISTENCE_FAILED',
            message: 'The selected source changed.',
          });
        }

        return new Promise<DiscussionDetails>(() => undefined);
      },
    );

    render(
      <ProjectWorkspace
        discussionLifecycleRequests={{ create }}
        project={project}
        requestBubbles={requestEmptyBubbles}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Start a discussion' }),
    );
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Discussion prompt' }),
      { target: { value: 'What changed?' } },
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue discussion' }),
    );

    expect(await screen.findByText('The selected source changed.')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue discussion' }),
    );

    await waitFor(() => expect(inputs).toHaveLength(2));
    expect(inputs[1]).toEqual(inputs[0]);
  });

  it('marks an invalid draft chip and rotates request identity after removal', async () => {
    const selectedBubble = bubble();
    const inputs: CreateDiscussionInput[] = [];
    const create = vi.fn(
      async (
        _requestedProjectId: string,
        input: CreateDiscussionInput,
      ) => {
        inputs.push(input);

        if (inputs.length === 1) {
          throw new ApiError(422, {
            code: 'DISCUSSION_CONTEXT_SOURCE_INVALID',
            message: 'One or more selected context sources are unavailable.',
            source_errors: [
              {
                source_kind: 'bubble',
                source_id: selectedBubble.id,
                reason: 'missing',
              },
            ],
          });
        }

        return new Promise<DiscussionDetails>(() => undefined);
      },
    );

    render(
      <ProjectWorkspace
        discussionLifecycleRequests={{ create }}
        project={project}
        requestBubbles={async () => [selectedBubble]}
      />,
    );

    const bubbleCard = await screen.findByRole('article', {
      name: selectedBubble.title,
    });
    fireEvent.keyDown(bubbleCard, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'New discussion' }));
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Discussion prompt' }),
      { target: { value: 'What changed?' } },
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue discussion' }),
    );

    await waitFor(() =>
      expect(
        document.querySelector('[data-context-source-issue="missing"]'),
      ).toBeTruthy(),
    );
    expect(
      screen.getByText(
        'This source was deleted or is no longer available.',
      ),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', {
        name: `Remove bubble: ${selectedBubble.title}`,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue discussion' }),
    );

    await waitFor(() => expect(inputs).toHaveLength(2));
    expect(inputs[0].bubble_ids).toEqual([selectedBubble.id]);
    expect(inputs[1].bubble_ids).toEqual([]);
    expect(inputs[1].idempotency_key).not.toBe(
      inputs[0].idempotency_key,
    );
  });

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

  it('opens the Documents panel and file picker from the default empty-canvas action', async () => {
    const listDocuments = vi.fn(async () => []);
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click');

    render(
      <ProjectWorkspace
        documentLibraryRequests={{
          list: listDocuments,
          policy: async () => documentUploadPolicy,
        }}
        project={project}
        requestBubbles={requestEmptyBubbles}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Upload a document' }),
    );

    expect(
      screen.getByRole('tab', { name: 'Documents' }).getAttribute(
        'aria-selected',
      ),
    ).toBe('true');
    await waitFor(() => expect(inputClick).toHaveBeenCalledTimes(1));
    expect(listDocuments).toHaveBeenCalledWith(
      project.id,
      expect.any(AbortSignal),
    );
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

  it('provides intentional empty states for unsupplied collection panels', async () => {
    render(
      <ProjectWorkspace
        documentLibraryRequests={{
          list: async () => [],
          policy: async () => documentUploadPolicy,
        }}
        discussionPanelRequests={{ list: async () => [] }}
        project={project}
        requestBubbles={requestEmptyBubbles}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Discussions' }));
    expect(await screen.findByText('No discussions yet')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
    expect(await screen.findByText('No documents yet')).toBeTruthy();
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

  it('passes an owning feature multi-selection flow to the canvas and suspends workspace tools', async () => {
    const onCancel = vi.fn();

    render(
      <ProjectWorkspace
        canvasMultiSelection={{
          instruction: 'Choose discussion context',
          onCancel,
          onConfirm: vi.fn(),
        }}
        project={project}
        requestBubbles={async () => [bubble()]}
      />,
    );

    await screen.findByRole('checkbox', {
      name: 'Market is real but fragmented',
    });

    expect(
      screen.getByRole('region', { name: 'Project canvas' }).getAttribute(
        'data-selection-mode',
      ),
    ).toBe('multiple');
    expect(
      document
        .querySelector('aside[aria-label="Project tools"]')
        ?.getAttribute('aria-hidden'),
    ).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
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

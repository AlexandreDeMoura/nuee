import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  ApiError,
  type CreateDiscussionInput,
  type DiscussionDetails,
  type FrozenContext,
  type SendMessageInput,
} from '../src/api';
import type { AnalyticsClient } from '../src/analytics';
import {
  DiscussionExperience,
  useDiscussionVisibility,
  type DiscussionContextInspection,
  type DiscussionLifecycleRequests,
  type DiscussionKnowledgeSource,
} from '../src/discussions';

const projectId = 'project-1';
const projectDescription = 'A frozen launch description.';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

const keepTemporaryTitle: NonNullable<
  DiscussionLifecycleRequests['generateTitle']
> = () => new Promise<DiscussionDetails>(() => undefined);

function details(
  overrides: Partial<DiscussionDetails> = {},
): DiscussionDetails {
  return {
    id: 'discussion-1',
    project_id: projectId,
    title: 'New discussion',
    frozen_context: {
      version: 1,
      items: [
        {
          id: 'context-project-1',
          source_kind: 'project_description',
          source_id: projectId,
          source_title: 'Project description',
          frozen_content: projectDescription,
          created_at: '2026-07-28T08:00:00.000Z',
          display_order: 0,
        },
      ],
    },
    created_at: '2026-07-28T08:00:00.000Z',
    updated_at: '2026-07-28T08:00:00.001Z',
    last_activity_at: '2026-07-28T08:00:00.001Z',
    messages: [
      {
        id: 'message-user-1',
        discussion_id: 'discussion-1',
        role: 'user',
        content: 'What blocks the launch?',
        created_at: '2026-07-28T08:00:00.000Z',
        status: 'completed',
        request_id: 'request-1',
      },
      {
        id: 'message-assistant-1',
        discussion_id: 'discussion-1',
        role: 'assistant',
        content: 'Licensing is the longest lead-time constraint.',
        created_at: '2026-07-28T08:00:00.001Z',
        status: 'completed',
        request_id: null,
      },
    ],
    ...overrides,
  };
}

function Harness({
  analyticsClient,
  onDiscussionChanged,
  onExtractKnowledge,
  onInspectContext,
  requests,
}: {
  analyticsClient?: AnalyticsClient;
  onDiscussionChanged?: (discussion: DiscussionDetails) => void;
  onExtractKnowledge?: (source: DiscussionKnowledgeSource) => void;
  onInspectContext?: (inspection: DiscussionContextInspection) => void;
  requests?: DiscussionLifecycleRequests;
}) {
  const controller = useDiscussionVisibility(projectId);
  const [, rerender] = useState(0);

  return (
    <>
      <button type="button" onClick={controller.openDraft}>
        Start
      </button>
      <button
        type="button"
        onClick={() => {
          controller.openDiscussion({
            id: 'discussion-1',
            title: 'Existing discussion',
          });
          rerender((value) => value + 1);
        }}
      >
        Open first
      </button>
      <button
        type="button"
        onClick={() =>
          controller.openDiscussion({
            id: 'discussion-2',
            title: 'Second discussion',
          })
        }
      >
        Open second
      </button>
      <DiscussionExperience
        analyticsClient={analyticsClient}
        controller={controller}
        onDiscussionChanged={onDiscussionChanged}
        onExtractKnowledge={onExtractKnowledge}
        onInspectContext={onInspectContext}
        projectId={projectId}
        requests={{ generateTitle: keepTemporaryTitle, ...requests }}
      />
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DiscussionExperience', () => {
  it('generates a placeholder title without blocking the discussion and publishes the update', async () => {
    const generated = deferred<DiscussionDetails>();
    const generateTitle = vi.fn(() => generated.promise);
    const onDiscussionChanged = vi.fn();
    const track = vi.fn<AnalyticsClient['track']>();

    render(
      <Harness
        analyticsClient={{ track }}
        onDiscussionChanged={onDiscussionChanged}
        requests={{
          generateTitle,
          get: async () => details(),
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));

    const temporaryTitle = await screen.findByText('New discussion', {
      selector: 'h2',
    });
    expect(temporaryTitle.dataset.temporaryTitle).toBe('true');
    expect(
      screen.getByText('Licensing is the longest lead-time constraint.'),
    ).toBeTruthy();
    await waitFor(() => expect(generateTitle).toHaveBeenCalledTimes(1));
    expect(generateTitle).toHaveBeenCalledWith(
      projectId,
      'discussion-1',
      expect.any(AbortSignal),
    );

    await act(async () =>
      generated.resolve(
        details({
          title: 'Launch licensing constraint',
          updated_at: '2026-07-28T08:00:02.000Z',
        }),
      ),
    );

    expect(
      await screen.findByRole('dialog', {
        name: 'Launch licensing constraint',
      }),
    ).toBeTruthy();
    expect(
      screen.getByText('Launch licensing constraint').dataset.temporaryTitle,
    ).toBeUndefined();
    expect(onDiscussionChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Launch licensing constraint' }),
    );
    expect(track).toHaveBeenCalledWith(
      'discussion_title_generated',
      expect.objectContaining({
        project_id: projectId,
        discussion_id: 'discussion-1',
        occurred_at: expect.any(String),
        latency_ms: expect.any(Number),
      }),
    );
  });

  it('projects every persisted context item, expands overflow, and inspects the frozen body inside the modal', async () => {
    const onExtractKnowledge = vi.fn();
    const onInspectContext = vi.fn();
    const track = vi.fn<AnalyticsClient['track']>();
    const contextItems: FrozenContext = {
      version: 1,
      items: [
        {
          id: 'context-project',
          source_kind: 'project_description',
          source_id: projectId,
          source_title: 'Project description',
          frozen_content: projectDescription,
          created_at: '2026-07-28T08:00:00.000Z',
          display_order: 0,
        },
        {
          id: 'context-bubble-1',
          source_kind: 'bubble',
          source_id: 'bubble-1',
          source_title: 'Launch risks',
          frozen_content: 'The frozen licensing risk body.',
          created_at: '2026-07-28T08:00:00.000Z',
          display_order: 1,
        },
        {
          id: 'context-document-1',
          source_kind: 'document',
          source_id: 'document-1',
          source_title: 'Launch brief',
          frozen_content: 'The complete frozen launch brief.',
          created_at: '2026-07-28T08:00:00.000Z',
          display_order: 2,
        },
        {
          id: 'context-bubble-2',
          source_kind: 'bubble',
          source_id: 'bubble-2',
          source_title: 'Go-to-market notes',
          frozen_content: 'A second frozen bubble body.',
          created_at: '2026-07-28T08:00:00.000Z',
          display_order: 3,
        },
      ],
    };
    const launchRiskItem = contextItems.items[1];

    expect(launchRiskItem).toBeTruthy();

    render(
      <Harness
        analyticsClient={{ track }}
        onExtractKnowledge={onExtractKnowledge}
        onInspectContext={onInspectContext}
        requests={{
          get: async () =>
            details({
              frozen_context: contextItems,
              title: 'Launch constraints',
            }),
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));

    expect(
      await screen.findByLabelText('4 frozen context items'),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', {
        name: 'Inspect frozen context: Go-to-market notes',
      }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Show all 4 frozen context items',
      }),
    );
    expect(
      screen.getByRole('button', {
        name: 'Inspect frozen context: Go-to-market notes',
      }),
    ).toBeTruthy();

    const launchRiskBadge = screen.getByRole('button', {
      name: 'Inspect frozen context: Launch risks',
    });
    fireEvent.click(launchRiskBadge);

    const inspector = screen.getByRole('region', { name: 'Launch risks' });
    expect(inspector.textContent).toContain('Frozen discussion context');
    expect(inspector.textContent).toContain('Bubble');
    expect(inspector.textContent).toContain(
      'The frozen licensing risk body.',
    );
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    expect(onInspectContext).toHaveBeenCalledWith({
      discussionId: 'discussion-1',
      item: launchRiskItem,
    });
    expect(track).toHaveBeenCalledWith('discussion_context_inspected', {
      project_id: projectId,
      discussion_id: 'discussion-1',
      context_id: 'context-bubble-1',
      source_kind: 'bubble',
      occurred_at: expect.any(String),
    });

    const closeInspector = screen.getByRole('button', {
      name: 'Close frozen context Inspector',
    });
    expect(document.activeElement).toBe(closeInspector);
    fireEvent.click(closeInspector);

    await waitFor(() => expect(document.activeElement).toBe(launchRiskBadge));
    expect(
      screen.queryByRole('region', { name: 'Launch risks' }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Extract knowledge from discussion',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Extract knowledge from this response',
      }),
    );

    expect(onExtractKnowledge.mock.calls).toEqual([
      [{ discussionId: 'discussion-1' }],
      [
        {
          discussionId: 'discussion-1',
          messageId: 'message-assistant-1',
        },
      ],
    ]);
  });

  it('uses frozen source titles and bodies again after minimizing and reopening', async () => {
    const frozenBubble = {
      id: 'context-bubble-1',
      source_kind: 'bubble' as const,
      source_id: 'bubble-1',
      source_title: 'Original frozen title',
      frozen_content: 'Original frozen body.',
      created_at: '2026-07-28T08:00:00.000Z',
      display_order: 1,
    };
    const persisted = details({
      frozen_context: {
        version: 1,
        items: [
          {
            id: 'context-project',
            source_kind: 'project_description',
            source_id: projectId,
            source_title: 'Project description',
            frozen_content: projectDescription,
            created_at: '2026-07-28T08:00:00.000Z',
            display_order: 0,
          },
          frozenBubble,
        ],
      },
    });

    render(<Harness requests={{ get: async () => persisted }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Inspect frozen context: Original frozen title',
      }),
    );
    expect(screen.getByText('Original frozen body.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Minimize discussion' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Inspect frozen context: Original frozen title',
      }),
    );
    expect(screen.getByText('Original frozen body.')).toBeTruthy();
  });

  it('submits a normalized draft once, renders pending, then replaces it with chronological persisted messages', async () => {
    const creation = deferred<DiscussionDetails>();
    const created = details();
    const create = vi.fn(() => creation.promise);
    const get = vi.fn(async () => created);

    render(<Harness requests={{ create, get }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    const prompt = screen.getByRole('textbox', {
      name: 'Discussion prompt',
    });
    const continueButton = screen.getByRole('button', {
      name: 'Continue discussion',
    });
    fireEvent.change(prompt, { target: { value: '   ' } });
    expect((continueButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(prompt, {
      target: { value: '  What blocks the launch?  ' },
    });
    fireEvent.keyDown(prompt, { key: 'Enter', shiftKey: true });
    expect(create).not.toHaveBeenCalled();
    fireEvent.keyDown(prompt, { key: 'Enter' });
    fireEvent.keyDown(prompt, { key: 'Enter' });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      projectId,
      {
        project_id: projectId,
        first_prompt: 'What blocks the launch?',
        idempotency_key: expect.any(String),
        bubble_ids: [],
        document_ids: [],
      },
      expect.any(AbortSignal),
    );
    expect(
      document.querySelectorAll('[data-message-role="user"]'),
    ).toHaveLength(1);
    expect(
      screen.getAllByText('Generating a focused response…').length,
    ).toBeGreaterThan(0);

    await act(async () => creation.resolve(created));

    const thread = await screen.findByLabelText('Discussion messages');
    const renderedMessages = Array.from(
      thread.querySelectorAll<HTMLElement>('[data-message-role]'),
    );

    expect(renderedMessages.map((message) => message.dataset.messageRole)).toEqual([
      'user',
      'assistant',
    ]);
    expect(within(renderedMessages[0]).getByText('What blocks the launch?')).toBeTruthy();
    expect(
      within(renderedMessages[1]).getByText(
        'Licensing is the longest lead-time constraint.',
      ),
    ).toBeTruthy();
    expect(get).toHaveBeenCalledWith(
      projectId,
      created.id,
      expect.any(AbortSignal),
    );
  });

  it('reuses the creation idempotency key after a recoverable request failure', async () => {
    const inputs: CreateDiscussionInput[] = [];
    const create = vi.fn(
      async (
        _projectId: string,
        input: CreateDiscussionInput,
      ) => {
        inputs.push(input);

        if (inputs.length === 1) {
          throw new Error('Creation connection failed.');
        }

        return details();
      },
    );

    render(
      <Harness
        requests={{
          create,
          get: async () => details(),
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Discussion prompt' }),
      {
        target: { value: 'What blocks the launch?' },
      },
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue discussion' }),
    );

    expect(await screen.findByText('Creation connection failed.')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue discussion' }),
    );

    expect(
      await screen.findByText(
        'Licensing is the longest lead-time constraint.',
      ),
    ).toBeTruthy();
    expect(inputs).toHaveLength(2);
    expect(inputs[1].idempotency_key).toBe(inputs[0].idempotency_key);
    expect(inputs[0]).toEqual({
      project_id: projectId,
      first_prompt: 'What blocks the launch?',
      idempotency_key: expect.any(String),
      bubble_ids: [],
      document_ids: [],
    });
  });

  it('rotates the creation idempotency key after the prompt changes', async () => {
    const inputs: CreateDiscussionInput[] = [];
    const create = vi.fn(
      async (
        _projectId: string,
        input: CreateDiscussionInput,
      ) => {
        inputs.push(input);

        if (inputs.length === 1) {
          throw new Error('Creation connection failed.');
        }

        return new Promise<DiscussionDetails>(() => undefined);
      },
    );

    render(<Harness requests={{ create }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    const prompt = screen.getByRole('textbox', {
      name: 'Discussion prompt',
    });
    fireEvent.change(prompt, {
      target: { value: 'What blocks the launch?' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue discussion' }),
    );

    expect(await screen.findByText('Creation connection failed.')).toBeTruthy();
    fireEvent.change(prompt, {
      target: { value: 'What changed before launch?' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue discussion' }),
    );

    await waitFor(() => expect(inputs).toHaveLength(2));
    expect(inputs[1].first_prompt).toBe('What changed before launch?');
    expect(inputs[1].idempotency_key).not.toBe(
      inputs[0].idempotency_key,
    );
  });

  it('shows a data error instead of rendering an incomplete context package', async () => {
    render(
      <Harness
        requests={{
          get: async () => ({
            ...details(),
            frozen_context: {
              version: 1,
              items: [],
            },
          }),
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));

    expect(await screen.findByText('Discussion unavailable')).toBeTruthy();
    expect(
      screen.getByText(
        'The discussion response contained invalid data.',
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText(
        'Licensing is the longest lead-time constraint.',
      ),
    ).toBeNull();
    expect(screen.queryByLabelText('1 frozen context item')).toBeNull();
  });

  it('marks an accepted generation failure separately and retries with the same request identity', async () => {
    const failedDetails = details({
      messages: [
        ...details().messages,
        {
          id: 'message-user-2',
          discussion_id: 'discussion-1',
          role: 'user',
          content: 'What should happen next?',
          created_at: '2026-07-28T08:00:01.000Z',
          status: 'failed',
          request_id: 'captured-by-test',
        },
      ],
    });
    const completedDetails = details({
      updated_at: '2026-07-28T08:00:01.001Z',
      last_activity_at: '2026-07-28T08:00:01.001Z',
      messages: [
        ...details().messages,
        {
          id: 'message-user-2',
          discussion_id: 'discussion-1',
          role: 'user',
          content: 'What should happen next?',
          created_at: '2026-07-28T08:00:01.000Z',
          status: 'completed',
          request_id: 'captured-by-test',
        },
        {
          id: 'message-assistant-2',
          discussion_id: 'discussion-1',
          role: 'assistant',
          content: 'Resolve licensing before committing the date.',
          created_at: '2026-07-28T08:00:01.001Z',
          status: 'completed',
          request_id: null,
        },
      ],
    });
    let submittedInput: SendMessageInput | undefined;
    const send = vi.fn(
      async (
        _projectId: string,
        _discussionId: string,
        input: SendMessageInput,
      ) => {
        submittedInput = input;
        throw new ApiError(503, {
          code: 'AI_GENERATION_FAILED',
          message: 'The response could not be generated.',
          discussion_id: 'discussion-1',
          request_id: input.idempotency_key,
        });
      },
    );
    const retry = vi.fn(
      async (
        _projectId: string,
        _discussionId: string,
        input: SendMessageInput,
      ) => ({
        ...completedDetails,
        messages: completedDetails.messages.map((message) =>
          message.id === 'message-user-2'
            ? { ...message, request_id: input.idempotency_key }
            : message,
        ),
      }),
    );

    render(
      <Harness
        requests={{
          get: async () => details(),
          retry,
          send,
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));

    const composer = await screen.findByRole('textbox', {
      name: 'Discussion message',
    });
    fireEvent.change(composer, {
      target: { value: 'What should happen next?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Response failed')).toBeTruthy();
    expect(screen.getAllByText('What should happen next?')).toHaveLength(1);
    expect((composer as HTMLTextAreaElement).value).toBe('');

    fireEvent.click(
      screen.getByRole('button', { name: 'Retry response' }),
    );

    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    expect(retry).toHaveBeenCalledWith(
      projectId,
      'discussion-1',
      {
        content: 'What should happen next?',
        idempotency_key: submittedInput?.idempotency_key,
      },
      expect.any(AbortSignal),
    );
    expect(
      await screen.findByText('Resolve licensing before committing the date.'),
    ).toBeTruthy();
    expect(screen.getAllByText('What should happen next?')).toHaveLength(1);
    expect(failedDetails.messages[2].status).toBe('failed');
  });

  it('preserves composer text and reuses its key after an invalid mutation response', async () => {
    const inputs: SendMessageInput[] = [];
    const send = vi.fn(
      async (
        _projectId: string,
        _discussionId: string,
        input: SendMessageInput,
      ) => {
        inputs.push(input);

        if (inputs.length === 1) {
          return { ...details(), project_id: 'another-project' };
        }

        return details({
          messages: [
            ...details().messages,
            {
              id: 'message-user-2',
              discussion_id: 'discussion-1',
              role: 'user',
              content: input.content,
              created_at: '2026-07-28T08:00:01.000Z',
              status: 'completed',
              request_id: input.idempotency_key,
            },
            {
              id: 'message-assistant-2',
              discussion_id: 'discussion-1',
              role: 'assistant',
              content: 'A recovered response.',
              created_at: '2026-07-28T08:00:01.001Z',
              status: 'completed',
              request_id: null,
            },
          ],
        });
      },
    );

    render(
      <Harness requests={{ get: async () => details(), send }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));

    const composer = await screen.findByRole('textbox', {
      name: 'Discussion message',
    });
    fireEvent.change(composer, { target: { value: 'Keep this text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(
      await screen.findByText(
        'The discussion response contained invalid data.',
      ),
    ).toBeTruthy();
    expect((composer as HTMLTextAreaElement).value).toBe('Keep this text');

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('A recovered response.')).toBeTruthy();
    expect(inputs).toHaveLength(2);
    expect(inputs[1].idempotency_key).toBe(inputs[0].idempotency_key);
  });

  it('aborts an old load and ignores its stale response when another discussion opens', async () => {
    const firstLoad = deferred<DiscussionDetails>();
    const secondLoad = deferred<DiscussionDetails>();
    let firstSignal: AbortSignal | undefined;
    const get = vi.fn(
      (
        _projectId: string,
        discussionId: string,
        signal?: AbortSignal,
      ) => {
        if (discussionId === 'discussion-1') {
          firstSignal = signal;
          return firstLoad.promise;
        }

        return secondLoad.promise;
      },
    );

    render(<Harness requests={{ get }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
    expect(await screen.findByText('Loading discussion…')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open second' }));
    expect(firstSignal?.aborted).toBe(true);

    await act(async () =>
      firstLoad.resolve(
        details({
          title: 'Stale first discussion',
        }),
      ),
    );
    await act(async () =>
      secondLoad.resolve(
        details({
          id: 'discussion-2',
          title: 'Current second discussion',
          messages: [],
        }),
      ),
    );

    expect(
      await screen.findByRole('dialog', {
        name: 'Current second discussion',
      }),
    ).toBeTruthy();
    expect(screen.queryByText('Stale first discussion')).toBeNull();
  });

  it('recovers a persisted first prompt after creation reports AI failure', async () => {
    const track = vi.fn<AnalyticsClient['track']>();
    const failed = details({
      messages: [
        {
          id: 'message-user-1',
          discussion_id: 'discussion-1',
          role: 'user',
          content: 'Preserve this question',
          created_at: '2026-07-28T08:00:00.000Z',
          status: 'failed',
          request_id: 'request-recovery',
        },
      ],
    });
    const create = vi.fn(async () => {
      throw new ApiError(503, {
        code: 'AI_GENERATION_FAILED',
        message: 'Generation failed.',
        discussion_id: 'discussion-1',
        request_id: 'request-recovery',
      });
    });
    const get = vi.fn(async () => failed);

    render(
      <Harness
        analyticsClient={{ track }}
        requests={{ create, get }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    const prompt = screen.getByRole('textbox', {
      name: 'Discussion prompt',
    });
    fireEvent.change(prompt, {
      target: { value: 'Preserve this question' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue discussion' }),
    );

    expect(await screen.findByText('Response failed')).toBeTruthy();
    expect(screen.getAllByText('Preserve this question')).toHaveLength(1);
    expect(get).toHaveBeenCalledWith(
      projectId,
      'discussion-1',
      expect.any(AbortSignal),
    );
    expect(track.mock.calls.map(([event]) => event)).toEqual([
      'discussion_created',
      'discussion_first_prompt_submitted',
      'discussion_response_failed',
    ]);
    expect(track).toHaveBeenLastCalledWith(
      'discussion_response_failed',
      expect.objectContaining({
        project_id: projectId,
        discussion_id: 'discussion-1',
        request_id: 'request-recovery',
        occurred_at: expect.any(String),
        latency_ms: expect.any(Number),
      }),
    );
  });

  it('records accepted creation and model outcomes without discussion content', async () => {
    const track = vi.fn<AnalyticsClient['track']>();
    const analyticsClient: AnalyticsClient = { track };
    const created = details();

    render(
      <Harness
        analyticsClient={analyticsClient}
        requests={{
          create: async () => created,
          get: async () => created,
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Discussion prompt' }),
      {
        target: { value: 'What blocks the launch?' },
      },
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue discussion' }),
    );

    await screen.findByText('Licensing is the longest lead-time constraint.');
    await waitFor(() => expect(track).toHaveBeenCalledTimes(3));
    const transcript = screen.getByRole('log', {
      name: 'Discussion messages',
    });
    expect(
      within(transcript).getByRole('article', { name: 'Your message' }),
    ).toBeTruthy();
    expect(
      within(transcript).getByRole('article', { name: 'AI response' }),
    ).toBeTruthy();

    expect(track.mock.calls.map(([event]) => event)).toEqual([
      'discussion_created',
      'discussion_first_prompt_submitted',
      'discussion_response_completed',
    ]);
    expect(track).toHaveBeenCalledWith('discussion_created', {
      project_id: projectId,
      discussion_id: 'discussion-1',
      occurred_at: created.created_at,
    });
    expect(track).toHaveBeenCalledWith(
      'discussion_response_completed',
      expect.objectContaining({
        project_id: projectId,
        discussion_id: 'discussion-1',
        request_id: 'request-1',
        occurred_at: '2026-07-28T08:00:00.001Z',
        latency_ms: expect.any(Number),
      }),
    );

    const serializedEvents = JSON.stringify(track.mock.calls);
    expect(serializedEvents).not.toContain('What blocks the launch?');
    expect(serializedEvents).not.toContain(
      'Licensing is the longest lead-time constraint.',
    );
    expect(serializedEvents).not.toContain(projectDescription);
    expect(serializedEvents).not.toContain(created.title);
  });
});

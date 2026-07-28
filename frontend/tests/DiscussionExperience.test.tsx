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
  type DiscussionDetails,
  type SendMessageInput,
} from '../src/api';
import {
  DiscussionExperience,
  useDiscussionVisibility,
  type DiscussionLifecycleRequests,
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

function details(
  overrides: Partial<DiscussionDetails> = {},
): DiscussionDetails {
  return {
    id: 'discussion-1',
    project_id: projectId,
    title: 'New discussion',
    frozen_context: {
      project_description: { content: projectDescription },
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
  requests,
}: {
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
        controller={controller}
        projectDescription={projectDescription}
        projectId={projectId}
        requests={requests}
      />
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DiscussionExperience', () => {
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
        frozen_context: {
          project_description: { content: projectDescription },
        },
        first_prompt: 'What blocks the launch?',
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

    render(<Harness requests={{ create, get }} />);
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
  });
});

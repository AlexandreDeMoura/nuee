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
  type KnowledgeExtractionProposalResponse,
  type KnowledgeExtractionResolutionResponse,
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
import type { KnowledgeExtractionRequests } from '../src/knowledge-extraction';

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

const generatedProposal = {
  title: 'Launch licensing constraint',
  summary: 'Licensing is the longest lead-time constraint.',
  content:
    'Licensing must be resolved before the launch date can be committed.',
};

function proposalResponse(): KnowledgeExtractionProposalResponse {
  return {
    id: 'extraction-1',
    project_id: projectId,
    discussion_id: 'discussion-1',
    status: 'ready',
    proposal: { ...generatedProposal },
    source: {
      message_selection_kind: 'selected',
      message_ids: ['message-assistant-1'],
      frozen_context_item_ids: [],
    },
    created_at: '2026-07-30T08:00:00.000Z',
    expires_at: '2026-07-31T08:00:00.000Z',
  };
}

function rejectedResponse(): KnowledgeExtractionResolutionResponse {
  return {
    id: 'extraction-1',
    project_id: projectId,
    discussion_id: 'discussion-1',
    status: 'resolved',
    resolution: { kind: 'reject' },
  };
}

function Harness({
  analyticsClient,
  createExtractionAttemptId,
  extractionRequests,
  onDiscussionChanged,
  onExtractKnowledge,
  onInspectContext,
  requests,
}: {
  analyticsClient?: AnalyticsClient;
  createExtractionAttemptId?: () => string;
  extractionRequests?: KnowledgeExtractionRequests;
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
        createExtractionAttemptId={createExtractionAttemptId}
        extractionRequests={extractionRequests}
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
  it('selects mixed non-consecutive messages and frozen snapshots from a header-launched flow', async () => {
    const create = vi.fn<
      NonNullable<KnowledgeExtractionRequests['create']>
    >(
      () => new Promise<never>(() => undefined),
    );
    const extendedDetails = details({
      messages: [
        ...details().messages,
        {
          id: 'message-user-2',
          discussion_id: 'discussion-1',
          role: 'user',
          content: 'What uncertainty remains?',
          created_at: '2026-07-28T08:00:01.000Z',
          status: 'completed',
          request_id: 'request-2',
        },
        {
          id: 'message-assistant-2',
          discussion_id: 'discussion-1',
          role: 'assistant',
          content: 'The approval date is still uncertain.',
          created_at: '2026-07-28T08:00:01.001Z',
          status: 'completed',
          request_id: null,
        },
      ],
    });

    render(
      <Harness
        createExtractionAttemptId={() => 'extraction-attempt-1'}
        extractionRequests={{ create }}
        requests={{ get: async () => extendedDetails }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));

    const headerAction = await screen.findByRole('button', {
      name: 'Extract knowledge from discussion',
    });
    fireEvent.click(headerAction);

    expect(
      screen.getByRole('heading', { name: 'Choose source material' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('group', { name: 'Individual message sources' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('group', { name: 'Frozen context sources' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'These are the stored copies attached to this discussion, not current live project content.',
      ),
    ).toBeTruthy();

    const generate = screen.getByRole('button', {
      name: 'Generate proposal',
    }) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);

    const messageSources = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-extraction-source-kind="message"]',
      ),
    );
    expect(messageSources).toHaveLength(4);
    expect(
      messageSources.every(
        (source) => source.getAttribute('aria-pressed') === 'false',
      ),
    ).toBe(true);

    fireEvent.click(messageSources[0]);
    fireEvent.click(messageSources[3]);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Select frozen context: Project description',
      }),
    );

    expect(messageSources[0].getAttribute('aria-pressed')).toBe('true');
    expect(messageSources[1].getAttribute('aria-pressed')).toBe('false');
    expect(messageSources[2].getAttribute('aria-pressed')).toBe('false');
    expect(messageSources[3].getAttribute('aria-pressed')).toBe('true');
    expect(generate.disabled).toBe(false);

    fireEvent.click(generate);

    expect(create).toHaveBeenCalledWith(
      projectId,
      'discussion-1',
      {
        frozen_context_item_ids: ['context-project-1'],
        idempotency_key: 'extraction-attempt-1',
        message_selection: {
          kind: 'selected',
          message_ids: ['message-user-1', 'message-assistant-2'],
        },
      },
      expect.any(AbortSignal),
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'Generating proposal…',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('preselects only the assistant response entry point and allows deselection', async () => {
    render(
      <Harness
        requests={{ get: async () => details() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
    const responseAction = await screen.findByRole('button', {
      name: 'Extract knowledge from this response',
    });
    fireEvent.click(responseAction);

    const userSource = document.querySelector<HTMLButtonElement>(
      '[data-extraction-source-id="message-user-1"]',
    );
    const assistantSource = document.querySelector<HTMLButtonElement>(
      '[data-extraction-source-id="message-assistant-1"]',
    );
    const frozenSource = screen.getByRole('button', {
      name: 'Select frozen context: Project description',
    });
    const generate = screen.getByRole('button', {
      name: 'Generate proposal',
    }) as HTMLButtonElement;

    expect(userSource?.getAttribute('aria-pressed')).toBe('false');
    expect(assistantSource?.getAttribute('aria-pressed')).toBe('true');
    expect(frozenSource.getAttribute('aria-pressed')).toBe('false');
    expect(generate.disabled).toBe(false);
    expect(document.activeElement).toBe(assistantSource);

    fireEvent.click(assistantSource!);
    expect(assistantSource?.getAttribute('aria-pressed')).toBe('false');
    expect(generate.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      const restoredAction = screen.getByRole('button', {
        name: 'Extract knowledge from this response',
      });

      expect(document.activeElement).toBe(restoredAction);
      expect(restoredAction).not.toBe(responseAction);
    });
  });

  it('submits whole-discussion scope without expanding it into client message identifiers', async () => {
    const create = vi.fn<
      NonNullable<KnowledgeExtractionRequests['create']>
    >(
      () => new Promise<never>(() => undefined),
    );

    render(
      <Harness
        createExtractionAttemptId={() => 'whole-discussion-attempt'}
        extractionRequests={{ create }}
        requests={{ get: async () => details() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Extract knowledge from discussion',
      }),
    );

    const wholeDiscussion = screen.getByRole('button', {
      name: 'Select complete discussion for extraction',
    });
    fireEvent.click(wholeDiscussion);
    expect(wholeDiscussion.getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByText(
        'Complete discussion (2 messages) selected.',
      ),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Generate proposal' }),
    );

    expect(create).toHaveBeenCalledWith(
      projectId,
      'discussion-1',
      {
        frozen_context_item_ids: [],
        idempotency_key: 'whole-discussion-attempt',
        message_selection: { kind: 'whole_discussion' },
      },
      expect.any(AbortSignal),
    );
  });

  it('keeps a failed generation selection retryable with the same attempt identity', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(503, {
          code: 'KNOWLEDGE_EXTRACTION_GENERATION_FAILED',
          message: 'The extraction model is temporarily unavailable.',
        }),
      )
      .mockImplementationOnce(
        () => new Promise<never>(() => undefined),
      );

    render(
      <Harness
        createExtractionAttemptId={() => 'retryable-attempt'}
        extractionRequests={{ create }}
        requests={{ get: async () => details() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Extract knowledge from this response',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate proposal' }),
    );

    expect(
      await screen.findByText(
        'The extraction model is temporarily unavailable.',
      ),
    ).toBeTruthy();
    const selectedAssistant = document.querySelector<HTMLButtonElement>(
      '[data-extraction-source-id="message-assistant-1"]',
    );
    expect(selectedAssistant?.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(
      screen.getByRole('button', { name: 'Retry generation' }),
    );

    expect(create).toHaveBeenCalledTimes(2);
    const firstInput = create.mock.calls[0]?.[2];
    const retryInput = create.mock.calls[1]?.[2];
    expect(retryInput).toEqual(firstInput);
    expect(firstInput.idempotency_key).toBe('retryable-attempt');
  });

  it('identifies and focuses a source rejected during server-side resolution', async () => {
    const create = vi.fn().mockRejectedValue(
      new ApiError(422, {
        code: 'KNOWLEDGE_EXTRACTION_SOURCE_INVALID',
        message: 'The selected response is no longer available.',
        source_errors: [
          {
            reason: 'missing',
            source_id: 'message-assistant-1',
            source_kind: 'message',
          },
        ],
      }),
    );

    render(
      <Harness
        createExtractionAttemptId={() => 'invalid-source-attempt'}
        extractionRequests={{ create }}
        requests={{ get: async () => details() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Extract knowledge from this response',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate proposal' }),
    );

    expect(
      await screen.findByText(
        'The selected response is no longer available.',
      ),
    ).toBeTruthy();
    const affectedSource = document.querySelector<HTMLButtonElement>(
      '[data-extraction-source-id="message-assistant-1"]',
    );
    expect(affectedSource?.getAttribute('aria-invalid')).toBe('true');
    expect(affectedSource?.textContent).toContain(
      'This source no longer exists.',
    );
    expect(document.activeElement).toBe(affectedSource);
    expect(
      (
        screen.getByRole('button', {
          name: 'Generate proposal',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(affectedSource!);
    expect(
      (
        screen.getByRole('button', {
          name: 'Generate proposal',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('does not offer pending, failed, or empty sources for extraction', async () => {
    const unavailable = details({
      frozen_context: {
        version: 1,
        items: [
          {
            id: 'context-project-1',
            source_kind: 'project_description',
            source_id: projectId,
            source_title: 'Project description',
            frozen_content: '',
            created_at: '2026-07-28T08:00:00.000Z',
            display_order: 0,
          },
        ],
      },
      messages: [
        {
          id: 'message-pending',
          discussion_id: 'discussion-1',
          role: 'user',
          content: 'Pending user content',
          created_at: '2026-07-28T08:00:00.000Z',
          status: 'pending',
          request_id: 'request-pending',
        },
        {
          id: 'message-failed',
          discussion_id: 'discussion-1',
          role: 'user',
          content: 'Failed user content',
          created_at: '2026-07-28T08:00:00.001Z',
          status: 'failed',
          request_id: 'request-failed',
        },
      ],
    });

    render(
      <Harness requests={{ get: async () => unavailable }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));

    const headerAction = await screen.findByRole('button', {
      name: 'Extract knowledge from discussion',
    });
    expect((headerAction as HTMLButtonElement).disabled).toBe(true);
    expect(headerAction.getAttribute('title')).toBe(
      'Complete a message or add non-empty frozen context first',
    );
    expect(
      screen.queryByRole('button', {
        name: 'Extract knowledge from this response',
      }),
    ).toBeNull();
    expect(
      document.querySelector('[data-extraction-source-kind]'),
    ).toBeNull();
  });

  it('does not expose an optimistic pending turn as a selectable source', async () => {
    const send = vi.fn(
      () => new Promise<DiscussionDetails>(() => undefined),
    );

    render(
      <Harness
        requests={{
          get: async () => details(),
          send,
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
    fireEvent.change(
      await screen.findByRole('textbox', {
        name: 'Discussion message',
      }),
      {
        target: { value: 'An optimistic message still being persisted' },
      },
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Send message' }),
    );
    expect(
      screen.getAllByText('An optimistic message still being persisted'),
    ).toHaveLength(2);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Extract knowledge from this response',
      }),
    );

    expect(
      screen.queryByText('An optimistic message still being persisted'),
    ).toBeNull();
    expect(
      document.querySelectorAll(
        '[data-extraction-source-kind="message"]',
      ),
    ).toHaveLength(2);
    expect(
      document.querySelector(
        '[data-extraction-source-id^="optimistic:"]',
      ),
    ).toBeNull();
  });

  it('discards local source selection when minimized and offers a fresh flow after reopening', async () => {
    render(<Harness requests={{ get: async () => details() }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Extract knowledge from this response',
      }),
    );

    expect(
      screen.getByRole('heading', { name: 'Choose source material' }),
    ).toBeTruthy();
    expect(
      document
        .querySelector('[data-extraction-source-id="message-assistant-1"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');

    fireEvent.click(
      screen.getByRole('button', { name: 'Minimize discussion' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
    const headerAction = await screen.findByRole('button', {
      name: 'Extract knowledge from discussion',
    });
    expect((headerAction as HTMLButtonElement).disabled).toBe(false);
    expect(
      screen.queryByRole('heading', { name: 'Choose source material' }),
    ).toBeNull();
  });

  it('reviews and edits plain-text proposal fields without changing discussion sources', async () => {
    const persistedDetails = details();
    const create = vi.fn(async () => proposalResponse());

    render(
      <Harness
        extractionRequests={{ create }}
        requests={{ get: async () => persistedDetails }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Extract knowledge from this response',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate proposal' }),
    );

    expect(
      await screen.findByRole('heading', {
        name: 'Review knowledge proposal',
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Proposal generated. Edit the plain text below before choosing what happens next. Nothing has been added to the canvas.',
      ).getAttribute('role'),
    ).toBe('status');

    const title = screen.getByRole('textbox', {
      name: 'Title',
    }) as HTMLInputElement;
    const summary = screen.getByRole('textbox', {
      name: 'One-sentence summary',
    }) as HTMLInputElement;
    const content = screen.getByRole('textbox', {
      name: 'Content',
    }) as HTMLTextAreaElement;

    expect(title.value).toBe(generatedProposal.title);
    expect(summary.value).toBe(generatedProposal.summary);
    expect(content.value).toBe(generatedProposal.content);
    expect(document.activeElement).toBe(title);
    expect(
      document.querySelectorAll(
        '[data-knowledge-extraction-resolution-action]',
      ),
    ).toHaveLength(3);
    expect(
      screen.getByRole('button', { name: 'Approve as new bubble' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Update an existing bubble',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Reject' }),
    ).toBeTruthy();

    fireEvent.change(title, { target: { value: 'Edited title' } });
    fireEvent.change(summary, { target: { value: '' } });
    fireEvent.change(content, {
      target: { value: 'Edited self-contained content.' },
    });
    expect(title.value).toBe('Edited title');
    expect(summary.value).toBe('');
    expect(content.value).toBe('Edited self-contained content.');
    expect(summary.getAttribute('aria-invalid')).toBeNull();
    expect(persistedDetails.messages[1].content).toBe(
      'Licensing is the longest lead-time constraint.',
    );
    expect(
      persistedDetails.frozen_context.items[0].frozen_content,
    ).toBe(projectDescription);

    fireEvent.change(title, { target: { value: '   ' } });
    fireEvent.blur(title);
    fireEvent.change(content, { target: { value: '\n  ' } });
    fireEvent.blur(content);

    expect(screen.getByText('Title is required.')).toBeTruthy();
    expect(screen.getByText('Content is required.')).toBeTruthy();
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(content.getAttribute('aria-invalid')).toBe('true');
    expect(title.getAttribute('aria-describedby')).toBe(
      screen.getByText('Title is required.').id,
    );
    expect(content.getAttribute('aria-describedby')).toBe(
      screen.getByText('Content is required.').id,
    );
  });

  it('rejects a proposal without creating a bubble and restores focus to its entry point', async () => {
    const resolve = vi.fn(async () => rejectedResponse());

    render(
      <Harness
        extractionRequests={{
          create: async () => proposalResponse(),
          resolve,
        }}
        requests={{ get: async () => details() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Extract knowledge from this response',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate proposal' }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Reject' }),
    );

    expect(resolve).toHaveBeenCalledWith(
      projectId,
      'discussion-1',
      'extraction-1',
      { kind: 'reject' },
      expect.any(AbortSignal),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', {
          name: 'Review knowledge proposal',
        }),
      ).toBeNull();
    });
    expect(
      screen.getByText('Licensing is the longest lead-time constraint.'),
    ).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', {
          name: 'Extract knowledge from this response',
        }),
      ),
    );
  });

  it('confirms Escape close, traps confirmation focus, and does not restore a discarded proposal', async () => {
    const discard = vi.fn(async () => undefined);
    const resolve = vi.fn<
      NonNullable<KnowledgeExtractionRequests['resolve']>
    >();

    render(
      <Harness
        extractionRequests={{
          create: async () => proposalResponse(),
          discard,
          resolve,
        }}
        requests={{ get: async () => details() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Extract knowledge from this response',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate proposal' }),
    );

    const title = await screen.findByRole('textbox', {
      name: 'Title',
    });
    fireEvent.change(title, { target: { value: 'Unsaved review edit' } });
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(
      screen.getByRole('alertdialog', {
        name: 'Discard this knowledge proposal?',
      }),
    ).toBeTruthy();
    expect(
      document
        .querySelector('[data-discussion-overlay]')
        ?.hasAttribute('inert'),
    ).toBe(true);
    const keepReviewing = screen.getByRole('button', {
      name: 'Keep reviewing',
    });
    const discardProposal = screen.getByRole('button', {
      name: 'Discard proposal',
    });
    expect(document.activeElement).toBe(keepReviewing);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(discardProposal);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(title);
    expect((title as HTMLInputElement).value).toBe('Unsaved review edit');
    expect(discard).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'Minimize discussion' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Discard proposal' }),
    );

    expect(discard).toHaveBeenCalledWith(
      projectId,
      'discussion-1',
      'extraction-1',
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
    expect(
      await screen.findByRole('button', {
        name: 'Extract knowledge from discussion',
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('heading', {
        name: 'Review knowledge proposal',
      }),
    ).toBeNull();
    expect(
      screen.queryByDisplayValue('Unsaved review edit'),
    ).toBeNull();
  });

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

    const headerExtractionAction = screen.getByRole('button', {
      name: 'Extract knowledge from discussion',
    });
    fireEvent.click(headerExtractionAction);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(headerExtractionAction),
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

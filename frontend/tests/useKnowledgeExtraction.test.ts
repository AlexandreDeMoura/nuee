import { act } from 'react';
import {
  cleanup,
  renderHook,
  waitFor,
} from '@testing-library/react';
import type {
  CreateKnowledgeExtractionInput,
  DiscussionDetails,
  KnowledgeExtractionProposalResponse,
} from '@nuee/shared-types';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  ApiError,
  type Bubble,
  type KnowledgeExtractionResolutionResponse,
} from '../src/api';
import type { AnalyticsClient } from '../src/analytics';
import { useKnowledgeExtraction } from '../src/knowledge-extraction';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function proposalResponse(
  overrides: Partial<KnowledgeExtractionProposalResponse> = {},
): KnowledgeExtractionProposalResponse {
  return {
    created_at: '2026-07-30T08:00:00.000Z',
    discussion_id: 'discussion-1',
    expires_at: '2026-07-31T08:00:00.000Z',
    id: 'extraction-1',
    project_id: 'project-1',
    proposal: {
      content: 'A reusable conclusion with its caveat preserved.',
      summary: 'The discussion reached a qualified conclusion.',
      title: 'Qualified conclusion',
    },
    source: {
      frozen_context_item_ids: ['context-1'],
      message_ids: ['message-1'],
    },
    status: 'ready',
    ...overrides,
  };
}

function bubble(
  overrides: Partial<Bubble> = {},
): Bubble {
  return {
    content: 'Existing target content.',
    created_at: '2026-07-30T07:00:00.000Z',
    id: 'bubble-1',
    project_id: 'project-1',
    territory_id: 'territory-1',
    source_context_item_ids: [],
    source_discussion_deleted_at: null,
    source_discussion_id: null,
    source_discussion_title: null,
    source_kind: 'manual',
    source_message_ids: [],
    summary: null,
    title: 'Existing target',
    updated_at: '2026-07-30T07:00:00.000Z',
    ...overrides,
  };
}

function newBubbleResolution(): KnowledgeExtractionResolutionResponse {
  return {
    discussion_id: 'discussion-1',
    id: 'extraction-1',
    project_id: 'project-1',
    resolution: {
      bubble: bubble({
        content: 'A reusable conclusion with its caveat preserved.',
        source_discussion_id: 'discussion-1',
        source_discussion_title: 'Tradeoff review',
        source_kind: 'discussion',
        source_message_ids: ['message-1'],
        summary: 'The discussion reached a qualified conclusion.',
        title: 'Qualified conclusion',
      }),
      kind: 'new_bubble',
    },
    status: 'resolved',
  };
}

function analyticsDiscussion(): DiscussionDetails {
  return {
    created_at: '2026-07-30T07:00:00.000Z',
    frozen_context: {
      version: 1,
      items: [
        {
          created_at: '2026-07-30T07:00:00.000Z',
          display_order: 0,
          frozen_content: 'Private frozen project description.',
          id: 'context-project',
          source_id: 'project-1',
          source_kind: 'project_description',
          source_title: 'Project description',
        },
        {
          created_at: '2026-07-30T07:00:00.000Z',
          display_order: 1,
          frozen_content: 'Private frozen strategy body.',
          id: 'context-1',
          source_id: 'document-1',
          source_kind: 'document',
          source_title: 'Private strategy document',
        },
      ],
    },
    id: 'discussion-1',
    last_activity_at: '2026-07-30T07:00:00.001Z',
    messages: [
      {
        content: 'Private selected discussion message.',
        created_at: '2026-07-30T07:00:00.000Z',
        discussion_id: 'discussion-1',
        id: 'message-1',
        request_id: 'request-1',
        role: 'user',
        status: 'completed',
      },
      {
        content: 'Private unselected assistant response.',
        created_at: '2026-07-30T07:00:00.001Z',
        discussion_id: 'discussion-1',
        id: 'message-2',
        request_id: null,
        role: 'assistant',
        status: 'completed',
      },
    ],
    project_id: 'project-1',
    title: 'Private discussion title',
    updated_at: '2026-07-30T07:00:00.001Z',
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useKnowledgeExtraction', () => {
  it('records aggregate-only generation and resolution analytics across retries', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(503, {
          code: 'KNOWLEDGE_EXTRACTION_GENERATION_FAILED',
          message: 'Generation failed.',
        }),
      )
      .mockResolvedValueOnce(proposalResponse());
    const resolve = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(503, {
          code: 'KNOWLEDGE_EXTRACTION_RESOLUTION_PERSISTENCE_FAILED',
          message: 'Save failed.',
        }),
      )
      .mockResolvedValueOnce(newBubbleResolution());
    const track = vi.fn<AnalyticsClient['track']>();
    const { result } = renderHook(() =>
      useKnowledgeExtraction({
        analyticsClient: { track },
        analyticsDiscussion: analyticsDiscussion(),
        createAttemptId: () => 'stable-analytics-attempt',
        discussionId: 'discussion-1',
        projectId: 'project-1',
        requests: { create, resolve },
      }),
    );

    act(() => {
      result.current.start('message-1');
      result.current.selectAllMessages(['message-1']);
      result.current.toggleFrozenContextItem('context-1');
      result.current.setInstructions(
        'Keep private launch instructions out of analytics.',
      );
      result.current.setDetailLevel('detailed');
    });
    await act(async () => {
      await result.current.generateProposal();
    });
    await act(async () => {
      await result.current.generateProposal();
    });
    await act(async () => {
      await result.current.approveAsNewBubble();
    });
    await act(async () => {
      await result.current.approveAsNewBubble();
    });

    expect(track.mock.calls.map(([event]) => event)).toEqual([
      'knowledge_extraction_generation_finished',
      'knowledge_extraction_generation_finished',
      'knowledge_extraction_resolution_finished',
      'knowledge_extraction_resolution_finished',
    ]);
    expect(track).toHaveBeenNthCalledWith(
      1,
      'knowledge_extraction_generation_finished',
      {
        project_id: 'project-1',
        discussion_id: 'discussion-1',
        detail_level: 'detailed',
        instructions_supplied: true,
        instructions_length_band: '1_to_100_chars',
        message_selection_mode: 'selected',
        select_all_used: true,
        selected_message_count: 1,
        frozen_project_description_count: 0,
        frozen_bubble_count: 0,
        frozen_document_count: 1,
        payload_size_band: 'under_4_kib',
        status: 'failed',
        latency_ms: expect.any(Number),
        retry_count: 0,
        occurred_at: expect.any(String),
      },
    );
    expect(track).toHaveBeenNthCalledWith(
      2,
      'knowledge_extraction_generation_finished',
      expect.objectContaining({
        status: 'succeeded',
        retry_count: 1,
      }),
    );
    expect(track).toHaveBeenNthCalledWith(
      3,
      'knowledge_extraction_resolution_finished',
      expect.objectContaining({
        resolution: 'new_bubble',
        status: 'failed',
        latency_ms: expect.any(Number),
      }),
    );
    expect(track).toHaveBeenNthCalledWith(
      4,
      'knowledge_extraction_resolution_finished',
      expect.objectContaining({
        resolution: 'new_bubble',
        status: 'succeeded',
        latency_ms: expect.any(Number),
      }),
    );

    const serializedEvents = JSON.stringify(track.mock.calls);
    const resolvedBubble = newBubbleResolution().resolution;

    for (const forbiddenContent of [
      'Private frozen strategy body.',
      'Private frozen project description.',
      'Private strategy document',
      'Private selected discussion message.',
      'Private unselected assistant response.',
      'Private discussion title',
      'Keep private launch instructions out of analytics.',
      proposalResponse().proposal.title,
      proposalResponse().proposal.summary,
      proposalResponse().proposal.content,
      resolvedBubble.kind === 'new_bubble'
        ? resolvedBubble.bubble.title
        : '',
    ]) {
      expect(serializedEvents).not.toContain(forbiddenContent);
    }
  });

  it('reuses the attempt key for retry, preserves selection, and resets terminal state', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(503, {
          code: 'KNOWLEDGE_EXTRACTION_GENERATION_FAILED',
          message: 'Generation failed.',
        }),
      )
      .mockResolvedValueOnce(proposalResponse());
    const discard = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useKnowledgeExtraction({
        createAttemptId: () => 'stable-attempt-key',
        discussionId: 'discussion-1',
        projectId: 'project-1',
        requests: { create, discard },
      }),
    );

    act(() => {
      result.current.start('message-1');
      result.current.toggleFrozenContextItem('context-1');
      result.current.setInstructions('  Preserve the caveat.  ');
      result.current.setDetailLevel('detailed');
    });

    await act(async () => {
      await result.current.generateProposal();
    });

    expect(result.current.state.status).toBe('generation_failed');
    expect(result.current.state.failure).toEqual(
      expect.objectContaining({
        kind: 'generation',
        retryable: true,
      }),
    );
    expect(result.current.state.selection).toEqual({
      detailLevel: 'detailed',
      frozenContextItemIds: ['context-1'],
      instructions: '  Preserve the caveat.  ',
      messageIds: ['message-1'],
    });
    expect(result.current.state.attemptId).toBe(
      'stable-attempt-key',
    );

    await act(async () => {
      await result.current.generateProposal();
    });

    expect(result.current.state.status).toBe('reviewing');
    expect(result.current.state.retryCount).toBe(1);
    expect(create).toHaveBeenCalledTimes(2);
    const firstInput = create.mock.calls[0]?.[2] as
      | CreateKnowledgeExtractionInput
      | undefined;
    const secondInput = create.mock.calls[1]?.[2] as
      | CreateKnowledgeExtractionInput
      | undefined;
    expect(firstInput?.idempotency_key).toBe('stable-attempt-key');
    expect(firstInput).toEqual({
      detail_level: 'detailed',
      frozen_context_item_ids: ['context-1'],
      idempotency_key: 'stable-attempt-key',
      instructions: 'Preserve the caveat.',
      message_ids: ['message-1'],
    });
    expect(secondInput).toEqual(firstInput);

    act(() =>
      result.current.editProposal('title', 'Edited conclusion'),
    );
    expect(result.current.state.proposal?.title).toBe(
      'Edited conclusion',
    );
    expect(result.current.state.generatedProposal?.title).toBe(
      'Qualified conclusion',
    );

    await act(async () => {
      await result.current.discard();
    });

    expect(result.current.state.status).toBe('discarded');
    expect(result.current.state.proposal).toBeNull();
    expect(discard).toHaveBeenCalledWith(
      'project-1',
      'discussion-1',
      'extraction-1',
    );

    act(() => result.current.reset());
    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.attemptId).toBeNull();
    expect(result.current.state.selection.frozenContextItemIds).toEqual(
      [],
    );
  });

  it('requires a source and keeps server source-validation details editable', async () => {
    const create = vi.fn().mockRejectedValue(
      new ApiError(422, {
        code: 'KNOWLEDGE_EXTRACTION_SOURCE_INVALID',
        message: 'One selected source is unavailable.',
        source_errors: [
          {
            reason: 'missing',
            source_id: 'message-1',
            source_kind: 'message',
          },
        ],
      }),
    );
    const { result } = renderHook(() =>
      useKnowledgeExtraction({
        createAttemptId: () => 'attempt-1',
        discussionId: 'discussion-1',
        projectId: 'project-1',
        requests: { create },
      }),
    );

    act(() => result.current.start());
    await act(async () => {
      await result.current.generateProposal();
    });
    expect(create).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe('source_invalid');
    expect(result.current.state.failure).toEqual(
      expect.objectContaining({
        code: 'KNOWLEDGE_EXTRACTION_SELECTION_REQUIRED',
        kind: 'source_validation',
        retryable: false,
      }),
    );

    act(() => result.current.toggleMessage('message-1'));
    expect(result.current.state.status).toBe('selecting');

    await act(async () => {
      await result.current.generateProposal();
    });
    expect(result.current.state.status).toBe('source_invalid');
    expect(result.current.state.failure).toEqual(
      expect.objectContaining({
        code: 'KNOWLEDGE_EXTRACTION_SOURCE_INVALID',
        sourceIssues: [
          {
            reason: 'missing',
            sourceId: 'message-1',
            sourceKind: 'message',
          },
        ],
      }),
    );

    act(() => result.current.toggleMessage('message-1'));
    expect(result.current.state.status).toBe('selecting');
    expect(result.current.state.failure).toBeNull();
    expect(result.current.state.attemptId).toBeNull();
  });

  it('keeps whitespace-equivalent intent on the same attempt and invalidates changed intent', async () => {
    const createAttemptId = vi
      .fn()
      .mockReturnValueOnce('attempt-1')
      .mockReturnValueOnce('attempt-2');
    const create = vi.fn().mockRejectedValue(
      new ApiError(503, {
        code: 'KNOWLEDGE_EXTRACTION_GENERATION_FAILED',
        message: 'Generation failed.',
      }),
    );
    const { result } = renderHook(() =>
      useKnowledgeExtraction({
        createAttemptId,
        discussionId: 'discussion-1',
        projectId: 'project-1',
        requests: { create },
      }),
    );

    act(() => {
      result.current.start('message-1');
      result.current.setInstructions('Focus on risk.');
    });
    await act(async () => {
      await result.current.generateProposal();
    });
    expect(result.current.state.attemptId).toBe('attempt-1');

    act(() =>
      result.current.setInstructions('  Focus   on risk.  '),
    );
    expect(result.current.state.attemptId).toBe('attempt-1');

    act(() => {
      result.current.setInstructions('Focus on cost.');
      result.current.setDetailLevel('tight');
    });
    expect(result.current.state.attemptId).toBeNull();

    await act(async () => {
      await result.current.generateProposal();
    });

    expect(createAttemptId).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map((call) => call[2])).toEqual([
      {
        detail_level: 'standard',
        frozen_context_item_ids: [],
        idempotency_key: 'attempt-1',
        instructions: 'Focus on risk.',
        message_ids: ['message-1'],
      },
      {
        detail_level: 'tight',
        frozen_context_item_ids: [],
        idempotency_key: 'attempt-2',
        instructions: 'Focus on cost.',
        message_ids: ['message-1'],
      },
    ]);
  });

  it('aborts generation and ignores its stale response after discard', async () => {
    const pending = deferred<KnowledgeExtractionProposalResponse>();
    const signals: AbortSignal[] = [];
    const create = vi.fn(
      (
        _projectId: string,
        _discussionId: string,
        _input: CreateKnowledgeExtractionInput,
        signal?: AbortSignal,
      ) => {
        if (signal) {
          signals.push(signal);
        }
        return pending.promise;
      },
    );
    const { result } = renderHook(() =>
      useKnowledgeExtraction({
        createAttemptId: () => 'attempt-1',
        discussionId: 'discussion-1',
        projectId: 'project-1',
        requests: { create },
      }),
    );

    act(() => result.current.start('message-1'));
    let generation:
      | Promise<KnowledgeExtractionProposalResponse | null>
      | undefined;
    act(() => {
      generation = result.current.generateProposal();
    });
    expect(result.current.state.status).toBe('generating');

    await act(async () => {
      await result.current.discard();
    });
    expect(signals[0]?.aborted).toBe(true);
    expect(result.current.state.status).toBe('discarded');

    await act(async () => {
      pending.resolve(proposalResponse());
      await generation;
    });
    expect(result.current.state.status).toBe('discarded');
    expect(result.current.state.proposal).toBeNull();
  });

  it('discards a ready attempt on project departure and does not restore it', async () => {
    const create = vi.fn().mockResolvedValue(proposalResponse());
    const discard = vi.fn().mockResolvedValue(undefined);
    const { rerender, result } = renderHook(
      ({
        currentDiscussionId,
        currentProjectId,
      }: {
        currentDiscussionId: string;
        currentProjectId: string;
      }) =>
        useKnowledgeExtraction({
          createAttemptId: () => 'attempt-1',
          discussionId: currentDiscussionId,
          projectId: currentProjectId,
          requests: { create, discard },
        }),
      {
        initialProps: {
          currentDiscussionId: 'discussion-1',
          currentProjectId: 'project-1',
        },
      },
    );

    act(() => result.current.start('message-1'));
    await act(async () => {
      await result.current.generateProposal();
    });
    expect(result.current.state.status).toBe('reviewing');

    rerender({
      currentDiscussionId: 'discussion-2',
      currentProjectId: 'project-2',
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('idle');
      expect(result.current.state.projectId).toBe('project-2');
    });
    expect(discard).toHaveBeenCalledWith(
      'project-1',
      'discussion-1',
      'extraction-1',
    );

    rerender({
      currentDiscussionId: 'discussion-1',
      currentProjectId: 'project-1',
    });
    await waitFor(() =>
      expect(result.current.state.projectId).toBe('project-1'),
    );
    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.proposal).toBeNull();
  });

  it('keeps review data retryable on save failure and resolves exactly once on retry', async () => {
    const create = vi.fn().mockResolvedValue(proposalResponse());
    const resolve = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(503, {
          code: 'KNOWLEDGE_EXTRACTION_RESOLUTION_PERSISTENCE_FAILED',
          message: 'Save failed.',
        }),
      )
      .mockResolvedValueOnce(newBubbleResolution());
    const onResolved = vi.fn();
    const { result } = renderHook(() =>
      useKnowledgeExtraction({
        createAttemptId: () => 'attempt-1',
        discussionId: 'discussion-1',
        onResolved,
        projectId: 'project-1',
        requests: { create, resolve },
      }),
    );

    act(() => result.current.start('message-1'));
    await act(async () => {
      await result.current.generateProposal();
    });
    act(() => result.current.editProposal('title', 'Final title'));

    await act(async () => {
      await result.current.approveAsNewBubble();
    });
    expect(result.current.state.status).toBe('reviewing');
    expect(result.current.state.proposal?.title).toBe('Final title');
    expect(result.current.state.failure).toEqual(
      expect.objectContaining({
        kind: 'resolution',
        retryable: true,
      }),
    );

    await act(async () => {
      await result.current.approveAsNewBubble();
    });
    expect(result.current.state.status).toBe('resolved');
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve.mock.calls[0]?.[3]).toEqual(
      resolve.mock.calls[1]?.[3],
    );
  });

  it('refreshes a changed update target and requires a separate confirmation', async () => {
    const create = vi.fn().mockResolvedValue(proposalResponse());
    const resolve = vi.fn().mockRejectedValue(
      new ApiError(409, {
        code: 'KNOWLEDGE_EXTRACTION_TARGET_CHANGED',
        current_target: {
          content: 'Content changed in another tab.',
          id: 'bubble-1',
          summary: 'Current summary.',
          title: 'Current target title',
          updated_at: '2026-07-30T09:00:00.000Z',
        },
        message: 'Review the current target.',
      }),
    );
    const { result } = renderHook(() =>
      useKnowledgeExtraction({
        createAttemptId: () => 'attempt-1',
        discussionId: 'discussion-1',
        projectId: 'project-1',
        requests: { create, resolve },
      }),
    );

    act(() => result.current.start('message-1'));
    await act(async () => {
      await result.current.generateProposal();
    });
    act(() => {
      result.current.beginUpdateTargetSelection();
      result.current.selectUpdateTarget(bubble());
    });

    await act(async () => {
      await result.current.approveBubbleUpdate();
    });

    expect(result.current.state.status).toBe('reviewing');
    expect(result.current.state.failure).toEqual(
      expect.objectContaining({
        kind: 'target_changed',
        retryable: false,
      }),
    );
    expect(result.current.state.target).toEqual(
      expect.objectContaining({
        content: 'Content changed in another tab.',
        project_id: 'project-1',
        updated_at: '2026-07-30T09:00:00.000Z',
      }),
    );
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

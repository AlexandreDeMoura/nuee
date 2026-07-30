import { act } from 'react';
import {
  cleanup,
  renderHook,
  waitFor,
} from '@testing-library/react';
import type {
  Bubble,
  CreateKnowledgeExtractionInput,
  KnowledgeExtractionProposalResponse,
  KnowledgeExtractionResolutionResponse,
} from '@nuee/shared-types';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { ApiError } from '../src/api';
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
      message_selection_kind: 'selected',
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
    position_x: 24,
    position_y: 48,
    project_id: 'project-1',
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useKnowledgeExtraction', () => {
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
      frozenContextItemIds: ['context-1'],
      messageSelection: {
        kind: 'selected',
        message_ids: ['message-1'],
      },
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

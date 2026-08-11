import type {
  KnowledgeExtractionProposal,
} from '@nuee/shared-types';
import type {
  Bubble,
  KnowledgeExtractionResolutionResponse,
} from '../src/api';
import { describe, expect, it } from 'vitest';
import {
  createKnowledgeExtractionState,
  hasKnowledgeExtractionSources,
  knowledgeExtractionReducer,
  knowledgeExtractionSelectionFingerprint,
  type KnowledgeExtractionFailure,
  type KnowledgeExtractionState,
} from '../src/knowledge-extraction';

const proposal: KnowledgeExtractionProposal = {
  content: 'A reusable conclusion with the caveat preserved.',
  summary: 'The discussion reached a qualified conclusion.',
  title: 'Qualified conclusion',
};

const bubble: Bubble = {
  content: proposal.content,
  created_at: '2026-07-30T08:01:00.000Z',
  id: 'bubble-1',
  project_id: 'project-1',
  territory_id: 'territory-1',
  source_context_item_ids: [],
  source_discussion_deleted_at: null,
  source_discussion_id: 'discussion-1',
  source_discussion_title: 'Tradeoff review',
  source_kind: 'discussion',
  source_message_ids: ['message-1'],
  summary: proposal.summary,
  title: proposal.title,
  updated_at: '2026-07-30T08:01:00.000Z',
};

function resolution(
  kind: 'new_bubble' | 'update_bubble' | 'reject',
): KnowledgeExtractionResolutionResponse {
  return {
    discussion_id: 'discussion-1',
    id: 'extraction-1',
    project_id: 'project-1',
    resolution:
      kind === 'reject'
        ? { kind }
        : { bubble, kind },
    status: 'resolved',
  };
}

function dispatch(
  state: KnowledgeExtractionState,
  ...events: Parameters<typeof knowledgeExtractionReducer>[1][]
) {
  return events.reduce(knowledgeExtractionReducer, state);
}

function reviewingState() {
  return dispatch(
    createKnowledgeExtractionState({
      discussionId: 'discussion-1',
      projectId: 'project-1',
    }),
    { initialMessageId: 'message-1', type: 'start' },
    { attemptId: 'attempt-1', type: 'generation_started' },
    {
      extractionId: 'extraction-1',
      proposal,
      type: 'generation_succeeded',
    },
  );
}

describe('knowledge extraction state machine', () => {
  it('follows the new-bubble path and clears ephemeral state at the terminal state', () => {
    let state = reviewingState();

    expect(state.status).toBe('reviewing');
    expect(state.selection).toEqual({
      detailLevel: 'standard',
      frozenContextItemIds: [],
      instructions: '',
      messageIds: ['message-1'],
    });
    expect(state.proposal).toEqual(proposal);
    expect(state.initialMessageId).toBe('message-1');

    state = knowledgeExtractionReducer(state, {
      field: 'title',
      type: 'proposal_edited',
      value: 'Edited conclusion',
    });
    expect(state.proposal?.title).toBe('Edited conclusion');
    expect(state.generatedProposal?.title).toBe(proposal.title);

    state = knowledgeExtractionReducer(state, {
      type: 'new_bubble_save_started',
    });
    expect(state.status).toBe('saving_new');

    state = knowledgeExtractionReducer(state, {
      resolution: resolution('new_bubble'),
      type: 'resolved',
    });
    expect(state.status).toBe('resolved');
    expect(state.resolution?.resolution.kind).toBe('new_bubble');
    expect(state.selection).toEqual({
      detailLevel: 'standard',
      frozenContextItemIds: [],
      instructions: '',
      messageIds: [],
    });
    expect(state.attemptId).toBeNull();
    expect(state.extractionId).toBeNull();
    expect(state.proposal).toBeNull();
    expect(state.initialMessageId).toBeNull();
    expect(state.target).toBeNull();

    state = knowledgeExtractionReducer(state, { type: 'reset' });
    expect(state).toEqual(
      createKnowledgeExtractionState({
        discussionId: 'discussion-1',
        projectId: 'project-1',
      }),
    );
  });

  it('supports target selection, cancellation, saving failure, and update success', () => {
    let state = knowledgeExtractionReducer(reviewingState(), {
      type: 'update_target_selection_started',
    });
    expect(state.status).toBe('selecting_update_target');

    state = knowledgeExtractionReducer(state, {
      type: 'update_target_selection_cancelled',
    });
    expect(state.status).toBe('reviewing');
    expect(state.proposal).toEqual(proposal);

    state = dispatch(
      state,
      { type: 'update_target_selection_started' },
      {
        target: {
          content: 'Existing content.',
          id: 'bubble-1',
          project_id: 'project-1',
          summary: null,
          title: 'Existing target',
          updated_at: '2026-07-30T08:00:00.000Z',
        },
        type: 'update_target_selected',
      },
      { type: 'bubble_update_save_started' },
    );
    expect(state.status).toBe('saving_update');
    expect(state.target?.id).toBe('bubble-1');

    const saveFailure: Extract<
      KnowledgeExtractionFailure,
      { kind: 'resolution' }
    > = {
      code: 'KNOWLEDGE_EXTRACTION_RESOLUTION_PERSISTENCE_FAILED',
      kind: 'resolution',
      message: 'Try again.',
      retryable: true,
    };
    state = knowledgeExtractionReducer(state, {
      failure: saveFailure,
      type: 'resolution_failed',
    });
    expect(state.status).toBe('reviewing');
    expect(state.failure).toEqual(saveFailure);
    expect(state.target?.id).toBe('bubble-1');

    state = dispatch(
      state,
      { type: 'update_target_selection_started' },
      { type: 'update_target_selection_cancelled' },
    );
    expect(state.status).toBe('reviewing');
    expect(state.target?.id).toBe('bubble-1');
    expect(state.proposal).toEqual(proposal);

    state = dispatch(
      state,
      { type: 'bubble_update_save_started' },
      {
        resolution: resolution('update_bubble'),
        type: 'resolved',
      },
    );
    expect(state.status).toBe('resolved');
  });

  it('models retryable generation and non-retryable source validation separately', () => {
    const selecting = knowledgeExtractionReducer(
      createKnowledgeExtractionState({
        discussionId: 'discussion-1',
        projectId: 'project-1',
      }),
      { initialMessageId: 'message-1', type: 'start' },
    );
    const generating = knowledgeExtractionReducer(selecting, {
      attemptId: 'attempt-1',
      type: 'generation_started',
    });
    const generationFailure: Extract<
      KnowledgeExtractionFailure,
      { kind: 'generation' }
    > = {
      code: 'KNOWLEDGE_EXTRACTION_GENERATION_FAILED',
      kind: 'generation',
      message: 'Try again.',
      retryable: true,
    };
    const failed = knowledgeExtractionReducer(generating, {
      failure: generationFailure,
      type: 'generation_failed',
    });

    expect(failed.status).toBe('generation_failed');
    expect(failed.attemptId).toBe('attempt-1');
    expect(failed.selection).toEqual(selecting.selection);

    const retrying = knowledgeExtractionReducer(failed, {
      attemptId: 'attempt-1',
      type: 'generation_started',
    });
    expect(retrying.status).toBe('generating');
    expect(retrying.retryCount).toBe(1);

    const sourceFailure: Extract<
      KnowledgeExtractionFailure,
      { kind: 'source_validation' }
    > = {
      code: 'KNOWLEDGE_EXTRACTION_SOURCE_INVALID',
      fieldErrors: {},
      kind: 'source_validation',
      message: 'Review the missing source.',
      retryable: false,
      sourceIssues: [
        {
          reason: 'missing',
          sourceId: 'message-1',
          sourceKind: 'message',
        },
      ],
    };
    const invalid = knowledgeExtractionReducer(retrying, {
      failure: sourceFailure,
      type: 'source_invalid',
    });
    expect(invalid.status).toBe('source_invalid');
    expect(invalid.failure).toEqual(sourceFailure);

    const changed = knowledgeExtractionReducer(invalid, {
      selection: {
        detailLevel: 'standard',
        frozenContextItemIds: ['context-1'],
        instructions: '',
        messageIds: [],
      },
      type: 'selection_changed',
    });
    expect(changed.status).toBe('selecting');
    expect(changed.failure).toBeNull();
    expect(changed.attemptId).toBeNull();
    expect(changed.retryCount).toBe(0);
  });

  it('keeps fingerprints canonical while preserving local selection order', () => {
    const first = {
      detailLevel: 'standard' as const,
      frozenContextItemIds: ['context-2', 'context-1'],
      instructions: '  Preserve   uncertainty. ',
      messageIds: ['message-2', 'message-1'],
    };
    const second = {
      detailLevel: 'standard' as const,
      frozenContextItemIds: ['context-1', 'context-2'],
      instructions: 'Preserve uncertainty.',
      messageIds: ['message-1', 'message-2'],
    };

    expect(knowledgeExtractionSelectionFingerprint(first)).toBe(
      knowledgeExtractionSelectionFingerprint(second),
    );
    expect(hasKnowledgeExtractionSources(first)).toBe(true);
    expect(
      hasKnowledgeExtractionSources({
        detailLevel: 'standard',
        frozenContextItemIds: [],
        instructions: '',
        messageIds: [],
      }),
    ).toBe(false);

    expect(
      knowledgeExtractionSelectionFingerprint({
        ...second,
        detailLevel: 'detailed',
      }),
    ).not.toBe(knowledgeExtractionSelectionFingerprint(second));
  });

  it('ignores invalid transitions and cross-project update targets', () => {
    const idle = createKnowledgeExtractionState({
      discussionId: 'discussion-1',
      projectId: 'project-1',
    });

    expect(
      knowledgeExtractionReducer(idle, {
        extractionId: 'extraction-1',
        proposal,
        type: 'generation_succeeded',
      }),
    ).toBe(idle);
    expect(
      knowledgeExtractionReducer(idle, {
        type: 'new_bubble_save_started',
      }),
    ).toBe(idle);
    expect(
      knowledgeExtractionReducer(idle, { type: 'discarded' }),
    ).toBe(idle);

    const selectingTarget = knowledgeExtractionReducer(
      reviewingState(),
      { type: 'update_target_selection_started' },
    );
    expect(
      knowledgeExtractionReducer(selectingTarget, {
        target: {
          content: 'Other project content.',
          id: 'bubble-other',
          project_id: 'project-2',
          summary: null,
          title: 'Other project target',
          updated_at: '2026-07-30T08:00:00.000Z',
        },
        type: 'update_target_selected',
      }),
    ).toBe(selectingTarget);
  });

  it('supports explicit reject and discard terminal paths', () => {
    const rejected = knowledgeExtractionReducer(reviewingState(), {
      resolution: resolution('reject'),
      type: 'resolved',
    });
    expect(rejected.status).toBe('resolved');
    expect(rejected.resolution?.resolution.kind).toBe('reject');

    const discarded = knowledgeExtractionReducer(reviewingState(), {
      type: 'discarded',
    });
    expect(discarded.status).toBe('discarded');
    expect(discarded.proposal).toBeNull();
    expect(discarded.resolution).toBeNull();

    const rebound = knowledgeExtractionReducer(discarded, {
      binding: {
        discussionId: 'discussion-2',
        projectId: 'project-2',
      },
      type: 'binding_changed',
    });
    expect(rebound.status).toBe('idle');
    expect(rebound.projectId).toBe('project-2');
    expect(rebound.discussionId).toBe('discussion-2');
  });
});

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  Bubble,
  KnowledgeExtractionProposalResponse,
  KnowledgeExtractionResolutionResponse,
} from '../api';
import type { AnalyticsClient } from '../analytics';
import { useKnowledgeExtraction } from './useKnowledgeExtraction';

afterEach(cleanup);

const createdAt = '2026-08-12T10:00:00.000Z';

const proposalResponse: KnowledgeExtractionProposalResponse = {
  id: 'extraction-one',
  project_id: 'project-one',
  discussion_id: 'discussion-one',
  status: 'ready',
  proposal: {
    title: 'Private extracted title',
    summary: 'Private extracted summary',
    content: 'Private extracted content',
  },
  source: {
    message_ids: ['message-one'],
    frozen_context_item_ids: [],
  },
  created_at: createdAt,
  expires_at: '2026-08-12T11:00:00.000Z',
};

const extractedBubble: Bubble = {
  id: 'bubble-created',
  project_id: 'project-one',
  territory_id: 'territory-created',
  title: proposalResponse.proposal.title,
  summary: proposalResponse.proposal.summary,
  content: proposalResponse.proposal.content,
  created_at: createdAt,
  updated_at: createdAt,
  source_kind: 'discussion',
  source_discussion_id: 'discussion-one',
  source_discussion_title: 'Private discussion title',
  source_discussion_deleted_at: null,
  source_message_ids: ['message-one'],
  source_context_item_ids: [],
};

const resolutionResponse: KnowledgeExtractionResolutionResponse = {
  id: proposalResponse.id,
  project_id: 'project-one',
  discussion_id: 'discussion-one',
  status: 'resolved',
  resolution: {
    kind: 'new_bubble',
    bubble: extractedBubble,
  },
};

describe('useKnowledgeExtraction territory analytics', () => {
  it('records a new destination and territory after resolution, then closes the flow', async () => {
    const track = vi.fn<AnalyticsClient['track']>();
    const create = vi.fn(async () => proposalResponse);
    const resolve = vi.fn(async () => resolutionResponse);
    const onResolved = vi.fn();
    const { result } = renderHook(() =>
      useKnowledgeExtraction({
        analyticsClient: { track },
        createAttemptId: () => 'attempt-one',
        discussionId: 'discussion-one',
        onResolved,
        projectId: 'project-one',
        requests: {
          create,
          discard: vi.fn(async () => undefined),
          resolve,
        },
      }),
    );

    act(() => {
      expect(result.current.start('message-one')).toBe(true);
    });
    await act(async () => {
      await result.current.generateProposal();
    });
    expect(result.current.state.status).toBe('reviewing');

    await act(async () => {
      await result.current.approveAsNewBubble({
        kind: 'new',
        title: 'Private destination title',
        position_x: 20,
        position_y: 30,
      });
    });

    expect(result.current.state.status).toBe('resolved');
    expect(onResolved).toHaveBeenCalledWith(resolutionResponse);
    expect(track).toHaveBeenCalledWith('territory_destination_selected', {
      project_id: 'project-one',
      source: 'extraction',
      destination_kind: 'new',
    });
    expect(track).toHaveBeenCalledWith('territory_created', {
      project_id: 'project-one',
      territory_id: 'territory-created',
      source: 'extraction',
    });

    const territoryEvents = track.mock.calls.filter(([event]) =>
      event.startsWith('territory_'),
    );
    expect(JSON.stringify(territoryEvents)).not.toContain('Private');
  });
});

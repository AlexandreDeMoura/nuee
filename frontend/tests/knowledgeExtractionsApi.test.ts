import type {
  Bubble,
  CreateKnowledgeExtractionInput,
  KnowledgeExtractionProposalResponse,
  KnowledgeExtractionResolutionResponse,
} from '@nuee/shared-types';
import { describe, expect, it } from 'vitest';
import {
  createKnowledgeExtractionsApi,
  isKnowledgeExtractionProposalResponse,
  isKnowledgeExtractionResolutionResponse,
  isKnowledgeExtractionTargetChangedError,
  type KnowledgeExtractionRequest,
} from '../src/api/knowledgeExtractions';

interface RecordedRequest {
  init?: RequestInit;
  path: string;
}

function createRequestFake(responses: unknown[]) {
  const requests: RecordedRequest[] = [];
  const request: KnowledgeExtractionRequest = <T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> => {
    requests.push({ init, path });
    return Promise.resolve(responses.shift() as T);
  };

  return { request, requests };
}

const input: CreateKnowledgeExtractionInput = {
  detail_level: 'detailed',
  frozen_context_item_ids: ['context/1'],
  idempotency_key: 'attempt/1',
  instructions: 'Emphasize the operational risk.',
  message_ids: ['message/2', 'message/1'],
};

const proposalResponse: KnowledgeExtractionProposalResponse = {
  created_at: '2026-07-30T08:00:00.000Z',
  discussion_id: 'discussion/1',
  expires_at: '2026-07-31T08:00:00.000Z',
  id: 'extraction/1',
  project_id: 'project/1',
  proposal: {
    content: 'A standalone account of the reviewed conclusion.',
    summary: 'The review identified one reusable conclusion.',
    title: 'Reviewed conclusion',
  },
  source: {
    frozen_context_item_ids: ['context/1'],
    message_ids: ['message/1', 'message/2'],
  },
  status: 'ready',
};

const extractedBubble: Bubble = {
  content: proposalResponse.proposal.content,
  created_at: '2026-07-30T08:01:00.000Z',
  id: 'bubble/1',
  position_x: 120,
  position_y: 80,
  project_id: 'project/1',
  source_context_item_ids: ['context/1'],
  source_discussion_deleted_at: null,
  source_discussion_id: 'discussion/1',
  source_discussion_title: 'Launch review',
  source_kind: 'discussion',
  source_message_ids: ['message/1', 'message/2'],
  summary: proposalResponse.proposal.summary,
  title: proposalResponse.proposal.title,
  updated_at: '2026-07-30T08:01:00.000Z',
};

const resolutionResponse: KnowledgeExtractionResolutionResponse = {
  discussion_id: 'discussion/1',
  id: 'extraction/1',
  project_id: 'project/1',
  resolution: {
    bubble: extractedBubble,
    kind: 'new_bubble',
  },
  status: 'resolved',
};

describe('knowledge extractions API', () => {
  it('creates, resolves, and discards nested extraction resources', async () => {
    const { request, requests } = createRequestFake([
      proposalResponse,
      resolutionResponse,
      undefined,
    ]);
    const api = createKnowledgeExtractionsApi(request);
    const signal = new AbortController().signal;
    const resolutionInput = {
      kind: 'new_bubble' as const,
      proposal: proposalResponse.proposal,
    };

    await expect(
      api.createKnowledgeExtraction(
        'project/1',
        'discussion/1',
        input,
        signal,
      ),
    ).resolves.toEqual(proposalResponse);
    await expect(
      api.resolveKnowledgeExtraction(
        'project/1',
        'discussion/1',
        'extraction/1',
        resolutionInput,
        signal,
      ),
    ).resolves.toEqual(resolutionResponse);
    await expect(
      api.discardKnowledgeExtraction(
        'project/1',
        'discussion/1',
        'extraction/1',
        signal,
      ),
    ).resolves.toBeUndefined();

    expect(requests).toEqual([
      {
        init: {
          body: JSON.stringify(input),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
          signal,
        },
        path: '/projects/project%2F1/discussions/discussion%2F1/knowledge-extractions',
      },
      {
        init: {
          body: JSON.stringify(resolutionInput),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
          signal,
        },
        path: '/projects/project%2F1/discussions/discussion%2F1/knowledge-extractions/extraction%2F1/resolution',
      },
      {
        init: {
          method: 'DELETE',
          signal,
        },
        path: '/projects/project%2F1/discussions/discussion%2F1/knowledge-extractions/extraction%2F1',
      },
    ]);
  });

  it('guards project, discussion, source, timestamps, and proposal fields', () => {
    expect(
      isKnowledgeExtractionProposalResponse(
        proposalResponse,
        'project/1',
        'discussion/1',
        input,
      ),
    ).toBe(true);

    const invalidResponses = [
      { ...proposalResponse, project_id: 'another-project' },
      { ...proposalResponse, discussion_id: 'another-discussion' },
      { ...proposalResponse, status: 'generating' },
      {
        ...proposalResponse,
        proposal: { ...proposalResponse.proposal, title: ' ' },
      },
      {
        ...proposalResponse,
        source: {
          ...proposalResponse.source,
          message_ids: ['message/1'],
        },
      },
      {
        ...proposalResponse,
        source: {
          ...proposalResponse.source,
          frozen_context_item_ids: ['context/1', 'context/1'],
        },
      },
      { ...proposalResponse, created_at: 'not-a-timestamp' },
      {
        ...proposalResponse,
        expires_at: proposalResponse.created_at,
      },
    ];

    invalidResponses.forEach((response) => {
      expect(
        isKnowledgeExtractionProposalResponse(
          response,
          'project/1',
          'discussion/1',
          input,
        ),
      ).toBe(false);
    });
  });

  it('guards the requested resolution kind, extraction identity, and returned bubble', () => {
    expect(
      isKnowledgeExtractionResolutionResponse(
        resolutionResponse,
        'project/1',
        'discussion/1',
        'extraction/1',
        'new_bubble',
      ),
    ).toBe(true);
    expect(
      isKnowledgeExtractionResolutionResponse(
        resolutionResponse,
        'project/1',
        'discussion/1',
        'another-extraction',
        'new_bubble',
      ),
    ).toBe(false);
    expect(
      isKnowledgeExtractionResolutionResponse(
        resolutionResponse,
        'project/1',
        'discussion/1',
        'extraction/1',
        'update_bubble',
      ),
    ).toBe(false);
    expect(
      isKnowledgeExtractionResolutionResponse(
        {
          ...resolutionResponse,
          resolution: {
            ...resolutionResponse.resolution,
            bubble: {
              ...extractedBubble,
              source_message_ids: [],
              source_context_item_ids: [],
            },
          },
        },
        'project/1',
        'discussion/1',
        'extraction/1',
        'new_bubble',
      ),
    ).toBe(false);
  });

  it('recognizes only safe optimistic-concurrency target previews', () => {
    expect(
      isKnowledgeExtractionTargetChangedError({
        code: 'KNOWLEDGE_EXTRACTION_TARGET_CHANGED',
        current_target: {
          content: 'Content after another edit.',
          id: 'bubble/1',
          summary: null,
          title: 'Current title',
          updated_at: '2026-07-30T08:02:00.000Z',
        },
        message: 'Review the current target.',
      }),
    ).toBe(true);
    expect(
      isKnowledgeExtractionTargetChangedError({
        code: 'KNOWLEDGE_EXTRACTION_TARGET_CHANGED',
        current_target: {
          content: 'Content after another edit.',
          id: 'bubble/1',
          summary: null,
          title: 'Current title',
          updated_at: 'yesterday',
        },
        message: 'Review the current target.',
      }),
    ).toBe(false);
  });

  it('rejects malformed mutation responses before feature state can consume them', async () => {
    const invalidProposalApi = createKnowledgeExtractionsApi(
      createRequestFake([
        {
          ...proposalResponse,
          source: {
            ...proposalResponse.source,
            message_ids: ['unexpected-message'],
          },
        },
      ]).request,
    );
    const invalidResolutionApi = createKnowledgeExtractionsApi(
      createRequestFake([
        {
          ...resolutionResponse,
          resolution: { kind: 'reject' },
        },
      ]).request,
    );

    await expect(
      invalidProposalApi.createKnowledgeExtraction(
        'project/1',
        'discussion/1',
        input,
      ),
    ).rejects.toThrow(
      'The knowledge extraction response contained invalid data.',
    );
    await expect(
      invalidResolutionApi.resolveKnowledgeExtraction(
        'project/1',
        'discussion/1',
        'extraction/1',
        {
          kind: 'new_bubble',
          proposal: proposalResponse.proposal,
        },
      ),
    ).rejects.toThrow(
      'The knowledge extraction response contained invalid data.',
    );
  });
});

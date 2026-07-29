import type {
  CreateDiscussionInput,
  DiscussionDetails,
  DiscussionListResponse,
  FrozenContextV1,
  SendMessageInput,
} from '@nuee/shared-types';
import { describe, expect, it } from 'vitest';
import {
  createDiscussionsApi,
  type DiscussionRequest,
} from '../src/api/discussions';

interface RecordedRequest {
  path: string;
  init?: RequestInit;
}

function createRequestFake(responses: unknown[]) {
  const requests: RecordedRequest[] = [];
  const request: DiscussionRequest = <T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> => {
    requests.push({ path, init });
    return Promise.resolve(responses.shift() as T);
  };

  return { request, requests };
}

const frozenContext: FrozenContextV1 = {
  version: 1,
  items: [
    {
      id: 'context/project',
      source_kind: 'project_description',
      source_id: 'project/id',
      source_title: 'Project description',
      frozen_content: 'A frozen description.',
      created_at: '2026-07-27T10:00:00.000Z',
      display_order: 0,
    },
  ],
};

const details: DiscussionDetails = {
  id: 'discussion/id',
  project_id: 'project/id',
  title: 'New discussion',
  frozen_context: frozenContext,
  created_at: '2026-07-27T10:00:00.000Z',
  updated_at: '2026-07-27T10:00:01.000Z',
  last_activity_at: '2026-07-27T10:00:01.000Z',
  messages: [],
};

describe('discussions API', () => {
  it('creates, lists, and gets project-scoped discussions', async () => {
    const list: DiscussionListResponse = [
      {
        id: details.id,
        project_id: details.project_id,
        title: details.title,
        created_at: details.created_at,
        updated_at: details.updated_at,
        last_activity_at: details.last_activity_at,
        is_active: true,
      },
    ];
    const { request, requests } = createRequestFake([details, list, details]);
    const api = createDiscussionsApi(request);
    const signal = new AbortController().signal;
    const input: CreateDiscussionInput = {
      project_id: details.project_id,
      first_prompt: 'What is the main risk?',
      idempotency_key: 'creation/key',
      bubble_ids: [],
      document_ids: [],
    };

    await expect(
      api.createDiscussion(details.project_id, input, signal),
    ).resolves.toBe(details);
    await expect(
      api.getProjectDiscussions(details.project_id, signal),
    ).resolves.toBe(list);
    await expect(
      api.getDiscussion(details.project_id, details.id, signal),
    ).resolves.toBe(details);

    expect(requests).toEqual([
      {
        path: '/projects/project%2Fid/discussions',
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal,
        },
      },
      {
        path: '/projects/project%2Fid/discussions',
        init: { signal },
      },
      {
        path: '/projects/project%2Fid/discussions/discussion%2Fid',
        init: { signal },
      },
    ]);
  });

  it('preserves confirmed source order and validates the expected package count', async () => {
    const mixedDetails: DiscussionDetails = {
      ...details,
      frozen_context: {
        version: 1,
        items: [
          ...frozenContext.items,
          {
            id: 'context/bubble-b',
            source_kind: 'bubble',
            source_id: 'bubble/b',
            source_title: 'Second selected bubble',
            frozen_content: 'Second selected bubble content.',
            created_at: '2026-07-27T10:00:00.000Z',
            display_order: 1,
          },
          {
            id: 'context/bubble-a',
            source_kind: 'bubble',
            source_id: 'bubble/a',
            source_title: 'First selected bubble',
            frozen_content: 'First selected bubble content.',
            created_at: '2026-07-27T10:00:00.000Z',
            display_order: 2,
          },
          {
            id: 'context/document-a',
            source_kind: 'document',
            source_id: 'document/a',
            source_title: 'Selected document',
            frozen_content: 'Complete processed document text.',
            created_at: '2026-07-27T10:00:00.000Z',
            display_order: 3,
          },
        ],
      },
    };
    const { request, requests } = createRequestFake([mixedDetails]);
    const api = createDiscussionsApi(request);
    const input: CreateDiscussionInput = {
      project_id: details.project_id,
      first_prompt: 'Compare the selected sources.',
      idempotency_key: 'ordered/creation',
      bubble_ids: ['bubble/b', 'bubble/a', 'bubble/b'],
      document_ids: ['document/a'],
    };

    await expect(
      api.createDiscussion(details.project_id, input),
    ).resolves.toBe(mixedDetails);
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual(input);

    const incomplete = {
      ...mixedDetails,
      frozen_context: {
        ...mixedDetails.frozen_context,
        items: mixedDetails.frozen_context.items.slice(0, -1),
      },
    };
    const invalidApi = createDiscussionsApi(
      createRequestFake([incomplete]).request,
    );

    await expect(
      invalidApi.createDiscussion(details.project_id, input),
    ).rejects.toThrow('The discussion response contained invalid data.');
  });

  it('rejects malformed or incomplete versioned context packages', async () => {
    const projectItem = frozenContext.items[0];
    const bubbleItem = {
      id: 'context/bubble',
      source_kind: 'bubble' as const,
      source_id: 'bubble/id',
      source_title: 'A frozen bubble',
      frozen_content: 'Complete frozen bubble content.',
      created_at: '2026-07-27T10:00:00.000Z',
      display_order: 1,
    };
    const invalidContexts: unknown[] = [
      { version: 2, items: [projectItem] },
      { version: 1, items: [] },
      {
        version: 1,
        items: [{ ...projectItem, source_kind: 'unsupported' }],
      },
      {
        version: 1,
        items: [projectItem, { ...bubbleItem, id: projectItem.id }],
      },
      {
        version: 1,
        items: [
          projectItem,
          bubbleItem,
          {
            ...bubbleItem,
            id: 'context/duplicate-source',
            display_order: 2,
          },
        ],
      },
      {
        version: 1,
        items: [projectItem, { ...bubbleItem, display_order: 2 }],
      },
      {
        version: 1,
        items: [{ ...bubbleItem, display_order: 0 }],
      },
      {
        version: 1,
        items: [{ ...projectItem, source_title: ' ' }],
      },
      {
        version: 1,
        items: [{ ...projectItem, created_at: 'not-a-timestamp' }],
      },
      {
        version: 1,
        items: [projectItem, { ...bubbleItem, frozen_content: ' ' }],
      },
    ];

    for (const frozenContext of invalidContexts) {
      const invalidApi = createDiscussionsApi(
        createRequestFake([
          { ...details, frozen_context: frozenContext },
        ]).request,
      );

      await expect(
        invalidApi.getDiscussion(details.project_id, details.id),
      ).rejects.toThrow('The discussion response contained invalid data.');
    }
  });

  it('keeps historical opaque context readable without reinterpreting it', async () => {
    const legacyDetails = {
      ...details,
      frozen_context: {
        project_description: {
          content: 'Historical frozen content.',
        },
      },
    };
    const api = createDiscussionsApi(
      createRequestFake([legacyDetails]).request,
    );

    await expect(
      api.getDiscussion(details.project_id, details.id),
    ).resolves.toBe(legacyDetails);
  });

  it('accepts an explicit empty project-description snapshot', async () => {
    const emptyProjectDescription = {
      ...details,
      frozen_context: {
        ...frozenContext,
        items: [
          {
            ...frozenContext.items[0],
            frozen_content: '',
          },
        ],
      },
    };
    const api = createDiscussionsApi(
      createRequestFake([emptyProjectDescription]).request,
    );

    await expect(
      api.getDiscussion(details.project_id, details.id),
    ).resolves.toBe(emptyProjectDescription);
  });

  it('sends and retries a message through the idempotent message endpoint', async () => {
    const responseDetails: DiscussionDetails = {
      ...details,
      id: 'discussion',
      project_id: 'project',
      frozen_context: {
        ...frozenContext,
        items: [
          {
            ...frozenContext.items[0],
            source_id: 'project',
          },
        ],
      },
    };
    const { request, requests } = createRequestFake([
      responseDetails,
      responseDetails,
    ]);
    const api = createDiscussionsApi(request);
    const signal = new AbortController().signal;
    const input: SendMessageInput = {
      content: 'What should happen next?',
      idempotency_key: 'request/key',
    };

    await expect(
      api.sendDiscussionMessage('project', 'discussion', input, signal),
    ).resolves.toBe(responseDetails);
    await expect(
      api.retryDiscussionMessage('project', 'discussion', input, signal),
    ).resolves.toBe(responseDetails);

    expect(requests).toEqual([
      {
        path: '/projects/project/discussions/discussion/messages',
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal,
        },
      },
      {
        path: '/projects/project/discussions/discussion/messages',
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal,
        },
      },
    ]);
  });

  it('generates titles, records opens, and deletes with abort support', async () => {
    const responseDetails: DiscussionDetails = {
      ...details,
      id: 'discussion',
      project_id: 'project',
      frozen_context: {
        ...frozenContext,
        items: [
          {
            ...frozenContext.items[0],
            source_id: 'project',
          },
        ],
      },
    };
    const { request, requests } = createRequestFake([
      responseDetails,
      responseDetails,
      undefined,
    ]);
    const api = createDiscussionsApi(request);
    const signal = new AbortController().signal;

    await expect(
      api.generateDiscussionTitle('project', 'discussion', signal),
    ).resolves.toBe(responseDetails);
    await expect(
      api.recordDiscussionOpen('project', 'discussion', signal),
    ).resolves.toBe(responseDetails);
    await expect(
      api.deleteDiscussion('project', 'discussion', signal),
    ).resolves.toBeUndefined();

    expect(requests).toEqual([
      {
        path: '/projects/project/discussions/discussion/title',
        init: { method: 'POST', signal },
      },
      {
        path: '/projects/project/discussions/discussion/open',
        init: { method: 'POST', signal },
      },
      {
        path: '/projects/project/discussions/discussion',
        init: { method: 'DELETE', signal },
      },
    ]);
  });
});

import type {
  CreateDiscussionInput,
  DiscussionDetails,
  DiscussionListResponse,
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

const details: DiscussionDetails = {
  id: 'discussion/id',
  project_id: 'project/id',
  title: 'New discussion',
  frozen_context: { project_description: 'A frozen description.' },
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
      frozen_context: details.frozen_context,
      first_prompt: 'What is the main risk?',
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

  it('sends and retries a message through the idempotent message endpoint', async () => {
    const { request, requests } = createRequestFake([details, details]);
    const api = createDiscussionsApi(request);
    const signal = new AbortController().signal;
    const input: SendMessageInput = {
      content: 'What should happen next?',
      idempotency_key: 'request/key',
    };

    await expect(
      api.sendDiscussionMessage('project', 'discussion', input, signal),
    ).resolves.toBe(details);
    await expect(
      api.retryDiscussionMessage('project', 'discussion', input, signal),
    ).resolves.toBe(details);

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
    const { request, requests } = createRequestFake([
      details,
      details,
      undefined,
    ]);
    const api = createDiscussionsApi(request);
    const signal = new AbortController().signal;

    await expect(
      api.generateDiscussionTitle('project', 'discussion', signal),
    ).resolves.toBe(details);
    await expect(
      api.recordDiscussionOpen('project', 'discussion', signal),
    ).resolves.toBe(details);
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

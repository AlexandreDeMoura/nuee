import type { BubbleLink } from '@nuee/shared-types';
import { describe, expect, it } from 'vitest';
import {
  createBubblesApi,
  isBubbleLinkListResponse,
  isBubbleLinkResponse,
  isBubbleListResponse,
  type Bubble,
  type BubblesRequest,
} from '../src/api/bubbles';

interface RecordedRequest {
  init?: RequestInit;
  path: string;
}

function createRequestFake(responses: unknown[]) {
  const requests: RecordedRequest[] = [];
  const request: BubblesRequest = <T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> => {
    requests.push({ init, path });
    return Promise.resolve(responses.shift() as T);
  };

  return { request, requests };
}

function bubble(overrides: Partial<Bubble> = {}): Bubble {
  return {
    id: 'bubble/1',
    project_id: 'project/1',
    title: 'Durable knowledge',
    summary: null,
    content: 'A complete manual bubble.',
    position_x: 12,
    position_y: -24,
    created_at: '2026-08-03T08:00:00.000Z',
    updated_at: '2026-08-03T08:01:00.000Z',
    source_kind: 'manual',
    source_discussion_id: null,
    source_discussion_title: null,
    source_discussion_deleted_at: null,
    source_message_ids: [],
    source_context_item_ids: [],
    ...overrides,
  };
}

function bubbleLink(overrides: Partial<BubbleLink> = {}): BubbleLink {
  return {
    id: 'link/1',
    project_id: 'project/1',
    bubble_a_id: 'bubble/1',
    bubble_b_id: 'bubble/2',
    created_at: '2026-08-03T08:02:00.000Z',
    ...overrides,
  };
}

describe('bubbles API', () => {
  it('validates bubble and placement responses before resolving', async () => {
    const savedBubble = bubble();
    const placement = { position_x: 36, position_y: -12 };
    const { request } = createRequestFake([
      [savedBubble],
      placement,
      savedBubble,
      savedBubble,
      [savedBubble],
      savedBubble,
    ]);
    const api = createBubblesApi(request);

    await expect(api.getProjectBubbles('project/1')).resolves.toEqual([
      savedBubble,
    ]);
    await expect(
      api.getBubblePlacement('project/1', { strategy: 'cluster' }),
    ).resolves.toBe(placement);
    await expect(
      api.createBubble('project/1', {
        title: savedBubble.title,
        summary: savedBubble.summary,
        content: savedBubble.content,
        position_x: savedBubble.position_x,
        position_y: savedBubble.position_y,
      }),
    ).resolves.toBe(savedBubble);
    await expect(
      api.updateBubblePosition('project/1', 'bubble/1', {
        position_x: 12,
        position_y: -24,
      }),
    ).resolves.toBe(savedBubble);
    await expect(
      api.updateBubblePositions('project/1', {
        positions: [
          { bubble_id: 'bubble/1', position_x: 12, position_y: -24 },
        ],
      }),
    ).resolves.toEqual([savedBubble]);
    await expect(
      api.updateBubble(
        'project/1',
        'bubble/1',
        {
          title: savedBubble.title,
          summary: savedBubble.summary,
          content: savedBubble.content,
        },
      ),
    ).resolves.toBe(savedBubble);
  });

  it('rejects malformed data from every bubble response endpoint', async () => {
    const wrongBubble = bubble({ project_id: 'project/2' });
    const wrongIdentity = bubble({ id: 'bubble/2' });
    const { request } = createRequestFake([
      [wrongBubble],
      { position_x: Number.NaN, position_y: 0 },
      wrongBubble,
      wrongIdentity,
      [wrongBubble],
      wrongIdentity,
    ]);
    const api = createBubblesApi(request);

    await expect(api.getProjectBubbles('project/1')).rejects.toThrow(
      'The bubble list response contained invalid data.',
    );
    await expect(
      api.getBubblePlacement('project/1', { strategy: 'viewport' }),
    ).rejects.toThrow('The bubble placement response contained invalid data.');
    await expect(
      api.createBubble('project/1', {
        title: 'Bubble',
        summary: null,
        content: 'Content',
        position_x: 0,
        position_y: 0,
      }),
    ).rejects.toThrow('The bubble response contained invalid data.');
    await expect(
      api.updateBubblePosition('project/1', 'bubble/1', {
        position_x: 0,
        position_y: 0,
      }),
    ).rejects.toThrow('The bubble response contained invalid data.');
    await expect(
      api.updateBubblePositions('project/1', { positions: [] }),
    ).rejects.toThrow('The bubble list response contained invalid data.');
    await expect(
      api.updateBubble('project/1', 'bubble/1', {
        title: 'Bubble',
        summary: null,
        content: 'Content',
      }),
    ).rejects.toThrow('The bubble response contained invalid data.');
  });

  it('rejects duplicate bubbles and validates link invariants', () => {
    const savedBubble = bubble();
    const link = bubbleLink();

    expect(isBubbleListResponse([savedBubble], 'project/1')).toBe(true);
    expect(
      isBubbleListResponse([savedBubble, savedBubble], 'project/1'),
    ).toBe(false);
    expect(isBubbleLinkResponse(link, 'project/1')).toBe(true);
    expect(
      isBubbleLinkResponse({ ...link, id: ' ' }, 'project/1'),
    ).toBe(false);
    expect(isBubbleLinkResponse(link, 'project/2')).toBe(false);
    expect(
      isBubbleLinkResponse(
        { ...link, bubble_a_id: 'bubble/2', bubble_b_id: 'bubble/1' },
        'project/1',
      ),
    ).toBe(false);
    expect(
      isBubbleLinkResponse(
        { ...link, created_at: 'not-a-timestamp' },
        'project/1',
      ),
    ).toBe(false);
    expect(
      isBubbleLinkListResponse(
        [link, bubbleLink({ id: 'link/2' })],
        'project/1',
      ),
    ).toBe(false);
  });

  it('validates link lists and created-link identity at the boundary', async () => {
    const link = bubbleLink();
    const { request } = createRequestFake([
      [link],
      link,
      [link, bubbleLink({ id: 'link/2' })],
      bubbleLink({ bubble_a_id: 'bubble/3', bubble_b_id: 'bubble/4' }),
    ]);
    const api = createBubblesApi(request);

    await expect(api.getBubbleLinks('project/1')).resolves.toEqual([link]);
    await expect(
      api.createBubbleLink('project/1', {
        bubble_a_id: 'bubble/2',
        bubble_b_id: 'bubble/1',
      }),
    ).resolves.toBe(link);
    await expect(api.getBubbleLinks('project/1')).rejects.toThrow(
      'The bubble link list response contained invalid data.',
    );
    await expect(
      api.createBubbleLink('project/1', {
        bubble_a_id: 'bubble/1',
        bubble_b_id: 'bubble/2',
      }),
    ).rejects.toThrow('The bubble link response contained invalid data.');
  });
});

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DiscussionDetails,
  SendMessageInput,
} from '../api';
import type { AnalyticsClient } from '../analytics';
import { useDiscussionLifecycle } from './useDiscussionLifecycle';

afterEach(cleanup);

const createdAt = '2026-08-01T10:00:00.000Z';

function discussion(
  messages: DiscussionDetails['messages'] = [],
): DiscussionDetails {
  return {
    id: 'discussion-a',
    project_id: 'project-a',
    title: 'Current research',
    frozen_context: {},
    created_at: createdAt,
    updated_at: createdAt,
    last_activity_at: createdAt,
    messages,
  };
}

describe('useDiscussionLifecycle search analytics', () => {
  it('records requested search, provider usage, and citation count without source content', async () => {
    const analyticsClient = {
      track: vi.fn(),
    } as unknown as AnalyticsClient;
    const send = vi.fn(
      async (
        _projectId: string,
        _discussionId: string,
        input: SendMessageInput,
      ) =>
        discussion([
          {
            id: 'message-user',
            discussion_id: 'discussion-a',
            role: 'user',
            content: input.content,
            created_at: createdAt,
            status: 'completed',
            request_id: input.idempotency_key,
          },
          {
            id: 'message-assistant',
            discussion_id: 'discussion-a',
            role: 'assistant',
            content: 'A current answer.',
            created_at: '2026-08-01T10:00:01.000Z',
            status: 'completed',
            request_id: null,
            web_search_used: true,
            citations: [
              { url: 'https://example.com/a', title: 'Private source A' },
              { url: 'https://example.com/b', title: 'Private source B' },
            ],
          },
        ]),
    );
    const requests = {
      capabilities: async () => ({ web_search: true }),
      get: async () => discussion(),
      send,
    };
    const onDiscussionCreated = vi.fn();
    const onDraftPromptChange = vi.fn();
    const { result } = renderHook(() =>
      useDiscussionLifecycle({
        analyticsClient,
        onDiscussionCreated,
        onDraftPromptChange,
        projectId: 'project-a',
        requests,
        visibleDiscussion: {
          discussionId: 'discussion-a',
          kind: 'persisted',
          title: 'Current research',
        },
      }),
    );

    await waitFor(() => {
      expect(result.current.loadStatus).toBe('ready');
      expect(result.current.webSearchSupported).toBe(true);
    });

    act(() => {
      result.current.onComposerChange('What changed?');
      result.current.setWebSearchEnabled(true);
    });

    await waitFor(() => expect(result.current.webSearchEnabled).toBe(true));
    act(() => result.current.submit());

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.pendingTurn).toBeNull());
    expect(result.current.composerError).toBeNull();
    expect(result.current.details?.messages).toHaveLength(2);
    await waitFor(() =>
      expect(analyticsClient.track).toHaveBeenCalledWith(
        'discussion_response_completed',
        expect.objectContaining({
          web_search_requested: true,
          web_search_used: true,
          citation_count: 2,
        }),
      ),
    );

    expect(send.mock.calls[0][2]).toMatchObject({ web_search: true });
    const analyticsCalls = (
      analyticsClient.track as ReturnType<typeof vi.fn>
    ).mock.calls;

    expect(JSON.stringify(analyticsCalls)).not.toContain('Private source');
    expect(analyticsClient.track).not.toHaveBeenCalledWith(
      'discussion_response_completed',
      expect.objectContaining({ citations: expect.anything() }),
    );
  });
});

import { describe, expect, it } from 'vitest';
import { isDiscussionDetails } from './discussionResponse';

const createdAt = '2026-08-01T10:00:00.000Z';

function responseWith(message: Record<string, unknown>) {
  return {
    id: 'discussion-a',
    project_id: 'project-a',
    title: 'Current research',
    frozen_context: {},
    created_at: createdAt,
    updated_at: createdAt,
    last_activity_at: createdAt,
    messages: [
      {
        id: 'message-a',
        discussion_id: 'discussion-a',
        role: 'assistant',
        content: 'A sourced answer.',
        created_at: createdAt,
        status: 'completed',
        request_id: null,
        ...message,
      },
    ],
  };
}

describe('discussion response search attribution', () => {
  it('accepts structurally valid citations without treating URLs as trusted links', () => {
    expect(
      isDiscussionDetails(
        responseWith({
          web_search_used: true,
          citations: [
            {
              url: 'javascript:alert(1)',
              title: 'Untrusted scheme',
              snippet: 'Rendering decides whether this is linkable.',
            },
          ],
        }),
        'project-a',
      ),
    ).toBe(true);
  });

  it('rejects malformed citation structures at the API boundary', () => {
    expect(
      isDiscussionDetails(
        responseWith({
          web_search_used: true,
          citations: [{ url: 7, title: 'Invalid source' }],
        }),
        'project-a',
      ),
    ).toBe(false);
  });
});

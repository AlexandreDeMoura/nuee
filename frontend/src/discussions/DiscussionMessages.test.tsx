import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscussionDetails, DiscussionMessage } from '../api';
import { DiscussionMessages } from './DiscussionMessages';
import type { PendingDiscussionTurn } from './useDiscussionLifecycle';

afterEach(cleanup);

const createdAt = '2026-08-01T10:00:00.000Z';

function detailsWith(message: DiscussionMessage): DiscussionDetails {
  return {
    id: 'discussion-a',
    project_id: 'project-a',
    title: 'Current research',
    frozen_context: {},
    created_at: createdAt,
    updated_at: createdAt,
    last_activity_at: createdAt,
    messages: [message],
  };
}

function renderAssistant(message: Partial<DiscussionMessage>) {
  render(
    <DiscussionMessages
      details={detailsWith({
        id: 'message-a',
        discussion_id: 'discussion-a',
        role: 'assistant',
        content: 'A sourced answer.',
        created_at: createdAt,
        status: 'completed',
        request_id: null,
        ...message,
      })}
      loadError={null}
      loadStatus="ready"
      onRetry={vi.fn()}
      pendingTurn={null}
    />,
  );
}

function renderFailedTurn(turn: Partial<PendingDiscussionTurn> = {}) {
  render(
    <DiscussionMessages
      details={null}
      loadError={null}
      loadStatus="ready"
      onRetry={vi.fn()}
      pendingTurn={{
        content: 'What changed today?',
        discussionId: 'discussion-a',
        requestId: 'request-a',
        status: 'failed',
        webSearch: true,
        ...turn,
      }}
    />,
  );
}

describe('DiscussionMessages web sources', () => {
  it('renders safe attributed links in order with accessible new-tab labels', () => {
    renderAssistant({
      web_search_used: true,
      citations: [
        {
          url: 'https://example.com/current-release',
          title: 'Current release notes',
          snippet: 'Published this week.',
        },
        {
          url: 'http://news.example.test/story',
          title: '  ',
        },
        {
          url: 'javascript:alert(1)',
          title: 'Unsafe source',
        },
        {
          url: 'not a URL',
          title: 'Malformed source',
        },
      ],
    });

    const sources = screen.getByLabelText('Web search sources');
    const links = within(sources).getAllByRole<HTMLAnchorElement>('link');

    expect(within(sources).getByText('Searched the web')).not.toBeNull();
    expect(links.map((link) => link.textContent)).toEqual([
      'Current release notes',
      'news.example.test',
    ]);
    expect(links[0].href).toBe('https://example.com/current-release');
    expect(links[0].target).toBe('_blank');
    expect(links[0].rel).toBe('noopener noreferrer');
    expect(links[0].getAttribute('aria-label')).toBe(
      'Open source: Current release notes (opens in a new tab)',
    );
    expect(within(sources).getByText('Published this week.')).not.toBeNull();
    expect(within(sources).queryByText('Unsafe source')).toBeNull();
    expect(within(sources).queryByText('Malformed source')).toBeNull();
  });

  it('shows a graceful searched-without-citations state', () => {
    renderAssistant({ web_search_used: true, citations: [] });

    expect(
      screen.getByText('No web sources were cited for this response.'),
    ).not.toBeNull();
  });

  it('leaves legacy assistant messages without source chrome', () => {
    renderAssistant({});

    expect(screen.queryByLabelText('Web search sources')).toBeNull();
  });
});

describe('DiscussionMessages generation failures', () => {
  it('explains a web-search timeout while preserving the retry action', () => {
    renderFailedTurn({ failureCode: 'AI_GENERATION_TIMEOUT' });

    expect(screen.getByText('Response timed out')).not.toBeNull();
    expect(
      screen.getByText(
        'Web search took longer than five minutes. Your message was saved and you can retry the response.',
      ),
    ).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Retry response' }),
    ).not.toBeNull();
  });

  it('keeps the generic message for other generation failures', () => {
    renderFailedTurn({ failureCode: 'AI_GENERATION_FAILED' });

    expect(screen.getByText('Response failed')).not.toBeNull();
    expect(
      screen.getByText(
        'Your message was saved. Retry this response without adding another copy of the message.',
      ),
    ).not.toBeNull();
  });
});

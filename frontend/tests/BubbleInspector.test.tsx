import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { Bubble, BubbleLink } from '../src/api';
import type { AnalyticsClient } from '../src/analytics';
import { BubbleInspector } from '../src/bubbles/BubbleInspector';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function bubble(overrides: Partial<Bubble> = {}): Bubble {
  return {
    id: 'bubble-1',
    project_id: 'project-123',
    title: 'Last-mile is the make-or-break',
    summary: 'Density decides whether the last mile is viable.',
    content:
      'The final delivery leg accounts for most of the delivered cost.',
    position_x: 72,
    position_y: 146,
    created_at: '2026-07-19T10:00:00.000Z',
    updated_at: '2026-07-20T10:00:00.000Z',
    source_kind: 'discussion',
    source_discussion_id: 'discussion-1',
    source_message_ids: ['message-1', 'message-2'],
    ...overrides,
  };
}

function bubbleLink(overrides: Partial<BubbleLink> = {}): BubbleLink {
  return {
    id: 'link-1',
    project_id: 'project-123',
    bubble_a_id: 'bubble-1',
    bubble_b_id: 'bubble-2',
    created_at: '2026-07-23T10:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BubbleInspector', () => {
  it('shows complete bubble content, source information, and the content-updated date', () => {
    render(
      <BubbleInspector
        bubble={bubble()}
        onBubbleUpdated={vi.fn()}
      />,
    );

    expect(screen.getByText('Last-mile is the make-or-break')).toBeTruthy();
    expect(
      screen.getByText('Density decides whether the last mile is viable.'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'The final delivery leg accounts for most of the delivered cost.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Discussion discussion-1 · 2 source messages'),
    ).toBeTruthy();
    expect(document.querySelector('time')?.getAttribute('dateTime')).toBe(
      '2026-07-20T10:00:00.000Z',
    );
  });

  it('debounces edits, trims saved fields, refreshes details, and records a successful edit', async () => {
    const updatedBubble = bubble({
      title: 'Revised last-mile thesis',
      summary: null,
      content: 'Route density is the decisive constraint.',
      updated_at: '2026-07-23T10:00:00.000Z',
    });
    const requestUpdate = vi.fn().mockResolvedValue(updatedBubble);
    const onBubbleUpdated = vi.fn();
    const track = vi.fn<AnalyticsClient['track']>();

    render(
      <BubbleInspector
        analyticsClient={{ track }}
        bubble={bubble()}
        onBubbleUpdated={onBubbleUpdated}
        requestUpdate={requestUpdate}
        saveDelayMs={10}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit bubble' }));
    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: 'First revision' },
    });
    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: '  Revised last-mile thesis  ' },
    });
    fireEvent.change(screen.getByLabelText(/^Summary/), {
      target: { value: '   ' },
    });
    fireEvent.change(screen.getByLabelText(/^Content/), {
      target: { value: '  Route density is the decisive constraint.  ' },
    });

    await waitFor(() => expect(requestUpdate).toHaveBeenCalledTimes(1));
    expect(requestUpdate).toHaveBeenCalledWith(
      'project-123',
      'bubble-1',
      {
        title: 'Revised last-mile thesis',
        summary: null,
        content: 'Route density is the decisive constraint.',
      },
      expect.any(AbortSignal),
    );
    await waitFor(() =>
      expect(onBubbleUpdated).toHaveBeenCalledWith(updatedBubble),
    );
    expect(track).toHaveBeenCalledWith('bubble_content_updated', {
      project_id: 'project-123',
      bubble_id: 'bubble-1',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));
    expect(screen.getByText('Revised last-mile thesis')).toBeTruthy();
    expect(screen.queryByText('Density decides whether the last mile is viable.')).toBeNull();
    expect(
      screen.getByText('Route density is the decisive constraint.'),
    ).toBeTruthy();
  });

  it('keeps invalid required fields local and never sends them', async () => {
    const requestUpdate = vi.fn();

    render(
      <BubbleInspector
        bubble={bubble()}
        onBubbleUpdated={vi.fn()}
        requestUpdate={requestUpdate}
        saveDelayMs={0}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit bubble' }));
    const title = screen.getByLabelText(/^Title/);
    fireEvent.change(title, { target: { value: '   ' } });

    expect(await screen.findByText('A title is required.')).toBeTruthy();
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(requestUpdate).not.toHaveBeenCalled();
  });

  it('retains a failed draft and retries the exact normalized content', async () => {
    const updatedBubble = bubble({
      content: 'A recoverable bubble draft.',
      updated_at: '2026-07-23T10:00:00.000Z',
    });
    const requestUpdate = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce(updatedBubble);
    const onBubbleUpdated = vi.fn();

    render(
      <BubbleInspector
        bubble={bubble()}
        onBubbleUpdated={onBubbleUpdated}
        requestUpdate={requestUpdate}
        saveDelayMs={0}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit bubble' }));
    const content = screen.getByLabelText(/^Content/) as HTMLTextAreaElement;
    fireEvent.change(content, {
      target: { value: 'A recoverable bubble draft.' },
    });

    expect(await screen.findByText('Couldn’t save the bubble')).toBeTruthy();
    expect(content.value).toBe('A recoverable bubble draft.');

    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));

    await waitFor(() =>
      expect(onBubbleUpdated).toHaveBeenCalledWith(updatedBubble),
    );
    expect(requestUpdate).toHaveBeenCalledTimes(2);
    expect(requestUpdate.mock.calls[1]?.[2]).toEqual(
      requestUpdate.mock.calls[0]?.[2],
    );
  });

  it('aborts a pending edit and ignores its response after the selection changes', async () => {
    const pendingSave = deferred<Bubble>();
    const requestUpdate = vi.fn(
      (
        projectId: string,
        bubbleId: string,
        input: unknown,
        signal?: AbortSignal,
      ) => {
        void projectId;
        void bubbleId;
        void input;
        void signal;
        return pendingSave.promise;
      },
    );
    const onBubbleUpdated = vi.fn();
    const rendered = render(
      <BubbleInspector
        bubble={bubble()}
        onBubbleUpdated={onBubbleUpdated}
        requestUpdate={requestUpdate}
        saveDelayMs={0}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit bubble' }));
    fireEvent.change(screen.getByLabelText(/^Content/), {
      target: { value: 'Pending content.' },
    });
    await waitFor(() => expect(requestUpdate).toHaveBeenCalledTimes(1));

    const signal = requestUpdate.mock.calls[0]?.[3];
    rendered.unmount();
    expect(signal?.aborted).toBe(true);

    await act(async () => {
      pendingSave.resolve(
        bubble({
          content: 'Pending content.',
          updated_at: '2026-07-23T10:00:00.000Z',
        }),
      );
    });
    expect(onBubbleUpdated).not.toHaveBeenCalled();
  });

  it('creates a manual link from same-project candidates and records success', async () => {
    const secondBubble = bubble({
      id: 'bubble-2',
      title: 'Regulatory lead time',
    });
    const createdLink = bubbleLink();
    const requestCreateLink = vi.fn().mockResolvedValue(createdLink);
    const onBubbleLinkCreated = vi.fn();
    const track = vi.fn<AnalyticsClient['track']>();

    render(
      <BubbleInspector
        analyticsClient={{ track }}
        availableBubbles={[bubble(), secondBubble]}
        bubble={bubble()}
        onBubbleLinkCreated={onBubbleLinkCreated}
        onBubbleUpdated={vi.fn()}
        requestCreateLink={requestCreateLink}
      />,
    );

    fireEvent.change(screen.getByLabelText('Bubble to link'), {
      target: { value: secondBubble.id },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));

    await waitFor(() =>
      expect(onBubbleLinkCreated).toHaveBeenCalledWith(createdLink),
    );
    expect(requestCreateLink).toHaveBeenCalledWith('project-123', {
      bubble_a_id: 'bubble-1',
      bubble_b_id: 'bubble-2',
    });
    expect(track).toHaveBeenCalledWith('bubble_link_created', {
      project_id: 'project-123',
      bubble_a_id: 'bubble-1',
      bubble_b_id: 'bubble-2',
    });
  });

  it('lists direct links and removes either endpoint order', async () => {
    const secondBubble = bubble({
      id: 'bubble-2',
      title: 'Regulatory lead time',
    });
    const reversedLink = bubbleLink({
      bubble_a_id: 'bubble-2',
      bubble_b_id: 'bubble-1',
    });
    const requestDeleteLink = vi.fn().mockResolvedValue(undefined);
    const onBubbleLinkRemoved = vi.fn();

    render(
      <BubbleInspector
        availableBubbles={[bubble(), secondBubble]}
        bubble={bubble()}
        bubbleLinks={[reversedLink]}
        onBubbleLinkRemoved={onBubbleLinkRemoved}
        onBubbleUpdated={vi.fn()}
        requestDeleteLink={requestDeleteLink}
      />,
    );

    expect(screen.getByText('Regulatory lead time')).toBeTruthy();
    expect(
      (screen.getByLabelText('Bubble to link') as HTMLSelectElement).disabled,
    ).toBe(true);

    fireEvent.click(
      screen.getByRole('button', { name: 'Unlink Regulatory lead time' }),
    );

    await waitFor(() =>
      expect(onBubbleLinkRemoved).toHaveBeenCalledWith(reversedLink),
    );
    expect(requestDeleteLink).toHaveBeenCalledWith(
      'project-123',
      'bubble-1',
      'bubble-2',
    );
  });

  it('confirms deletion with frozen-context guidance and records success', async () => {
    const requestDelete = vi.fn().mockResolvedValue(undefined);
    const onBubbleDeleted = vi.fn();
    const track = vi.fn<AnalyticsClient['track']>();

    render(
      <BubbleInspector
        analyticsClient={{ track }}
        bubble={bubble()}
        onBubbleDeleted={onBubbleDeleted}
        onBubbleUpdated={vi.fn()}
        requestDelete={requestDelete}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete bubble' }));

    const confirmation = screen.getByRole('alertdialog');
    expect(confirmation.textContent).toContain(
      'Delete “Last-mile is the make-or-break”?',
    );
    expect(confirmation.textContent).toContain(
      'Its source discussion and any frozen copies already captured in existing discussions stay intact.',
    );

    fireEvent.click(
      within(confirmation).getByRole('button', { name: 'Delete bubble' }),
    );

    await waitFor(() =>
      expect(onBubbleDeleted).toHaveBeenCalledWith(bubble()),
    );
    expect(requestDelete).toHaveBeenCalledWith(
      'project-123',
      'bubble-1',
      expect.any(AbortSignal),
    );
    expect(track).toHaveBeenCalledWith('bubble_deleted', {
      project_id: 'project-123',
      bubble_id: 'bubble-1',
    });
  });

  it('keeps the deletion confirmation recoverable after a failed request', async () => {
    const requestDelete = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce(undefined);
    const onBubbleDeleted = vi.fn();

    render(
      <BubbleInspector
        bubble={bubble()}
        onBubbleDeleted={onBubbleDeleted}
        onBubbleUpdated={vi.fn()}
        requestDelete={requestDelete}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete bubble' }));
    const confirmation = screen.getByRole('alertdialog');
    fireEvent.click(
      within(confirmation).getByRole('button', { name: 'Delete bubble' }),
    );

    expect(
      await screen.findByText('Couldn’t delete the bubble. Try again.'),
    ).toBeTruthy();
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete bubble',
      }),
    );

    await waitFor(() =>
      expect(onBubbleDeleted).toHaveBeenCalledWith(bubble()),
    );
    expect(requestDelete).toHaveBeenCalledTimes(2);
  });
});

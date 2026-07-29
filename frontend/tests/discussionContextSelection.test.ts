import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDiscussionContextSelection } from '../src/discussions';

describe('discussion context selection coordinator', () => {
  it('keeps ordered identifier-only selections and deduplicates repeated sources', () => {
    const { result } = renderHook(() =>
      useDiscussionContextSelection('project-1'),
    );

    act(() =>
      result.current.prepare({
        entryPoint: 'selected_bubble',
        initialSources: [
          {
            id: 'bubble-1',
            kind: 'bubble',
            projectId: 'project-1',
            title: 'Initial title',
          },
          {
            id: 'bubble-1',
            kind: 'bubble',
            projectId: 'project-1',
            title: 'Latest review title',
          },
          {
            id: 'bubble-other',
            kind: 'bubble',
            projectId: 'project-2',
            title: 'Another project',
          },
        ],
      }),
    );
    act(() => result.current.invite('What should we launch first?'));

    expect(result.current.phase).toBe('invitation');
    expect(result.current.prompt).toBe('What should we launch first?');
    expect(result.current.selection).toEqual({
      bubble_ids: ['bubble-1'],
      document_ids: [],
    });
    expect(result.current.pendingSources).toEqual([
      {
        id: 'bubble-1',
        kind: 'bubble',
        title: 'Latest review title',
      },
    ]);

    act(() => result.current.beginSourceSelection('document'));
    expect(result.current.phase).toBe('selecting_documents');

    act(() =>
      result.current.confirmSourceSelection('document', [
        {
          id: 'document-2',
          kind: 'document',
          projectId: 'project-1',
          title: 'Customer interviews',
        },
        {
          id: 'document-1',
          kind: 'document',
          projectId: 'project-1',
          title: 'Launch brief',
        },
      ]),
    );

    expect(result.current.phase).toBe('review');
    expect(result.current.selection).toEqual({
      bubble_ids: ['bubble-1'],
      document_ids: ['document-2', 'document-1'],
    });

    act(() => result.current.removeSource('document', 'document-2'));
    expect(result.current.selection.document_ids).toEqual(['document-1']);
  });

  it('preserves choices through recoverable errors and clears them on cancellation', () => {
    const { result } = renderHook(() =>
      useDiscussionContextSelection('project-1'),
    );

    act(() => {
      result.current.prepare({ entryPoint: 'canvas_action' });
      result.current.invite('Where are the risks?');
    });
    act(() =>
      result.current.confirmSourceSelection('bubble', [
        {
          id: 'bubble-1',
          kind: 'bubble',
          projectId: 'project-1',
          title: 'Launch risks',
        },
      ]),
    );
    act(() => result.current.beginSubmitting());
    act(() => result.current.submissionFailed('Source changed.'));

    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('Source changed.');
    expect(result.current.selection.bubble_ids).toEqual(['bubble-1']);

    act(() => result.current.retrySubmission());
    expect(result.current.phase).toBe('submitting');
    expect(result.current.selection.bubble_ids).toEqual(['bubble-1']);

    act(() => result.current.cancel());
    expect(result.current.phase).toBe('idle');
    expect(result.current.prompt).toBe('');
    expect(result.current.pendingSources).toEqual([]);
  });

  it('returns from source selection to the phase that launched it', () => {
    const { result } = renderHook(() =>
      useDiscussionContextSelection('project-1'),
    );

    act(() => {
      result.current.prepare({
        entryPoint: 'selected_bubble',
        initialSources: [
          {
            id: 'bubble-1',
            kind: 'bubble',
            projectId: 'project-1',
            title: 'Launch risks',
          },
        ],
      });
      result.current.invite('Where are the risks?');
    });

    act(() => result.current.beginSourceSelection('bubble'));
    act(() => result.current.backFromSourceSelection());

    expect(result.current.phase).toBe('invitation');
    expect(result.current.selection.bubble_ids).toEqual(['bubble-1']);

    act(() => result.current.review());
    act(() => result.current.beginSourceSelection('bubble'));
    act(() => result.current.backFromSourceSelection());

    expect(result.current.phase).toBe('review');
    expect(result.current.selection.bubble_ids).toEqual(['bubble-1']);
  });

  it('does not restore pending state after the owning project changes', () => {
    const { rerender, result } = renderHook(
      ({ projectId }) => useDiscussionContextSelection(projectId),
      { initialProps: { projectId: 'project-1' } },
    );

    act(() => {
      result.current.prepare({
        entryPoint: 'discussions_panel',
        initialSources: [
          {
            id: 'bubble-1',
            kind: 'bubble',
            projectId: 'project-1',
            title: 'Launch risks',
          },
        ],
      });
      result.current.invite('What changed?');
    });

    rerender({ projectId: 'project-2' });

    expect(result.current.phase).toBe('idle');
    expect(result.current.pendingSources).toEqual([]);
    expect(result.current.prompt).toBe('');

    rerender({ projectId: 'project-1' });
    expect(result.current.phase).toBe('idle');
    expect(result.current.pendingSources).toEqual([]);
  });
});

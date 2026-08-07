import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDiscussionContextSelection } from '../src/discussions';

describe('discussion draft context coordinator', () => {
  it('keeps ordered identifier-only sources and deduplicates replacements', () => {
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
            title: 'Latest title',
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

    expect(result.current.phase).toBe('idle');
    expect(result.current.pendingSources).toEqual([
      { id: 'bubble-1', kind: 'bubble', title: 'Latest title' },
    ]);
    expect(result.current.selectionRevision).toBe(0);

    act(() =>
      result.current.replaceSources([
        {
          id: 'bubble-1',
          kind: 'bubble',
          projectId: 'project-1',
          title: 'Latest title',
        },
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
        {
          id: 'document-2',
          kind: 'document',
          projectId: 'project-1',
          title: 'Latest customer interviews',
        },
      ]),
    );

    expect(result.current.selection).toEqual({
      bubble_ids: ['bubble-1'],
      document_ids: ['document-2', 'document-1'],
    });
    expect(result.current.pendingSources[1]?.title).toBe(
      'Latest customer interviews',
    );
    expect(result.current.selectionRevision).toBe(1);
  });

  it('preserves sources through a recoverable failure and clears a corrected issue', () => {
    const { result } = renderHook(() =>
      useDiscussionContextSelection('project-1'),
    );

    act(() =>
      result.current.prepare({
        entryPoint: 'canvas_action',
        initialSources: [
          {
            id: 'bubble-1',
            kind: 'bubble',
            projectId: 'project-1',
            title: 'Launch risks',
          },
        ],
      }),
    );
    act(() => result.current.beginSubmitting());
    act(() =>
      result.current.submissionFailed({
        code: 'DISCUSSION_CONTEXT_SOURCE_INVALID',
        message: 'Source changed.',
        sourceIssues: [
          {
            reason: 'missing',
            sourceId: 'bubble-1',
            sourceKind: 'bubble',
          },
        ],
      }),
    );

    expect(result.current.phase).toBe('error');
    expect(result.current.selection.bubble_ids).toEqual(['bubble-1']);
    expect(result.current.failure?.sourceIssues).toHaveLength(1);

    act(() => result.current.removeSource('bubble', 'bubble-1'));

    expect(result.current.phase).toBe('idle');
    expect(result.current.failure).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.selectionRevision).toBe(1);
  });

  it('rotates selection identity when an attachment is removed and restored', () => {
    const { result } = renderHook(() =>
      useDiscussionContextSelection('project-1'),
    );
    const source = {
      id: 'bubble-1',
      kind: 'bubble' as const,
      projectId: 'project-1',
      title: 'Launch risks',
    };

    act(() =>
      result.current.prepare({
        entryPoint: 'selected_bubble',
        initialSources: [source],
      }),
    );
    act(() => result.current.removeSource('bubble', source.id));
    act(() => result.current.replaceSources([source]));

    expect(result.current.selection.bubble_ids).toEqual([source.id]);
    expect(result.current.selectionRevision).toBe(2);
  });

  it('does not restore pending state after the owning project changes', () => {
    const { rerender, result } = renderHook(
      ({ projectId }) => useDiscussionContextSelection(projectId),
      { initialProps: { projectId: 'project-1' } },
    );

    act(() =>
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
      }),
    );

    rerender({ projectId: 'project-2' });
    expect(result.current.phase).toBe('idle');
    expect(result.current.pendingSources).toEqual([]);

    rerender({ projectId: 'project-1' });
    expect(result.current.pendingSources).toEqual([]);
  });
});

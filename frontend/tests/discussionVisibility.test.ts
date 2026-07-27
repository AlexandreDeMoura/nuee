import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDiscussionVisibility } from '../src/discussions';

describe('discussion visibility controller', () => {
  it('keeps at most one draft or persisted discussion visible', () => {
    const { result } = renderHook(() => useDiscussionVisibility('project-1'));

    expect(result.current.visibleDiscussion).toBeNull();

    act(() => result.current.openDraft());
    expect(result.current.visibleDiscussion).toMatchObject({
      kind: 'draft',
      prompt: '',
      title: 'New discussion',
    });

    act(() => result.current.updateDraftPrompt('What should we test?'));
    expect(result.current.visibleDiscussion).toMatchObject({
      kind: 'draft',
      prompt: 'What should we test?',
    });

    act(() =>
      result.current.openDiscussion({
        id: 'discussion-2',
        title: 'Testing strategy',
      }),
    );
    expect(result.current.visibleDiscussion).toEqual({
      discussionId: 'discussion-2',
      kind: 'persisted',
      title: 'Testing strategy',
    });

    act(() => result.current.openDraft());
    expect(result.current.visibleDiscussion).toMatchObject({
      kind: 'draft',
      prompt: '',
    });

    act(() => result.current.minimize());
    expect(result.current.visibleDiscussion).toBeNull();
  });

  it('does not carry a visible discussion into another project', () => {
    const { rerender, result } = renderHook(
      ({ projectId }) => useDiscussionVisibility(projectId),
      { initialProps: { projectId: 'project-1' } },
    );

    act(() =>
      result.current.openDiscussion({
        id: 'discussion-1',
        title: 'First project',
      }),
    );
    expect(result.current.visibleDiscussion).not.toBeNull();

    rerender({ projectId: 'project-2' });
    expect(result.current.visibleDiscussion).toBeNull();

    rerender({ projectId: 'project-1' });
    expect(result.current.visibleDiscussion).toBeNull();

    rerender({ projectId: 'project-2' });
    act(() => result.current.openDraft());
    expect(result.current.visibleDiscussion).toMatchObject({
      kind: 'draft',
      prompt: '',
    });
  });
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../api';
import { DeleteProjectDialog } from './DeleteProjectDialog';

afterEach(cleanup);

const project: Project = {
  id: 'project-one',
  title: 'Launch plan',
  description: 'Explore the launch constraints.',
  created_at: '2026-08-01T10:00:00.000Z',
  updated_at: '2026-08-01T10:00:00.000Z',
  canvas_viewport_x: 0,
  canvas_viewport_y: 0,
  canvas_zoom: 1,
};

describe('DeleteProjectDialog', () => {
  it('focuses cancel, states the permanent consequence, and deletes', async () => {
    const requestDelete = vi.fn(async () => undefined);
    const onDeleted = vi.fn();

    render(
      <DeleteProjectDialog
        onCancel={vi.fn()}
        onDeleted={onDeleted}
        project={project}
        requestDelete={requestDelete}
      />,
    );

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Delete “Launch plan”?')).not.toBeNull();
    expect(
      screen.getByText(
        'Its bubbles, territories, discussions, and documents will be deleted with it. This cannot be undone.',
      ),
    ).not.toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Cancel' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));

    await waitFor(() => {
      expect(requestDelete).toHaveBeenCalledWith(
        'project-one',
        expect.any(AbortSignal),
      );
    });
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed deletion open and retryable', async () => {
    const requestDelete = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    const onDeleted = vi.fn();

    render(
      <DeleteProjectDialog
        onCancel={vi.fn()}
        onDeleted={onDeleted}
        project={project}
        requestDelete={requestDelete}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));

    expect(
      await screen.findByText('Couldn’t delete the project. Try again.'),
    ).not.toBeNull();
    expect(screen.getByRole('alertdialog')).not.toBeNull();
    expect(onDeleted).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));

    await waitFor(() => expect(requestDelete).toHaveBeenCalledTimes(2));
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape and repeat submissions while the delete is in flight', async () => {
    let release = (): void => {};
    const requestDelete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        }),
    );
    const onCancel = vi.fn();

    render(
      <DeleteProjectDialog
        onCancel={onCancel}
        onDeleted={vi.fn()}
        project={project}
        requestDelete={requestDelete}
      />,
    );

    const confirm = screen.getByRole('button', { name: 'Delete project' });
    fireEvent.click(confirm);

    expect(await screen.findByText('Deleting…')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Deleting/ }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(requestDelete).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    release();
  });
});

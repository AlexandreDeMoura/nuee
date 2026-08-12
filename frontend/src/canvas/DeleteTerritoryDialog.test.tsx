import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Territory } from '../api';
import { DeleteTerritoryDialog } from './DeleteTerritoryDialog';

afterEach(cleanup);

const territory: Territory = {
  id: 'territory-one',
  project_id: 'project-one',
  kind: 'manual',
  title: 'Operations',
  position_x: 0,
  position_y: 0,
  visible_count: 2,
  created_at: '2026-08-01T10:00:00.000Z',
  updated_at: '2026-08-01T10:00:00.000Z',
};

describe('DeleteTerritoryDialog', () => {
  it('focuses confirmation, states the exact move consequence, and deletes', async () => {
    const requestDelete = vi.fn(async () => ({ moved_bubble_count: 2 }));
    const onDeleted = vi.fn();

    render(
      <DeleteTerritoryDialog
        bubbleCount={2}
        onCancel={vi.fn()}
        onDeleted={onDeleted}
        requestDelete={requestDelete}
        territory={territory}
      />,
    );

    expect(screen.getByRole('alertdialog').getAttribute('aria-modal')).toBe(
      'true',
    );
    expect(
      screen.getByText(
        '2 bubbles will move to Ungrouped. Their content, links, and sources will stay intact.',
      ),
    ).not.toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Cancel' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete territory' }));

    await waitFor(() => {
      expect(requestDelete).toHaveBeenCalledWith(
        'project-one',
        'territory-one',
        expect.any(AbortSignal),
      );
    });
    expect(onDeleted).toHaveBeenCalledWith({ moved_bubble_count: 2 });
  });

  it('keeps a failed deletion open and retryable', async () => {
    const requestDelete = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ moved_bubble_count: 0 });
    const onDeleted = vi.fn();

    render(
      <DeleteTerritoryDialog
        bubbleCount={0}
        onCancel={vi.fn()}
        onDeleted={onDeleted}
        requestDelete={requestDelete}
        territory={territory}
      />,
    );

    expect(
      screen.getByText(
        'This territory is empty. Deleting it removes only the territory.',
      ),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete territory' }));

    expect(
      await screen.findByText('Couldn’t delete the territory. Try again.'),
    ).not.toBeNull();
    expect(screen.getByRole('alertdialog')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete territory' }));
    await waitFor(() => expect(requestDelete).toHaveBeenCalledTimes(2));
    expect(onDeleted).toHaveBeenCalledWith({ moved_bubble_count: 0 });
  });
});

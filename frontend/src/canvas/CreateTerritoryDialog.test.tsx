import { TERRITORY_TITLE_MAX_LENGTH } from '@nuee/shared-types';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Territory } from '../api';
import { CreateTerritoryDialog } from './CreateTerritoryDialog';

afterEach(cleanup);

const createdTerritory: Territory = {
  id: 'territory-created',
  project_id: 'project-one',
  kind: 'manual',
  title: 'Research',
  position_x: 10,
  position_y: 20,
  visible_count: 4,
  created_at: '2026-08-11T10:00:00.000Z',
  updated_at: '2026-08-11T10:00:00.000Z',
};

describe('CreateTerritoryDialog', () => {
  it('validates the shared title limit inline before creating', async () => {
    const requestCreate = vi.fn(async () => createdTerritory);
    const onCreated = vi.fn();

    render(
      <CreateTerritoryDialog
        onCancel={vi.fn()}
        onCreated={onCreated}
        placement={{ position_x: 10, position_y: 20 }}
        projectId="project-one"
        requestCreate={requestCreate}
      />,
    );

    const input = screen.getByLabelText('Title *');
    expect(document.activeElement).toBe(input);

    fireEvent.click(screen.getByRole('button', { name: 'Create territory' }));
    expect(screen.getByText('Enter a territory title.')).not.toBeNull();

    fireEvent.change(input, {
      target: { value: 'x'.repeat(TERRITORY_TITLE_MAX_LENGTH + 1) },
    });
    expect(
      screen.getByText(
        `Use ${TERRITORY_TITLE_MAX_LENGTH} characters or fewer.`,
      ),
    ).not.toBeNull();
    expect(requestCreate).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '  Research  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create territory' }));

    await waitFor(() => {
      expect(requestCreate).toHaveBeenCalledWith('project-one', {
        title: 'Research',
        position_x: 10,
        position_y: 20,
      });
    });
    expect(onCreated).toHaveBeenCalledWith(createdTerritory);
  });
});

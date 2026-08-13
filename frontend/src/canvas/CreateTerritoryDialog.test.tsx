import { TERRITORY_TITLE_MAX_LENGTH } from '@nuee/shared-types';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Territory } from '../api';
import { CreateTerritoryDialog } from './CreateTerritoryDialog';

afterEach(cleanup);

/**
 * The error paragraph is always mounted and toggles a `invisible` class, so its
 * presence in the DOM proves nothing. Read what the user can actually see.
 */
function titleError() {
  const message = document.getElementById('create-territory-name-error');
  const isShown =
    screen.getByLabelText('Title *').getAttribute('aria-invalid') === 'true' &&
    message?.className.includes('invisible') === false;

  return { isShown, text: isShown ? message?.textContent?.trim() : undefined };
}

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
    expect(titleError().isShown).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Create territory' }));
    expect(titleError()).toEqual({
      isShown: true,
      text: 'Enter a territory title.',
    });

    fireEvent.change(input, {
      target: { value: 'x'.repeat(TERRITORY_TITLE_MAX_LENGTH + 1) },
    });
    expect(titleError()).toEqual({
      isShown: true,
      text: `Use ${TERRITORY_TITLE_MAX_LENGTH} characters or fewer.`,
    });
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

  it('stays pristine when StrictMode remounts the modal shell', () => {
    function Host() {
      const [isOpen, setIsOpen] = useState(false);

      return (
        <div>
          <button type="button" onClick={() => setIsOpen(true)}>
            New territory
          </button>
          {isOpen && (
            <CreateTerritoryDialog
              onCancel={vi.fn()}
              onCreated={vi.fn()}
              placement={{ position_x: 10, position_y: 20 }}
              projectId="project-one"
              requestCreate={vi.fn(async () => createdTerritory)}
            />
          )}
        </div>
      );
    }

    render(
      <StrictMode>
        <Host />
      </StrictMode>,
    );

    // The shell restores focus to the trigger on teardown, blurring the title
    // input. That blur is the shell's, not the user's, and must reveal nothing.
    const trigger = screen.getByRole('button', { name: 'New territory' });
    trigger.focus();
    fireEvent.click(trigger);

    expect(document.activeElement).toBe(screen.getByLabelText('Title *'));
    expect(titleError().isShown).toBe(false);
  });
});

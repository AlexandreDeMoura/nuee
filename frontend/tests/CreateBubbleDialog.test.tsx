import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TERRITORY_TITLE_MAX_LENGTH } from '@nuee/shared-types';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bubble, Territory } from '../src/api';
import { CreateBubbleDialog } from '../src/bubbles/CreateBubbleDialog';

const createdBubble: Bubble = {
  id: 'bubble-created',
  project_id: 'project-1',
  title: 'Break-even point',
  summary: null,
  content: 'Routes clear contribution margin above 40% utilization.',
  territory_id: 'territory-1',
  created_at: '2026-07-22T08:00:00.000Z',
  updated_at: '2026-07-22T08:00:00.000Z',
  source_kind: 'manual',
  source_discussion_id: null,
  source_discussion_title: null,
  source_discussion_deleted_at: null,
  source_message_ids: [],
  source_context_item_ids: [],
};

const existingTerritory: Territory = {
  id: 'territory-existing',
  project_id: 'project-1',
  kind: 'manual',
  title: 'Pricing research',
  position_x: 10,
  position_y: 20,
  visible_count: 4,
  created_at: '2026-07-22T08:00:00.000Z',
  updated_at: '2026-07-22T08:00:00.000Z',
};

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/^Title/), {
    target: { value: '  Break-even point  ' },
  });
  fireEvent.change(screen.getByLabelText(/^Content/), {
    target: {
      value: '  Routes clear contribution margin above 40% utilization.  ',
    },
  });
}

afterEach(cleanup);

describe('CreateBubbleDialog', () => {
  it('shows no validation on open when StrictMode remounts the dialog', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    render(
      <StrictMode>
        <CreateBubbleDialog
          onCancel={vi.fn()}
          onCreated={vi.fn()}
          projectId="project-1"
          requestCreate={vi.fn()}
        />
      </StrictMode>,
    );

    const title = screen.getByLabelText(/^Title/);

    expect(document.activeElement).toBe(title);
    expect(title.getAttribute('aria-invalid')).toBe('false');
    expect(
      screen.getByText('A title is required.').className,
    ).toContain('invisible');

    trigger.remove();
  });

  it('requires non-whitespace title and content while keeping summary optional', () => {
    render(
      <CreateBubbleDialog
        onCancel={vi.fn()}
        onCreated={vi.fn()}
        projectId="project-1"
        requestCreate={vi.fn()}
      />,
    );

    const title = screen.getByLabelText(/^Title/);
    const content = screen.getByLabelText(/^Content/);
    const submit = screen.getByRole('button', { name: 'Create bubble' }) as HTMLButtonElement;

    expect(document.activeElement).toBe(title);
    expect(submit.disabled).toBe(true);

    fireEvent.change(title, { target: { value: '   ' } });
    fireEvent.blur(title);
    fireEvent.change(content, { target: { value: '\n  ' } });
    fireEvent.blur(content);

    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(content.getAttribute('aria-invalid')).toBe('true');

    fillValidForm();

    expect(submit.disabled).toBe(false);
    expect((screen.getByLabelText(/^Summary/) as HTMLInputElement).value).toBe('');
  });

  it('creates a trimmed manual bubble directly in the ungrouped territory', async () => {
    const requestCreate = vi.fn().mockResolvedValue(createdBubble);
    const onCreated = vi.fn();

    render(
      <CreateBubbleDialog
        onCancel={vi.fn()}
        onCreated={onCreated}
        projectId="project-1"
        requestCreate={requestCreate}
      />,
    );

    fillValidForm();
    fireEvent.change(screen.getByLabelText(/^Summary/), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create bubble' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(createdBubble));
    expect(requestCreate).toHaveBeenCalledWith('project-1', {
      title: 'Break-even point',
      summary: null,
      content: 'Routes clear contribution margin above 40% utilization.',
      destination: { kind: 'ungrouped' },
    });
  });

  it('creates in an existing territory or a new viewport-centered territory', async () => {
    const requestCreate = vi.fn().mockResolvedValue(createdBubble);

    const { unmount } = render(
      <CreateBubbleDialog
        getTerritoryCreationPlacement={() => ({
          position_x: 120,
          position_y: -40,
        })}
        onCancel={vi.fn()}
        onCreated={vi.fn()}
        projectId="project-1"
        requestCreate={requestCreate}
        territories={[existingTerritory]}
      />,
    );

    fillValidForm();
    fireEvent.click(
      screen.getByRole('radio', { name: /Pricing research/ }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create bubble' }));

    await waitFor(() => expect(requestCreate).toHaveBeenCalledTimes(1));
    expect(requestCreate).toHaveBeenLastCalledWith(
      'project-1',
      expect.objectContaining({
        destination: {
          kind: 'existing',
          territory_id: existingTerritory.id,
        },
      }),
    );

    unmount();
    requestCreate.mockClear();

    render(
      <CreateBubbleDialog
        getTerritoryCreationPlacement={() => ({
          position_x: 120,
          position_y: -40,
        })}
        onCancel={vi.fn()}
        onCreated={vi.fn()}
        projectId="project-1"
        requestCreate={requestCreate}
        territories={[existingTerritory]}
      />,
    );

    fillValidForm();
    fireEvent.click(screen.getByRole('radio', { name: /New territory/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create bubble' }));

    expect(screen.getByText('Enter a territory title.')).not.toBeNull();
    expect(requestCreate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('New territory title'), {
      target: { value: 'x'.repeat(TERRITORY_TITLE_MAX_LENGTH + 1) },
    });
    expect(
      screen.getByText(
        `Use ${TERRITORY_TITLE_MAX_LENGTH} characters or fewer.`,
      ),
    ).not.toBeNull();

    fireEvent.change(screen.getByLabelText('New territory title'), {
      target: { value: '  Unit economics  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create bubble' }));

    await waitFor(() => expect(requestCreate).toHaveBeenCalledTimes(1));
    expect(requestCreate).toHaveBeenLastCalledWith(
      'project-1',
      expect.objectContaining({
        destination: {
          kind: 'new',
          position_x: 120,
          position_y: -40,
          title: 'Unit economics',
        },
      }),
    );
  });

  it('preserves every field after a recoverable save failure and retries', async () => {
    const requestCreate = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce({ ...createdBubble, summary: 'A concise summary.' });
    const onCreated = vi.fn();

    render(
      <CreateBubbleDialog
        onCancel={vi.fn()}
        onCreated={onCreated}
        projectId="project-1"
        requestCreate={requestCreate}
      />,
    );

    fillValidForm();
    fireEvent.change(screen.getByLabelText(/^Summary/), {
      target: { value: '  A concise summary.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create bubble' }));

    await screen.findByRole('alert');

    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe(
      '  Break-even point  ',
    );
    expect((screen.getByLabelText(/^Summary/) as HTMLInputElement).value).toBe(
      '  A concise summary.  ',
    );
    expect((screen.getByLabelText(/^Content/) as HTMLTextAreaElement).value).toContain(
      '  Routes clear contribution margin',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(requestCreate).toHaveBeenCalledTimes(2);
    expect(requestCreate).toHaveBeenLastCalledWith(
      'project-1',
      expect.objectContaining({ summary: 'A concise summary.' }),
    );
  });

  it('blocks cancellation and duplicate submissions while creation is pending', () => {
    const requestCreate = vi.fn(
      () => new Promise<Bubble>(() => undefined),
    );
    const onCancel = vi.fn();

    render(
      <CreateBubbleDialog
        onCancel={onCancel}
        onCreated={vi.fn()}
        projectId="project-1"
        requestCreate={requestCreate}
      />,
    );

    fillValidForm();
    const submit = screen.getByRole('button', { name: 'Create bubble' });
    const form = submit.closest('form');

    fireEvent.click(submit);
    fireEvent.submit(form!);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(requestCreate).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
  });
});

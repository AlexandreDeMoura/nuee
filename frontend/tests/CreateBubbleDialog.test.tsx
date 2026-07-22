import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bubble } from '../src/api';
import { CreateBubbleDialog } from '../src/bubbles/CreateBubbleDialog';

const placementInput = {
  strategy: 'viewport' as const,
  viewport_x: -100,
  viewport_y: 50,
  viewport_width: 800,
  viewport_height: 600,
};

const createdBubble: Bubble = {
  id: 'bubble-created',
  project_id: 'project-1',
  title: 'Break-even point',
  summary: null,
  content: 'Routes clear contribution margin above 40% utilization.',
  position_x: 176,
  position_y: 273,
  created_at: '2026-07-22T08:00:00.000Z',
  updated_at: '2026-07-22T08:00:00.000Z',
  source_kind: 'manual',
  source_discussion_id: null,
  source_message_ids: [],
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
  it('requires non-whitespace title and content while keeping summary optional', () => {
    render(
      <CreateBubbleDialog
        onCancel={vi.fn()}
        onCreated={vi.fn()}
        placementInput={placementInput}
        projectId="project-1"
        requestCreate={vi.fn()}
        requestPlacement={vi.fn()}
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

  it('requests placement before creating a trimmed manual bubble', async () => {
    const requestPlacement = vi.fn().mockResolvedValue({
      position_x: 176,
      position_y: 273,
    });
    const requestCreate = vi.fn().mockResolvedValue(createdBubble);
    const onCreated = vi.fn();

    render(
      <CreateBubbleDialog
        onCancel={vi.fn()}
        onCreated={onCreated}
        placementInput={placementInput}
        projectId="project-1"
        requestCreate={requestCreate}
        requestPlacement={requestPlacement}
      />,
    );

    fillValidForm();
    fireEvent.change(screen.getByLabelText(/^Summary/), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create bubble' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(createdBubble));
    expect(requestPlacement).toHaveBeenCalledWith('project-1', placementInput);
    expect(requestCreate).toHaveBeenCalledWith('project-1', {
      title: 'Break-even point',
      summary: null,
      content: 'Routes clear contribution margin above 40% utilization.',
      position_x: 176,
      position_y: 273,
    });
  });

  it('preserves every field after a recoverable save failure and retries', async () => {
    const requestPlacement = vi.fn().mockResolvedValue({
      position_x: 176,
      position_y: 273,
    });
    const requestCreate = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce({ ...createdBubble, summary: 'A concise summary.' });
    const onCreated = vi.fn();

    render(
      <CreateBubbleDialog
        onCancel={vi.fn()}
        onCreated={onCreated}
        placementInput={placementInput}
        projectId="project-1"
        requestCreate={requestCreate}
        requestPlacement={requestPlacement}
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
    const requestPlacement = vi.fn(
      () => new Promise<{ position_x: number; position_y: number }>(() => undefined),
    );
    const onCancel = vi.fn();

    render(
      <CreateBubbleDialog
        onCancel={onCancel}
        onCreated={vi.fn()}
        placementInput={placementInput}
        projectId="project-1"
        requestCreate={vi.fn()}
        requestPlacement={requestPlacement}
      />,
    );

    fillValidForm();
    const submit = screen.getByRole('button', { name: 'Create bubble' });
    const form = submit.closest('form');

    fireEvent.click(submit);
    fireEvent.submit(form!);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(requestPlacement).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
  });
});

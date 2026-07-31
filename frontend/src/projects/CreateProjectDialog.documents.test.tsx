import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { documentUploadPolicyFixture } from '../documents/documentTestFixtures';
import { CreateProjectDialog } from './CreateProjectDialog';

afterEach(cleanup);

describe('CreateProjectDialog document handoff', () => {
  it('creates the project before handing optional files to the document library', async () => {
    const order: string[] = [];
    const selected = new File(['optional source'], 'optional.md', {
      type: 'text/markdown',
    });
    const project = {
      id: 'project-created',
      title: 'Created project',
      description: 'Created before optional uploads.',
      created_at: '2026-07-31T10:00:00.000Z',
      updated_at: '2026-07-31T10:00:00.000Z',
      canvas_viewport_x: 0,
      canvas_viewport_y: 0,
      canvas_zoom: 1,
    };
    const requestCreate = vi.fn(async () => {
      order.push('project-created');
      return project;
    });
    const onCreated = vi.fn(() => order.push('files-handed-off'));

    render(
      <CreateProjectDialog
        onCancel={vi.fn()}
        onCreated={onCreated}
        requestCreate={requestCreate}
        requestDocumentPolicy={async () => documentUploadPolicyFixture}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByLabelText<HTMLInputElement>(/Documents/).disabled,
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText(/Documents/), {
      target: { files: [selected] },
    });
    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: project.title },
    });
    fireEvent.change(screen.getByLabelText(/Short description/), {
      target: { value: project.description },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(project, [selected]));
    expect(order).toEqual(['project-created', 'files-handed-off']);
  });
});

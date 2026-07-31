import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { documentUploadPolicyFixture } from '../documents/documentTestFixtures';
import { ProjectWorkspace } from './ProjectWorkspace';

afterEach(cleanup);

describe('ProjectWorkspace optional document uploads', () => {
  it('keeps the created project usable and exposes an optional upload failure', async () => {
    const project = {
      id: 'project-created',
      title: 'Created project',
      description: 'The project survives an optional document failure.',
      created_at: '2026-07-31T10:00:00.000Z',
      updated_at: '2026-07-31T10:00:00.000Z',
      canvas_viewport_x: 0,
      canvas_viewport_y: 0,
      canvas_zoom: 1,
    };
    const upload = vi.fn(async () => {
      throw new Error('Optional upload failed.');
    });

    render(
      <ProjectWorkspace
        documentLibraryRequests={{
          list: async () => [],
          policy: async () => documentUploadPolicyFixture,
          upload,
        }}
        initialDocumentUploads={[
          new File(['source'], 'optional.txt', { type: 'text/plain' }),
        ]}
        onInitialDocumentUploadsStarted={vi.fn()}
        project={project}
        requestBubbleLinks={async () => []}
        requestBubbles={async () => []}
      />,
    );

    await waitFor(() => {
      expect(upload).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('alert').textContent).toContain(
        'Optional upload failed.',
      );
    });
    expect(screen.getByText(project.title)).not.toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Retry upload' })
        .disabled,
    ).toBe(false);
  });
});

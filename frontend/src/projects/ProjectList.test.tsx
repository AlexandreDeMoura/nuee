import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../api';
import { ProjectList } from './ProjectList';

afterEach(cleanup);

function projectFixture(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-one',
    title: 'Launch plan',
    description: 'Explore the launch constraints.',
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
    canvas_viewport_x: 0,
    canvas_viewport_y: 0,
    canvas_zoom: 1,
    ...overrides,
  };
}

describe('ProjectList', () => {
  it('gives every card a distinctly labelled delete control', () => {
    const onDeleteProject = vi.fn();
    const second = projectFixture({ id: 'project-two', title: 'Hiring plan' });

    render(
      <ProjectList
        onDeleteProject={onDeleteProject}
        projects={[projectFixture(), second]}
      />,
    );

    expect(screen.getAllByRole('button', { name: /^Delete / })).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Hiring plan' }));

    expect(onDeleteProject).toHaveBeenCalledWith(second);
  });

  it('keeps the delete control outside the row link so it never navigates', () => {
    const onDeleteProject = vi.fn();

    render(
      <ProjectList onDeleteProject={onDeleteProject} projects={[projectFixture()]} />,
    );

    const deleteButton = screen.getByRole('button', { name: 'Delete Launch plan' });
    expect(deleteButton.closest('a')).toBeNull();

    const link = screen.getByRole('link', { name: /Launch plan/ });
    expect(link.getAttribute('href')).toBe('/projects/project-one');
    expect(link.contains(deleteButton)).toBe(false);
  });

  it('escapes the project id in the row link', () => {
    render(
      <ProjectList
        onDeleteProject={vi.fn()}
        projects={[projectFixture({ id: 'a/b?c' })]}
      />,
    );

    expect(
      screen.getByRole('link', { name: /Launch plan/ }).getAttribute('href'),
    ).toBe('/projects/a%2Fb%3Fc');
  });
});

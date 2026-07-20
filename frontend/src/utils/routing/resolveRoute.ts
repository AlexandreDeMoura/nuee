export type AppRoute =
  | { name: 'project-entry' }
  | { name: 'project-canvas'; projectId: string }
  | { name: 'not-found' };

export function resolveRoute(pathname: string): AppRoute {
  if (pathname === '/' || pathname === '/projects' || pathname === '/projects/') {
    return { name: 'project-entry' };
  }

  const projectMatch = pathname.match(/^\/projects\/([^/]+)\/?$/);

  if (projectMatch) {
    try {
      return {
        name: 'project-canvas',
        projectId: decodeURIComponent(projectMatch[1]),
      };
    } catch {
      return { name: 'not-found' };
    }
  }

  return { name: 'not-found' };
}

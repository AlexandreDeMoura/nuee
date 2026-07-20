import { useEffect, useState, type MouseEvent } from 'react';
import { getProjects, type Project } from './api';

type AppRoute =
  | { name: 'project-entry' }
  | { name: 'project-canvas'; projectId: string }
  | { name: 'not-found' };

function resolveRoute(pathname: string): AppRoute {
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

function navigate(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  event.preventDefault();
  window.history.pushState({}, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function Logo() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span className="brand-mark__cloud" />
    </span>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ProjectIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="7.5" opacity=".55" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="project-row__chevron" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 5v6h-6" />
    </svg>
  );
}

function AppHeader() {
  return (
    <header className="app-header">
      <a className="brand" href="/" onClick={(event) => navigate(event, '/')}>
        <Logo />
        <span>Nuée</span>
      </a>

      <button className="primary-button" type="button" aria-haspopup="dialog">
        <PlusIcon />
        New project
      </button>
    </header>
  );
}

function formatUpdatedAt(updatedAt: string, now = new Date()): string {
  const timestamp = new Date(updatedAt).getTime();

  if (!Number.isFinite(timestamp)) {
    return 'Recently';
  }

  const elapsedMilliseconds = Math.max(0, now.getTime() - timestamp);
  const elapsedMinutes = Math.floor(elapsedMilliseconds / 60_000);

  if (elapsedMinutes < 1) {
    return 'Just now';
  }

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);

  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);

  if (elapsedDays < 14) {
    return `${elapsedDays}d ago`;
  }

  const elapsedWeeks = Math.floor(elapsedDays / 7);

  if (elapsedDays < 60) {
    return `${elapsedWeeks}w ago`;
  }

  const elapsedMonths = Math.floor(elapsedDays / 30);

  if (elapsedDays < 730) {
    return `${elapsedMonths}mo ago`;
  }

  return `${Math.floor(elapsedDays / 365)}y ago`;
}

function LoadingProjects() {
  return (
    <div className="project-list project-list--loading" role="status" aria-label="Loading projects">
      {[0, 1, 2].map((item) => (
        <div className="project-skeleton" key={item} aria-hidden="true">
          <span className="project-skeleton__icon" />
          <span className="project-skeleton__copy">
            <span className="project-skeleton__title" />
            <span className="project-skeleton__description" />
          </span>
          <span className="project-skeleton__date" />
        </div>
      ))}
      <span className="sr-only">Loading your projects…</span>
    </div>
  );
}

function EmptyProjects() {
  return (
    <section className="empty-state" aria-labelledby="empty-projects-title">
      <span className="empty-state__icon">
        <ProjectIcon />
      </span>
      <h2 id="empty-projects-title">Create your first project</h2>
      <p>Start with a title and short description. Your canvas will begin empty and ready for your ideas.</p>
      <button className="secondary-button" type="button" aria-haspopup="dialog">
        <PlusIcon />
        New project
      </button>
    </section>
  );
}

function ProjectsError({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="error-state" aria-labelledby="projects-error-title">
      <span className="error-state__icon">
        <InfoIcon />
      </span>
      <h2 id="projects-error-title">We couldn’t load your projects</h2>
      <p>Your projects are still safe. Check your connection and try again.</p>
      <button className="secondary-button" type="button" onClick={onRetry}>
        <RetryIcon />
        Try again
      </button>
    </section>
  );
}

function ProjectList({ projects }: { projects: Project[] }) {
  return (
    <div className="project-list">
      {projects.map((project, index) => {
        const href = `/projects/${encodeURIComponent(project.id)}`;

        return (
          <a
            className="project-row"
            href={href}
            onClick={(event) => navigate(event, href)}
            key={project.id}
          >
            <span className={`project-row__icon${index === 0 ? ' project-row__icon--recent' : ''}`}>
              <ProjectIcon />
            </span>
            <span className="project-row__copy">
              <span className="project-row__title">{project.title}</span>
              <span className="project-row__description">{project.description}</span>
            </span>
            <time className="project-row__updated" dateTime={project.updated_at}>
              {formatUpdatedAt(project.updated_at)}
            </time>
            <ChevronIcon />
          </a>
        );
      })}
    </div>
  );
}

function ProjectEntry() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [hasError, setHasError] = useState(false);
  const [requestKey, setRequestKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    getProjects(controller.signal)
      .then(setProjects)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        setHasError(true);
      });

    return () => controller.abort();
  }, [requestKey]);

  const retry = () => {
    setProjects(null);
    setHasError(false);
    setRequestKey((key) => key + 1);
  };

  return (
    <main className="entry-page">
      <AppHeader />

      <section className="entry-content" aria-labelledby="projects-heading">
        <div className="section-heading">
          <div className="section-heading__title">
            <h1 id="projects-heading">Your projects</h1>
            {projects && <span className="project-count">{projects.length}</span>}
          </div>
          <span className="section-heading__order">Recently updated</span>
        </div>

        {!projects && !hasError && <LoadingProjects />}
        {hasError && <ProjectsError onRetry={retry} />}
        {projects?.length === 0 && <EmptyProjects />}
        {projects && projects.length > 0 && <ProjectList projects={projects} />}

        {!hasError && projects && projects.length > 0 && (
          <p className="canvas-note">
            <InfoIcon />
            Opening a project always lands on its canvas — never a past discussion.
          </p>
        )}
      </section>
    </main>
  );
}

function ProjectCanvasRoute({ projectId }: { projectId: string }) {
  return (
    <main className="route-placeholder">
      <header className="app-header">
        <a className="brand" href="/" onClick={(event) => navigate(event, '/')}>
          <Logo />
          <span>Nuée</span>
        </a>
        <a className="back-link" href="/" onClick={(event) => navigate(event, '/')}>
          Projects
        </a>
      </header>
      <section className="route-placeholder__content" data-project-id={projectId}>
        <span className="route-placeholder__icon">
          <ProjectIcon />
        </span>
        <h1>Project canvas</h1>
      </section>
    </main>
  );
}

function NotFoundRoute() {
  return (
    <main className="route-placeholder">
      <AppHeader />
      <section className="route-placeholder__content">
        <h1>Page not found</h1>
        <a className="secondary-button" href="/" onClick={(event) => navigate(event, '/')}>
          Back to projects
        </a>
      </section>
    </main>
  );
}

function App() {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const updatePathname = () => setPathname(window.location.pathname);

    window.addEventListener('popstate', updatePathname);
    return () => window.removeEventListener('popstate', updatePathname);
  }, []);

  const route = resolveRoute(pathname);

  if (route.name === 'project-entry') {
    return <ProjectEntry />;
  }

  if (route.name === 'project-canvas') {
    return <ProjectCanvasRoute projectId={route.projectId} />;
  }

  return <NotFoundRoute />;
}

export default App;

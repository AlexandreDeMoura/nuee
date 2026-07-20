import { useEffect, useState, type MouseEvent } from 'react';
import { ChevronRight, CircleAlert, CircleDot, Plus, RotateCcw } from 'lucide-react';
import { getProjects, type Project } from './api';

type AppRoute =
  | { name: 'project-entry' }
  | { name: 'project-canvas'; projectId: string }
  | { name: 'not-found' };

const focusRing =
  '[-webkit-tap-highlight-color:transparent] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/30';
const pageClasses =
  "min-h-screen min-w-80 bg-[#f4f6f9] text-[#1e2733] [font-family:'IBM_Plex_Sans',system-ui,sans-serif] [font-synthesis:none] [text-rendering:optimizeLegibility]";
const headerClasses =
  'flex h-14 items-center gap-3 border-b border-[#e1e6ec] bg-white px-4 sm:px-[22px]';
const brandClasses =
  `inline-flex items-center gap-[11px] text-[15px] font-semibold tracking-[-0.2px] text-[#1e2733] no-underline ${focusRing}`;
const primaryButtonClasses =
  `ml-auto inline-flex min-h-9 cursor-pointer items-center justify-center gap-[7px] rounded-[9px] bg-[#3f63a8] px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(63,99,168,0.7)] transition-[background-color,border-color,box-shadow,transform] duration-150 hover:bg-[#33538f] motion-reduce:transition-none ${focusRing}`;
const secondaryButtonClasses =
  `inline-flex min-h-9 cursor-pointer items-center justify-center gap-[7px] rounded-[9px] border border-[#cdd8ea] bg-[#f6f8fc] px-3.5 py-2 text-[12.5px] font-semibold text-[#33538f] no-underline transition-[background-color,border-color,box-shadow,transform] duration-150 hover:border-[#aebed8] hover:bg-[#eef2fa] motion-reduce:transition-none ${focusRing}`;
const statePanelClasses =
  'flex min-h-[290px] flex-col items-center justify-center rounded-xl border border-[#e1e6ec] bg-white px-6 py-11 text-center';

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
    <span
      className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-[#3f63a8]"
      aria-hidden="true"
    >
      <span className="size-[9px] rounded-full bg-white/90" />
    </span>
  );
}

function AppHeader() {
  return (
    <header className={headerClasses}>
      <a className={brandClasses} href="/" onClick={(event) => navigate(event, '/')}>
        <Logo />
        <span>Nuée</span>
      </a>

      <button className={primaryButtonClasses} type="button" aria-haspopup="dialog">
        <Plus className="size-[15px]" strokeWidth={2} aria-hidden="true" />
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
  const skeletonClasses = 'block animate-pulse bg-[#eef1f5] motion-reduce:animate-none';

  return (
    <div
      className="min-h-[203px] overflow-hidden rounded-xl border border-[#e1e6ec] bg-white"
      role="status"
      aria-label="Loading projects"
    >
      {[0, 1, 2].map((item) => (
        <div
          className="flex min-h-[67px] items-center gap-3.5 border-b border-[#eef1f5] px-4 py-[15px] last:border-b-0"
          key={item}
          aria-hidden="true"
        >
          <span className={`${skeletonClasses} size-9 shrink-0 rounded-[9px]`} />
          <span className="flex flex-1 flex-col gap-[7px]">
            <span className={`${skeletonClasses} h-[11px] w-[min(44%,260px)] rounded-md`} />
            <span className={`${skeletonClasses} h-[9px] w-[min(62%,360px)] rounded-md`} />
          </span>
          <span className={`${skeletonClasses} h-[9px] w-[46px] shrink-0 rounded-md`} />
        </div>
      ))}
      <span className="sr-only">Loading your projects…</span>
    </div>
  );
}

function EmptyProjects() {
  return (
    <section className={statePanelClasses} aria-labelledby="empty-projects-title">
      <span className="mb-3.5 grid size-[42px] place-items-center rounded-[11px] bg-[#eef2fa] text-[#3f63a8]">
        <CircleDot className="size-[18px]" strokeWidth={1.7} aria-hidden="true" />
      </span>
      <h2 className="m-0 text-[15px] font-semibold text-[#1e2733]" id="empty-projects-title">
        Create your first project
      </h2>
      <p className="mt-[7px] mb-[18px] max-w-[390px] text-xs leading-[1.55] text-[#7b8899]">
        Start with a title and short description. Your canvas will begin empty and ready for your ideas.
      </p>
      <button className={secondaryButtonClasses} type="button" aria-haspopup="dialog">
        <Plus className="size-[15px]" strokeWidth={2} aria-hidden="true" />
        New project
      </button>
    </section>
  );
}

function ProjectsError({ onRetry }: { onRetry: () => void }) {
  return (
    <section className={statePanelClasses} aria-labelledby="projects-error-title">
      <span className="mb-3.5 grid size-[42px] place-items-center rounded-[11px] bg-[#f9eeee] text-[#a95f57]">
        <CircleAlert className="size-[13px]" strokeWidth={1.7} aria-hidden="true" />
      </span>
      <h2 className="m-0 text-[15px] font-semibold text-[#1e2733]" id="projects-error-title">
        We couldn’t load your projects
      </h2>
      <p className="mt-[7px] mb-[18px] max-w-[390px] text-xs leading-[1.55] text-[#7b8899]">
        Your projects are still safe. Check your connection and try again.
      </p>
      <button className={secondaryButtonClasses} type="button" onClick={onRetry}>
        <RotateCcw className="size-[15px]" strokeWidth={1.8} aria-hidden="true" />
        Try again
      </button>
    </section>
  );
}

function ProjectList({ projects }: { projects: Project[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#e1e6ec] bg-white">
      {projects.map((project, index) => {
        const href = `/projects/${encodeURIComponent(project.id)}`;

        return (
          <a
            className={`group flex min-h-[67px] items-center gap-2.5 border-b border-[#eef1f5] px-3 py-3.5 text-inherit no-underline transition-colors duration-150 last:border-b-0 hover:bg-[#f6f8fc] motion-reduce:transition-none sm:gap-3.5 sm:px-4 sm:py-[15px] ${focusRing}`}
            href={href}
            onClick={(event) => navigate(event, href)}
            key={project.id}
          >
            <span
              className={`grid size-8 shrink-0 place-items-center rounded-[9px] sm:size-9 ${
                index === 0 ? 'bg-[#eef2fa] text-[#3f63a8]' : 'bg-[#eef1f5] text-[#7b8899]'
              }`}
            >
              <CircleDot className="size-[18px]" strokeWidth={1.7} aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[13.5px] font-semibold text-[#1e2733]">
                {project.title}
              </span>
              <span className="truncate text-[11.5px] text-[#8b97a6]">{project.description}</span>
            </span>
            <time
              className="hidden shrink-0 text-[10.5px] font-medium text-[#9aa6b4] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] sm:block"
              dateTime={project.updated_at}
            >
              {formatUpdatedAt(project.updated_at)}
            </time>
            <ChevronRight
              className="size-[13px] shrink-0 text-[#c4cdd8] opacity-50 transition-[opacity,transform] duration-150 group-hover:translate-x-0.5 group-hover:opacity-100 motion-reduce:transition-none sm:size-[15px]"
              strokeWidth={1.8}
              aria-hidden="true"
            />
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
    <main className={pageClasses}>
      <AppHeader />

      <section
        className="mx-auto w-full max-w-[940px] px-4 py-6 sm:p-[30px]"
        aria-labelledby="projects-heading"
      >
        <div className="mb-4 flex items-baseline gap-[9px]">
          <div className="flex items-baseline gap-[9px]">
            <h1 className="m-0 text-[12.5px] font-semibold" id="projects-heading">
              Your projects
            </h1>
            {projects && (
              <span className="rounded-[5px] bg-[#eef1f5] px-1.5 py-0.5 text-[10px] font-medium text-[#9aa6b4] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
                {projects.length}
              </span>
            )}
          </div>
          <span className="ml-auto text-[10px] font-medium tracking-[0.04em] text-[#9aa6b4] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
            Recently updated
          </span>
        </div>

        {!projects && !hasError && <LoadingProjects />}
        {hasError && <ProjectsError onRetry={retry} />}
        {projects?.length === 0 && <EmptyProjects />}
        {projects && projects.length > 0 && <ProjectList projects={projects} />}

        {!hasError && projects && projects.length > 0 && (
          <p className="mt-3.5 flex items-start gap-1.5 text-[11px] leading-[1.5] text-[#9aa6b4] sm:items-center">
            <CircleAlert className="size-[13px] shrink-0" strokeWidth={1.7} aria-hidden="true" />
            Opening a project always lands on its canvas — never a past discussion.
          </p>
        )}
      </section>
    </main>
  );
}

function ProjectCanvasRoute({ projectId }: { projectId: string }) {
  return (
    <main className={pageClasses}>
      <header className={headerClasses}>
        <a className={brandClasses} href="/" onClick={(event) => navigate(event, '/')}>
          <Logo />
          <span>Nuée</span>
        </a>
        <a
          className={`ml-auto text-[12.5px] text-[#5c6a7a] no-underline hover:text-[#33538f] ${focusRing}`}
          href="/"
          onClick={(event) => navigate(event, '/')}
        >
          Projects
        </a>
      </header>
      <section
        className="flex min-h-[calc(100vh-56px)] flex-col items-center justify-center p-[30px]"
        data-project-id={projectId}
      >
        <span className="mb-3.5 grid size-[42px] place-items-center rounded-[11px] bg-[#eef2fa] text-[#3f63a8]">
          <CircleDot className="size-[18px]" strokeWidth={1.7} aria-hidden="true" />
        </span>
        <h1 className="m-0 text-[15px] font-semibold text-[#1e2733]">Project canvas</h1>
      </section>
    </main>
  );
}

function NotFoundRoute() {
  return (
    <main className={pageClasses}>
      <AppHeader />
      <section className="flex min-h-[calc(100vh-56px)] flex-col items-center justify-center p-[30px]">
        <h1 className="m-0 text-[15px] font-semibold text-[#1e2733]">Page not found</h1>
        <a
          className={`${secondaryButtonClasses} mt-4`}
          href="/"
          onClick={(event) => navigate(event, '/')}
        >
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

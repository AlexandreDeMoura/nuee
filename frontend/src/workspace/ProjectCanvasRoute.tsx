import { useEffect, useState } from 'react';
import { CircleAlert, CircleDot, RotateCcw } from 'lucide-react';
import { ApiError, getProject, type Project } from '../api';
import { navigate } from '../utils/routing';
import { ProjectWorkspace } from './ProjectWorkspace';

type ProjectRequest = (projectId: string, signal?: AbortSignal) => Promise<Project>;

export interface ProjectCanvasRouteProps {
  projectId: string;
  requestProject?: ProjectRequest;
}

type ProjectLoadState =
  | { status: 'loading' }
  | { status: 'ready'; project: Project }
  | { status: 'failed' }
  | { status: 'missing' };

const focusRing =
  '[-webkit-tap-highlight-color:transparent] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/30';
const buttonClasses =
  `inline-flex min-h-9 cursor-pointer items-center justify-center gap-[7px] rounded-[9px] border border-[#cdd8ea] bg-[#f6f8fc] px-3.5 py-2 text-[12.5px] font-semibold text-[#33538f] no-underline hover:border-[#aebed8] hover:bg-[#eef2fa] ${focusRing}`;

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

function ProjectRouteState({
  status,
  onRetry,
}: {
  status: Exclude<ProjectLoadState['status'], 'ready'>;
  onRetry?: () => void;
}) {
  const isLoading = status === 'loading';
  const isMissing = status === 'missing';

  return (
    <main className="min-h-screen min-w-80 bg-[#f4f6f9] text-[#1e2733] [font-family:'IBM_Plex_Sans',system-ui,sans-serif]">
      <header className="flex h-14 items-center gap-3 border-b border-[#e1e6ec] bg-white px-4 sm:px-[22px]">
        <a
          className={`inline-flex items-center gap-[11px] text-[15px] font-semibold tracking-[-0.2px] text-[#1e2733] no-underline ${focusRing}`}
          href="/"
          onClick={(event) => navigate(event, '/')}
        >
          <Logo />
          <span>Nuée</span>
        </a>
      </header>

      <section
        className="flex min-h-[calc(100vh-56px)] flex-col items-center justify-center px-6 py-10 text-center"
        aria-live="polite"
      >
        <span
          className={`mb-3.5 grid size-[42px] place-items-center rounded-[11px] ${
            status === 'failed' ? 'bg-[#f9eeee] text-[#a95f57]' : 'bg-[#eef2fa] text-[#3f63a8]'
          }`}
        >
          {status === 'failed' ? (
            <CircleAlert className="size-[17px]" strokeWidth={1.7} aria-hidden="true" />
          ) : (
            <CircleDot
              className={`size-[18px] ${isLoading ? 'animate-pulse motion-reduce:animate-none' : ''}`}
              strokeWidth={1.7}
              aria-hidden="true"
            />
          )}
        </span>
        <h1 className="m-0 text-[15px] font-semibold text-[#1e2733]">
          {isLoading
            ? 'Loading project…'
            : isMissing
              ? 'Project not found'
              : 'We couldn’t load this project'}
        </h1>
        {!isLoading && (
          <p className="mt-[7px] mb-[18px] max-w-[390px] text-xs leading-[1.55] text-[#7b8899]">
            {isMissing
              ? 'This project may have been removed, or the link may be incorrect.'
              : 'Check your connection and try again. Your project data is still safe.'}
          </p>
        )}
        {status === 'failed' && onRetry && (
          <button className={buttonClasses} type="button" onClick={onRetry}>
            <RotateCcw className="size-[15px]" strokeWidth={1.8} aria-hidden="true" />
            Try again
          </button>
        )}
        {isMissing && (
          <a className={buttonClasses} href="/" onClick={(event) => navigate(event, '/')}>
            Back to projects
          </a>
        )}
      </section>
    </main>
  );
}

export function ProjectCanvasRoute({
  projectId,
  requestProject = getProject,
}: ProjectCanvasRouteProps) {
  const [loadState, setLoadState] = useState<ProjectLoadState>({ status: 'loading' });
  const [requestKey, setRequestKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    requestProject(projectId, controller.signal)
      .then((project) => setLoadState({ status: 'ready', project }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        setLoadState(
          error instanceof ApiError && error.status === 404
            ? { status: 'missing' }
            : { status: 'failed' },
        );
      });

    return () => controller.abort();
  }, [projectId, requestKey, requestProject]);

  if (loadState.status === 'ready') {
    return <ProjectWorkspace project={loadState.project} />;
  }

  return (
    <ProjectRouteState
      status={loadState.status}
      onRetry={() => {
        setLoadState({ status: 'loading' });
        setRequestKey((key) => key + 1);
      }}
    />
  );
}

import { ChevronRight, CircleDot, Trash2 } from 'lucide-react';
import type { Project } from '../api';
import { focusRing } from '../ui/focusRing';
import { formatUpdatedAt } from '../utils/date';
import { navigate } from '../utils/routing';

export function ProjectList({
  onDeleteProject,
  projects,
}: {
  onDeleteProject: (project: Project) => void;
  projects: Project[];
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#e1e6ec] bg-white">
      {projects.map((project, index) => {
        const href = `/projects/${encodeURIComponent(project.id)}`;

        return (
          // The delete control is a sibling of the row link rather than a child:
          // a button nested in an anchor is invalid and swallows its own clicks.
          <div
            className="group flex items-center border-b border-[#eef1f5] transition-colors duration-150 last:border-b-0 hover:bg-[#f6f8fc] motion-reduce:transition-none"
            key={project.id}
          >
            <a
              className={`flex min-h-[67px] min-w-0 flex-1 items-center gap-2.5 py-3.5 pl-3 text-inherit no-underline sm:gap-3.5 sm:py-[15px] sm:pl-4 ${focusRing}`}
              href={href}
              onClick={(event) => navigate(event, href)}
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
            <button
              className={`mr-3 ml-2.5 grid size-8 shrink-0 cursor-pointer place-items-center rounded-[9px] text-[#c4cdd8] transition-colors duration-150 hover:bg-[#fbf1f0] hover:text-[#b4544e] motion-reduce:transition-none sm:mr-4 sm:ml-3.5 ${focusRing}`}
              type="button"
              aria-haspopup="dialog"
              aria-label={`Delete ${project.title}`}
              onClick={() => onDeleteProject(project)}
            >
              <Trash2 className="size-[15px]" strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

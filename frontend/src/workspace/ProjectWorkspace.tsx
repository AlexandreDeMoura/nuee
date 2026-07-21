import { useMemo, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ChevronLeft,
  CircleDot,
  CirclePlus,
  FileText,
  MessageSquare,
  Search,
  Upload,
} from 'lucide-react';
import type { Project } from '../api';
import {
  ProjectDescriptionEditor,
  type ProjectDescriptionSaveStatus,
  type ProjectDescriptionUpdateRequest,
} from '../projects/ProjectDescriptionEditor';
import { navigate } from '../utils/routing';
import { CurrentProjectDescriptionContext } from './currentProjectDescription';
import { getDefaultPanelView, type WorkspacePanelView } from './panelModel';

export type WorkspacePanelSlots = Partial<Record<WorkspacePanelView, ReactNode>>;

export interface ProjectWorkspaceProps {
  project: Project;
  discussionCount?: number;
  panelSlots?: WorkspacePanelSlots;
  primaryActions?: ReactNode;
  requestDescriptionUpdate?: ProjectDescriptionUpdateRequest;
  descriptionSaveDelayMs?: number;
}

interface PanelDefinition {
  view: WorkspacePanelView;
  label: string;
  icon: LucideIcon;
}

const focusRing =
  '[-webkit-tap-highlight-color:transparent] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/30';

const panelDefinitions: PanelDefinition[] = [
  { view: 'discussions', label: 'Discussions', icon: MessageSquare },
  { view: 'documents', label: 'Documents', icon: FileText },
  { view: 'project', label: 'Project', icon: CircleDot },
  { view: 'inspector', label: 'Inspector', icon: Search },
];

function Logo() {
  return (
    <span
      className="grid size-[22px] shrink-0 place-items-center rounded-md bg-[#3f63a8]"
      aria-hidden="true"
    >
      <span className="size-2 rounded-full bg-white/90" />
    </span>
  );
}

const projectBarStatus: Record<
  ProjectDescriptionSaveStatus,
  { label: string; dotClasses: string; textClasses: string }
> = {
  dirty: {
    label: 'UNSAVED',
    dotClasses: 'bg-[#c4904e]',
    textClasses: 'text-[#9a7a4d]',
  },
  saving: {
    label: 'SAVING',
    dotClasses: 'animate-pulse bg-[#6681b5] motion-reduce:animate-none',
    textClasses: 'text-[#7286ad]',
  },
  saved: {
    label: 'SAVED',
    dotClasses: 'bg-[#5c9a6b]',
    textClasses: 'text-[#8b97a6]',
  },
  error: {
    label: 'SAVE FAILED',
    dotClasses: 'bg-[#b4544e]',
    textClasses: 'text-[#b4544e]',
  },
};

function ProjectBar({
  project,
  descriptionStatus,
}: {
  project: Project;
  descriptionStatus: ProjectDescriptionSaveStatus;
}) {
  const status = projectBarStatus[descriptionStatus];

  return (
    <header className="flex h-[53px] shrink-0 items-center gap-3.5 border-b border-[#e1e6ec] bg-white px-[18px]">
      <a
        className={`inline-flex shrink-0 items-center gap-[7px] text-[12.5px] text-[#5c6a7a] no-underline hover:text-[#33538f] ${focusRing}`}
        href="/"
        onClick={(event) => navigate(event, '/')}
      >
        <ChevronLeft className="size-[15px]" strokeWidth={1.7} aria-hidden="true" />
        <span className="hidden sm:inline">Projects</span>
      </a>

      <span className="h-5 w-px shrink-0 bg-[#e1e6ec]" aria-hidden="true" />
      <Logo />
      <h1 className="min-w-0 shrink truncate text-[13.5px] font-semibold tracking-[-0.1px] text-[#1e2733]">
        {project.title}
      </h1>
      <p className="hidden min-w-0 max-w-[360px] truncate text-xs text-[#8b97a6] lg:block">
        {project.description}
      </p>

      <span
        className={`ml-auto inline-flex shrink-0 items-center gap-1.5 text-[10.5px] font-medium tracking-[0.04em] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${status.textClasses}`}
        aria-live="polite"
      >
        <span className={`size-1.5 rounded-full ${status.dotClasses}`} aria-hidden="true" />
        {status.label}
      </span>
    </header>
  );
}

interface ActionCardProps {
  description: string;
  icon: LucideIcon;
  label: string;
  meta: string;
  primary?: boolean;
}

function ActionCard({ description, icon: Icon, label, meta, primary = false }: ActionCardProps) {
  return (
    <div
      className={`min-h-[164px] rounded-[14px] border p-[18px] pb-4 text-left shadow-[0_1px_2px_rgba(30,39,51,0.04)] ${
        primary
          ? 'border-[#3f63a8] bg-[#3f63a8] text-white shadow-[0_8px_22px_-10px_rgba(63,99,168,0.7)]'
          : 'border-[#e1e6ec] bg-white text-[#1e2733]'
      }`}
      data-workspace-action={label}
    >
      <span
        className={`mb-3.5 grid size-8 place-items-center rounded-[9px] ${
          primary ? 'bg-white/15 text-white' : 'bg-[#eef2f7] text-[#3f63a8]'
        }`}
      >
        <Icon className="size-[17px]" strokeWidth={1.7} aria-hidden="true" />
      </span>
      <h3 className="mb-1 text-sm font-semibold">{label}</h3>
      <p className={`text-[11.5px] leading-[1.45] ${primary ? 'text-white/80' : 'text-[#5c6a7a]'}`}>
        {description}
      </p>
      <p
        className={`mt-3 text-[9.5px] font-medium tracking-[0.06em] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${
          primary ? 'text-white/60' : 'text-[#9aa6b4]'
        }`}
      >
        {meta}
      </p>
    </div>
  );
}

function EmptyProjectActions() {
  return (
    <div
      className="grid w-full max-w-[674px] grid-cols-1 gap-4 md:grid-cols-3"
      aria-label="Project starting points"
    >
      <ActionCard
        description="Ask a focused question. Answers stay short by default."
        icon={MessageSquare}
        label="Start a discussion"
        meta="RECOMMENDED · ⌘K"
        primary
      />
      <ActionCard
        description="Already know something? Add durable knowledge by hand."
        icon={CirclePlus}
        label="Create a bubble"
        meta="MANUAL"
      />
      <ActionCard
        description="Bring a source in. Select it whole as discussion context."
        icon={Upload}
        label="Upload a document"
        meta="PDF · TXT · MD"
      />
    </div>
  );
}

function EmptyCanvas({ primaryActions }: { primaryActions?: ReactNode }) {
  return (
    <section
      className="relative min-w-0 flex-1 overflow-y-auto bg-[#eef1f5] bg-[radial-gradient(#cdd6e0_1.1px,transparent_1.1px)] bg-[position:-1px_-1px] bg-[size:24px_24px]"
      aria-labelledby="empty-project-title"
    >
      <div className="flex min-h-full flex-col items-center justify-center px-6 py-10 text-center lg:px-10">
        <p className="mb-4 text-[10.5px] font-semibold tracking-[0.16em] text-[#9aa6b4] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
          EMPTY&nbsp;&nbsp;PROJECT
        </p>
        <h2
          className="mb-[9px] text-[27px] leading-tight font-semibold tracking-[-0.5px] text-[#1e2733]"
          id="empty-project-title"
        >
          Nothing here yet — that&apos;s on purpose.
        </h2>
        <p className="mb-[34px] max-w-[460px] text-sm leading-[1.55] text-[#5c6a7a]">
          Nuée won&apos;t fill this canvas with assumptions. Start a focused discussion, and approve
          what&apos;s worth keeping as a bubble.
        </p>
        {primaryActions ?? <EmptyProjectActions />}
      </div>
    </section>
  );
}

function IntegrationPlaceholder({ view }: { view: Exclude<WorkspacePanelView, 'project'> }) {
  const labels: Record<typeof view, string> = {
    discussions: 'Discussion content connects here.',
    documents: 'Document content connects here.',
    inspector: 'Inspector content connects here.',
  };

  return (
    <div className="flex flex-1 items-center justify-center px-7 text-center">
      <p className="max-w-[220px] text-xs leading-[1.55] text-[#8b97a6]">{labels[view]}</p>
    </div>
  );
}

function WorkspacePanel({
  activeView,
  discussionCount,
  panelSlots,
  project,
  onProjectSaved,
  onDescriptionStatusChange,
  requestDescriptionUpdate,
  descriptionSaveDelayMs,
}: {
  activeView: WorkspacePanelView;
  discussionCount: number;
  panelSlots?: WorkspacePanelSlots;
  project: Project;
  onProjectSaved: (project: Project) => void;
  onDescriptionStatusChange: (status: ProjectDescriptionSaveStatus) => void;
  requestDescriptionUpdate?: ProjectDescriptionUpdateRequest;
  descriptionSaveDelayMs?: number;
}) {
  const activeDefinition = panelDefinitions.find(({ view }) => view === activeView)!;
  const slottedContent = panelSlots?.[activeView];
  const hasDefaultProjectEditor = panelSlots?.project === undefined;

  return (
    <section
      className="flex w-[min(336px,calc(100vw-52px))] shrink-0 flex-col border-l border-[#e1e6ec] bg-white sm:w-[336px]"
      aria-label={`${activeDefinition.label} panel`}
    >
      <header className="flex min-h-[50px] items-center gap-2 border-b border-[#eef1f5] px-[18px] py-[13px]">
        <h2 className="text-sm font-semibold text-[#1e2733]">{activeDefinition.label}</h2>
        {activeView === 'discussions' && (
          <span className="rounded-[5px] bg-[#f2f5f9] px-1.5 py-0.5 text-[10px] font-medium text-[#9aa6b4] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
            {discussionCount}
          </span>
        )}
      </header>
      {hasDefaultProjectEditor && (
        <div
          className={activeView === 'project' ? 'contents' : 'hidden'}
          aria-hidden={activeView === 'project' ? undefined : true}
        >
          <ProjectDescriptionEditor
            key={project.id}
            project={project}
            onProjectSaved={onProjectSaved}
            onStatusChange={onDescriptionStatusChange}
            requestUpdate={requestDescriptionUpdate}
            saveDelayMs={descriptionSaveDelayMs}
          />
        </div>
      )}
      {activeView === 'project' && !hasDefaultProjectEditor && slottedContent}
      {activeView !== 'project' &&
        (slottedContent !== undefined ? (
          slottedContent
        ) : (
          <IntegrationPlaceholder view={activeView} />
        ))}
    </section>
  );
}

export function ProjectWorkspace({
  project,
  discussionCount = 0,
  panelSlots,
  primaryActions,
  requestDescriptionUpdate,
  descriptionSaveDelayMs,
}: ProjectWorkspaceProps) {
  const [currentProject, setCurrentProject] = useState(project);
  const [descriptionStatus, setDescriptionStatus] =
    useState<ProjectDescriptionSaveStatus>('saved');
  const [activePanel, setActivePanel] = useState<WorkspacePanelView>(() =>
    getDefaultPanelView(discussionCount),
  );

  const currentDescription = useMemo(
    () =>
      Object.freeze({
        projectId: currentProject.id,
        currentDescription: currentProject.description,
      }),
    [currentProject.description, currentProject.id],
  );

  return (
    <CurrentProjectDescriptionContext.Provider value={currentDescription}>
      <main
        className="flex h-screen min-h-[480px] min-w-80 flex-col overflow-hidden bg-[#eef1f5] text-[#1e2733] [font-family:'IBM_Plex_Sans',system-ui,sans-serif] [font-synthesis:none] [text-rendering:optimizeLegibility]"
        data-project-id={currentProject.id}
      >
        <ProjectBar project={currentProject} descriptionStatus={descriptionStatus} />

        <div className="relative flex min-h-0 flex-1">
          <EmptyCanvas primaryActions={primaryActions} />

          <aside className="flex shrink-0 bg-white" aria-label="Project tools">
            <nav
              className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-l border-[#e1e6ec] bg-white pt-3"
              aria-label="Workspace panels"
            >
              {panelDefinitions.map(({ view, label, icon: Icon }) => {
                const isActive = activePanel === view;

                return (
                  <button
                    className={`relative grid size-[38px] cursor-pointer place-items-center rounded-[10px] transition-colors duration-150 motion-reduce:transition-none ${
                      isActive
                        ? 'bg-[#eef2fa] text-[#3f63a8]'
                        : 'bg-transparent text-[#8b97a6] hover:bg-[#f6f8fc] hover:text-[#5c6a7a]'
                    } ${focusRing}`}
                    type="button"
                    aria-label={label}
                    aria-pressed={isActive}
                    title={label}
                    onClick={() => setActivePanel(view)}
                    key={view}
                  >
                    {isActive && (
                      <span
                        className="absolute top-[9px] left-0 h-5 w-[3px] rounded-r-[3px] bg-[#3f63a8]"
                        aria-hidden="true"
                      />
                    )}
                    <Icon className="size-[19px]" strokeWidth={1.7} aria-hidden="true" />
                  </button>
                );
              })}
            </nav>

            <WorkspacePanel
              activeView={activePanel}
              discussionCount={discussionCount}
              panelSlots={panelSlots}
              project={currentProject}
              onProjectSaved={setCurrentProject}
              onDescriptionStatusChange={setDescriptionStatus}
              requestDescriptionUpdate={requestDescriptionUpdate}
              descriptionSaveDelayMs={descriptionSaveDelayMs}
            />
          </aside>
        </div>
      </main>
    </CurrentProjectDescriptionContext.Provider>
  );
}

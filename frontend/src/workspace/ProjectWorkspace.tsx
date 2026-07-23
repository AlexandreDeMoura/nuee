import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
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
import type { Bubble, Project } from '../api';
import {
  analytics,
  trackAnalytics,
  type AnalyticsClient,
  type AnalyticsEventProperties,
} from '../analytics';
import {
  CanvasSurface,
  type BubbleListRequest,
  type BubblePositionUpdateRequest,
  type ProjectViewportUpdateRequest,
} from '../canvas/CanvasSurface';
import type {
  BubbleCreateRequest,
  BubblePlacementRequest,
} from '../bubbles/CreateBubbleDialog';
import {
  BubbleInspector,
  type BubbleUpdateRequest,
} from '../bubbles/BubbleInspector';
import {
  ProjectDescriptionEditor,
  type ProjectDescriptionSaveStatus,
  type ProjectDescriptionUpdateRequest,
} from '../projects/ProjectDescriptionEditor';
import { navigate } from '../utils/routing';
import { CurrentProjectDescriptionContext } from './currentProjectDescription';
import { getDefaultPanelView, type WorkspacePanelView } from './panelModel';

export type WorkspaceEmptyAction =
  | 'start-discussion'
  | 'create-bubble'
  | 'upload-document';

const emptyActionAnalyticsNames: Record<
  WorkspaceEmptyAction,
  AnalyticsEventProperties['project_empty_action_selected']['action']
> = {
  'start-discussion': 'start_discussion',
  'create-bubble': 'create_bubble',
  'upload-document': 'upload_document',
};

export type WorkspaceEmptyActionHandlers = Partial<
  Record<WorkspaceEmptyAction, () => void>
>;

export interface WorkspaceInspectorSelection {
  id: string;
  kind: 'bubble' | 'context';
  isValid?: boolean;
}

export interface WorkspacePanelSlots {
  discussions?: ReactNode;
  documents?: ReactNode;
  project?: ReactNode;
  inspector?:
    | ReactNode
    | ((selection: WorkspaceInspectorSelection) => ReactNode);
}

export interface ProjectWorkspaceProps {
  project: Project;
  requestBubbleCreate?: BubbleCreateRequest;
  requestBubbles?: BubbleListRequest;
  requestBubblePlacement?: BubblePlacementRequest;
  requestBubblePositionUpdate?: BubblePositionUpdateRequest;
  requestBubbleUpdate?: BubbleUpdateRequest;
  requestViewportUpdate?: ProjectViewportUpdateRequest;
  viewportSaveDelayMs?: number;
  bubbleSaveDelayMs?: number;
  discussionCount?: number;
  panelSlots?: WorkspacePanelSlots;
  emptyActionHandlers?: WorkspaceEmptyActionHandlers;
  inspectorSelection?: WorkspaceInspectorSelection | null;
  onInspectorSelectionInvalidated?: (
    selection: WorkspaceInspectorSelection,
  ) => void;
  /** @deprecated Supply emptyActionHandlers so each feature owns its launch callback. */
  primaryActions?: ReactNode;
  requestDescriptionUpdate?: ProjectDescriptionUpdateRequest;
  descriptionSaveDelayMs?: number;
  analyticsClient?: AnalyticsClient;
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
  action: WorkspaceEmptyAction;
  description: string;
  icon: LucideIcon;
  label: string;
  meta: string;
  onLaunch?: () => void;
  primary?: boolean;
}

function ActionCard({
  action,
  description,
  icon: Icon,
  label,
  meta,
  onLaunch,
  primary = false,
}: ActionCardProps) {
  return (
    <button
      className={`min-h-[164px] cursor-pointer rounded-[14px] border p-[18px] pb-4 text-left shadow-[0_1px_2px_rgba(30,39,51,0.04)] transition-[border-color,background-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:transition-none ${
        primary
          ? 'border-[#3f63a8] bg-[#3f63a8] text-white shadow-[0_8px_22px_-10px_rgba(63,99,168,0.7)] hover:bg-[#365894]'
          : 'border-[#e1e6ec] bg-white text-[#1e2733] hover:border-[#c7d2df] hover:bg-[#fbfcfe]'
      } ${focusRing}`}
      aria-label={label}
      data-workspace-action={action}
      type="button"
      onClick={onLaunch}
    >
      <span
        className={`mb-3.5 grid size-8 place-items-center rounded-[9px] ${
          primary ? 'bg-white/15 text-white' : 'bg-[#eef2f7] text-[#3f63a8]'
        }`}
      >
        <Icon className="size-[17px]" strokeWidth={1.7} aria-hidden="true" />
      </span>
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      <span className={`block text-[11.5px] leading-[1.45] ${primary ? 'text-white/80' : 'text-[#5c6a7a]'}`}>
        {description}
      </span>
      <span
        className={`mt-3 block text-[9.5px] font-medium tracking-[0.06em] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${
          primary ? 'text-white/60' : 'text-[#9aa6b4]'
        }`}
      >
        {meta}
      </span>
    </button>
  );
}

function EmptyProjectActions({
  analyticsClient,
  handlers,
  projectId,
}: {
  analyticsClient: AnalyticsClient;
  handlers?: WorkspaceEmptyActionHandlers;
  projectId: string;
}) {
  const launch = (action: WorkspaceEmptyAction) => () => {
    trackAnalytics(analyticsClient, 'project_empty_action_selected', {
      project_id: projectId,
      action: emptyActionAnalyticsNames[action],
    });
    handlers?.[action]?.();
  };

  return (
    <div
      className="grid w-full max-w-[674px] grid-cols-1 gap-4 md:grid-cols-3"
      aria-label="Project starting points"
    >
      <ActionCard
        action="start-discussion"
        description="Ask a focused question. Answers stay short by default."
        icon={MessageSquare}
        label="Start a discussion"
        meta="RECOMMENDED · ⌘K"
        onLaunch={launch('start-discussion')}
        primary
      />
      <ActionCard
        action="create-bubble"
        description="Already know something? Add durable knowledge by hand."
        icon={CirclePlus}
        label="Create a bubble"
        meta="MANUAL"
        onLaunch={launch('create-bubble')}
      />
      <ActionCard
        action="upload-document"
        description="Bring a source in. Select it whole as discussion context."
        icon={Upload}
        label="Upload a document"
        meta="PDF · TXT · MD"
        onLaunch={launch('upload-document')}
      />
    </div>
  );
}

function EmptyCanvasContent({
  analyticsClient,
  emptyActionHandlers,
  primaryActions,
  projectId,
}: {
  analyticsClient: AnalyticsClient;
  emptyActionHandlers?: WorkspaceEmptyActionHandlers;
  primaryActions?: ReactNode;
  projectId: string;
}) {
  return (
    <div
      className="pointer-events-auto flex flex-col items-center justify-center text-center"
      data-canvas-overlay
      aria-labelledby="empty-project-title"
    >
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
      {primaryActions ?? (
        <EmptyProjectActions
          analyticsClient={analyticsClient}
          handlers={emptyActionHandlers}
          projectId={projectId}
        />
      )}
    </div>
  );
}

function PanelEmptyState({
  view,
}: {
  view: 'discussions' | 'documents' | 'inspector';
}) {
  const states: Record<
    typeof view,
    { description: string; icon: LucideIcon; title: string }
  > = {
    discussions: {
      description: 'Start a discussion from the canvas when you are ready to explore a question.',
      icon: MessageSquare,
      title: 'No discussions yet',
    },
    documents: {
      description: 'Uploaded project sources will appear here.',
      icon: FileText,
      title: 'No documents yet',
    },
    inspector: {
      description: 'Select a bubble or context item to inspect its details.',
      icon: Search,
      title: 'Nothing selected',
    },
  };
  const state = states[view];
  const Icon = state.icon;

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center px-7 text-center"
      data-panel-empty={view}
    >
      <span className="mb-3 grid size-9 place-items-center rounded-[10px] bg-[#f2f5f9] text-[#7f8ea0]">
        <Icon className="size-[17px]" strokeWidth={1.7} aria-hidden="true" />
      </span>
      <h3 className="text-[13px] font-semibold text-[#344050]">{state.title}</h3>
      <p className="mt-1.5 max-w-[230px] text-xs leading-[1.55] text-[#8b97a6]">
        {state.description}
      </p>
    </div>
  );
}

function WorkspacePanel({
  activeView,
  discussionCount,
  inspectorSelection,
  selectedBubble,
  panelSlots,
  project,
  onProjectSaved,
  onDescriptionStatusChange,
  requestDescriptionUpdate,
  descriptionSaveDelayMs,
  analyticsClient,
  requestBubbleUpdate,
  bubbleSaveDelayMs,
  onBubbleUpdated,
}: {
  activeView: WorkspacePanelView;
  discussionCount: number;
  inspectorSelection: WorkspaceInspectorSelection | null;
  selectedBubble: Bubble | null;
  panelSlots?: WorkspacePanelSlots;
  project: Project;
  onProjectSaved: (project: Project) => void;
  onDescriptionStatusChange: (status: ProjectDescriptionSaveStatus) => void;
  requestDescriptionUpdate?: ProjectDescriptionUpdateRequest;
  descriptionSaveDelayMs?: number;
  analyticsClient: AnalyticsClient;
  requestBubbleUpdate?: BubbleUpdateRequest;
  bubbleSaveDelayMs?: number;
  onBubbleUpdated: (bubble: Bubble) => void;
}) {
  const activeDefinition = panelDefinitions.find(({ view }) => view === activeView)!;
  const hasDefaultProjectEditor = panelSlots?.project === undefined;
  const inspectorContent =
    activeView === 'inspector' && inspectorSelection && panelSlots?.inspector !== undefined
      ? typeof panelSlots.inspector === 'function'
        ? panelSlots.inspector(inspectorSelection)
        : panelSlots.inspector
      : undefined;

  return (
    <section
      className="flex w-[min(336px,calc(100vw-52px))] shrink-0 flex-col border-l border-[#e1e6ec] bg-white sm:w-[336px]"
      aria-labelledby={`workspace-panel-tab-${activeView}`}
      id="workspace-active-panel"
      role="tabpanel"
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
            analyticsClient={analyticsClient}
            key={project.id}
            project={project}
            onProjectSaved={onProjectSaved}
            onStatusChange={onDescriptionStatusChange}
            requestUpdate={requestDescriptionUpdate}
            saveDelayMs={descriptionSaveDelayMs}
          />
        </div>
      )}
      {activeView === 'project' && !hasDefaultProjectEditor && panelSlots?.project}
      {activeView === 'discussions' &&
        (panelSlots?.discussions ?? <PanelEmptyState view="discussions" />)}
      {activeView === 'documents' &&
        (panelSlots?.documents ?? <PanelEmptyState view="documents" />)}
      {activeView === 'inspector' &&
        (inspectorSelection && inspectorContent != null ? (
          inspectorContent
        ) : inspectorSelection?.kind === 'bubble' &&
          selectedBubble?.id === inspectorSelection.id ? (
          <BubbleInspector
            analyticsClient={analyticsClient}
            bubble={selectedBubble}
            key={selectedBubble.id}
            onBubbleUpdated={onBubbleUpdated}
            requestUpdate={requestBubbleUpdate}
            saveDelayMs={bubbleSaveDelayMs}
          />
        ) : (
          <PanelEmptyState view="inspector" />
        ))}
    </section>
  );
}

export function ProjectWorkspace({
  project,
  requestBubbleCreate,
  requestBubbles,
  requestBubblePlacement,
  requestBubblePositionUpdate,
  requestBubbleUpdate,
  requestViewportUpdate,
  viewportSaveDelayMs,
  bubbleSaveDelayMs,
  discussionCount = 0,
  panelSlots,
  emptyActionHandlers,
  inspectorSelection = null,
  onInspectorSelectionInvalidated,
  primaryActions,
  requestDescriptionUpdate,
  descriptionSaveDelayMs,
  analyticsClient = analytics,
}: ProjectWorkspaceProps) {
  const [currentProject, setCurrentProject] = useState(project);
  const [descriptionStatus, setDescriptionStatus] =
    useState<ProjectDescriptionSaveStatus>('saved');
  const [activePanel, setActivePanel] = useState<WorkspacePanelView>(() =>
    getDefaultPanelView(discussionCount),
  );
  const [selectedBubble, setSelectedBubble] = useState<Bubble | null>(null);
  const [updatedBubbles, setUpdatedBubbles] = useState<
    Record<string, Bubble>
  >({});
  const panelButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const canvasInspectorSelection: WorkspaceInspectorSelection | null =
    selectedBubble
      ? { id: selectedBubble.id, kind: 'bubble' }
      : null;
  const validInspectorSelection =
    inspectorSelection?.isValid === false
      ? null
      : inspectorSelection ?? canvasInspectorSelection;

  useEffect(() => {
    if (inspectorSelection?.isValid === false) {
      onInspectorSelectionInvalidated?.(inspectorSelection);
    }
  }, [inspectorSelection, onInspectorSelectionInvalidated]);

  function handlePanelKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = (index + 1) % panelDefinitions.length;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + panelDefinitions.length) % panelDefinitions.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = panelDefinitions.length - 1;
    }

    if (nextIndex === undefined) {
      return;
    }

    event.preventDefault();
    const nextDefinition = panelDefinitions[nextIndex];
    selectPanel(nextDefinition.view);
    panelButtonRefs.current[nextIndex]?.focus();
  }

  function selectPanel(view: WorkspacePanelView) {
    if (view === activePanel) {
      return;
    }

    setActivePanel(view);
    trackAnalytics(analyticsClient, 'project_panel_viewed', {
      project_id: currentProject.id,
      view,
    });
  }

  const handleBubbleSelectionChange = useCallback(
    (bubble: Bubble | null) => {
      setSelectedBubble(bubble);

      if (!bubble) {
        return;
      }

      trackAnalytics(analyticsClient, 'bubble_inspected', {
        project_id: currentProject.id,
        bubble_id: bubble.id,
      });

      if (activePanel !== 'inspector') {
        setActivePanel('inspector');
        trackAnalytics(analyticsClient, 'project_panel_viewed', {
          project_id: currentProject.id,
          view: 'inspector',
        });
      }
    },
    [activePanel, analyticsClient, currentProject.id],
  );

  const handleBubbleUpdated = useCallback(
    (bubble: Bubble) => {
      if (bubble.project_id !== currentProject.id) {
        return;
      }

      setSelectedBubble((current) =>
        current?.id === bubble.id ? bubble : current,
      );
      setUpdatedBubbles((current) => ({
        ...current,
        [bubble.id]: bubble,
      }));
    },
    [currentProject.id],
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
          <CanvasSurface
            analyticsClient={analyticsClient}
            emptyState={({ onCreateBubble }) => (
              <EmptyCanvasContent
                analyticsClient={analyticsClient}
                emptyActionHandlers={{
                  ...emptyActionHandlers,
                  'create-bubble':
                    emptyActionHandlers?.['create-bubble'] ?? onCreateBubble,
                }}
                primaryActions={primaryActions}
                projectId={currentProject.id}
              />
            )}
            key={currentProject.id}
            initialViewport={{
              x: currentProject.canvas_viewport_x,
              y: currentProject.canvas_viewport_y,
              zoom: currentProject.canvas_zoom,
            }}
            projectId={currentProject.id}
            requestBubbleCreate={requestBubbleCreate}
            requestBubbles={requestBubbles}
            requestBubblePlacement={requestBubblePlacement}
            requestBubblePositionUpdate={requestBubblePositionUpdate}
            requestViewportUpdate={requestViewportUpdate}
            onBubbleSelectionChange={handleBubbleSelectionChange}
            updatedBubbles={Object.values(updatedBubbles)}
            viewportSaveDelayMs={viewportSaveDelayMs}
          />

          <aside className="flex shrink-0 bg-white" aria-label="Project tools">
            <nav
              className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-l border-[#e1e6ec] bg-white pt-3"
              aria-label="Workspace panels"
              aria-orientation="vertical"
              role="tablist"
            >
              {panelDefinitions.map(({ view, label, icon: Icon }, index) => {
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
                    aria-controls="workspace-active-panel"
                    aria-selected={isActive}
                    data-active={isActive ? 'true' : 'false'}
                    id={`workspace-panel-tab-${view}`}
                    role="tab"
                    tabIndex={isActive ? 0 : -1}
                    title={label}
                    onClick={() => selectPanel(view)}
                    onKeyDown={(event) => handlePanelKeyDown(event, index)}
                    ref={(button) => {
                      panelButtonRefs.current[index] = button;
                    }}
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
              analyticsClient={analyticsClient}
              discussionCount={discussionCount}
              inspectorSelection={validInspectorSelection}
              selectedBubble={selectedBubble}
              panelSlots={panelSlots}
              project={currentProject}
              onProjectSaved={setCurrentProject}
              onDescriptionStatusChange={setDescriptionStatus}
              requestDescriptionUpdate={requestDescriptionUpdate}
              descriptionSaveDelayMs={descriptionSaveDelayMs}
              requestBubbleUpdate={requestBubbleUpdate}
              bubbleSaveDelayMs={bubbleSaveDelayMs}
              onBubbleUpdated={handleBubbleUpdated}
            />
          </aside>
        </div>
      </main>
    </CurrentProjectDescriptionContext.Provider>
  );
}

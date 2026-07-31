import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
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
import {
  getBubbleLinks,
  getProjectBubbles,
  type Bubble,
  type BubbleLink,
  type KnowledgeExtractionResolutionResponse,
  type Project,
} from '../api';
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
  type BubblePositionsUpdateRequest,
  type CanvasMultiSelection,
  type ProjectViewportUpdateRequest,
} from '../canvas/CanvasSurface';
import { useProjectBubbles } from '../canvas/useProjectBubbles';
import type {
  BubbleCreateRequest,
  BubblePlacementRequest,
} from '../bubbles/CreateBubbleDialog';
import {
  BubbleInspector,
  type BubbleDeleteRequest,
  type BubbleLinkCreateRequest,
  type BubbleLinkDeleteRequest,
  type BubbleUpdateRequest,
} from '../bubbles/BubbleInspector';
import {
  DiscussionDeleteDialog,
  DiscussionExperience,
  DiscussionModal,
  DiscussionsPanel,
  useDiscussionContextSelection,
  useProjectDiscussions,
  useDiscussionVisibility,
  type DiscussionLifecycleRequests,
  type DiscussionContextInspection,
  type DiscussionContextEntryPoint,
  type DiscussionContextSourceCandidate,
  type DiscussionDeleteTarget,
  type DiscussionKnowledgeSource,
  type ProjectDiscussionRequests,
  type DiscussionVisibilityController,
} from '../discussions';
import {
  DocumentContextSelectionPanel,
  DocumentsPanel,
  trackDocumentAnalytics,
  useDocumentLibrary,
  useDocumentMultiSelection,
  type DocumentDetailRequest,
  type DocumentLibraryController,
  type DocumentLibraryRequests,
  type DocumentMultiSelection,
  type DocumentMultiSelectionController,
} from '../documents';
import type {
  KnowledgeExtractionRequests,
  KnowledgeExtractionTargetSelectionRequest,
} from '../knowledge-extraction';
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

export interface WorkspaceOverlaySlots {
  discussion?:
    | ReactNode
    | ((controller: DiscussionVisibilityController) => ReactNode);
}

export interface ProjectWorkspaceProps {
  project: Project;
  initialDocumentUploads?: readonly File[];
  onInitialDocumentUploadsStarted?: () => void;
  requestBubbleCreate?: BubbleCreateRequest;
  requestBubbles?: BubbleListRequest;
  requestBubblePlacement?: BubblePlacementRequest;
  requestBubblePositionUpdate?: BubblePositionUpdateRequest;
  requestBubblePositionsUpdate?: BubblePositionsUpdateRequest;
  requestBubbleDelete?: BubbleDeleteRequest;
  requestBubbleUpdate?: BubbleUpdateRequest;
  requestBubbleLinks?: BubbleLinkListRequest;
  requestBubbleLinkCreate?: BubbleLinkCreateRequest;
  requestBubbleLinkDelete?: BubbleLinkDeleteRequest;
  requestViewportUpdate?: ProjectViewportUpdateRequest;
  canvasMultiSelection?: CanvasMultiSelection | null;
  viewportSaveDelayMs?: number;
  bubbleSaveDelayMs?: number;
  documentLibraryRequests?: DocumentLibraryRequests;
  documentPollIntervalMs?: number;
  requestDocument?: DocumentDetailRequest;
  discussionCount?: number;
  panelSlots?: WorkspacePanelSlots;
  overlaySlots?: WorkspaceOverlaySlots;
  emptyActionHandlers?: WorkspaceEmptyActionHandlers;
  discussionLifecycleRequests?: DiscussionLifecycleRequests;
  discussionPanelRequests?: ProjectDiscussionRequests;
  extractionRequests?: KnowledgeExtractionRequests;
  onExtractDiscussionKnowledge?: (source: DiscussionKnowledgeSource) => void;
  onInspectDiscussionContext?: (
    inspection: DiscussionContextInspection,
  ) => void;
  onDiscussionDraftSubmit?: (prompt: string) => void;
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

export type BubbleLinkListRequest = (
  projectId: string,
  signal?: AbortSignal,
) => Promise<BubbleLink[]>;

type BubbleLinkLoadState =
  | { status: 'loading'; links: BubbleLink[] }
  | { status: 'ready'; links: BubbleLink[] }
  | { status: 'error'; links: BubbleLink[] };

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

function InspectorEmptyState() {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center px-7 text-center"
      data-panel-empty="inspector"
    >
      <span className="mb-3 grid size-9 place-items-center rounded-[10px] bg-[#f2f5f9] text-[#7f8ea0]">
        <Search className="size-[17px]" strokeWidth={1.7} aria-hidden="true" />
      </span>
      <h3 className="text-[13px] font-semibold text-[#344050]">
        Nothing selected
      </h3>
      <p className="mt-1.5 max-w-[230px] text-xs leading-[1.55] text-[#8b97a6]">
        Select a bubble or context item to inspect its details.
      </p>
    </div>
  );
}

function WorkspacePanel({
  activeView,
  discussionCount,
  discussionsContent,
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
  requestBubbleDelete,
  requestBubbleLinkCreate,
  requestBubbleLinkDelete,
  bubbleSaveDelayMs,
  documentContextSelection,
  documentLibrary,
  documentUploadInputRef,
  requestDocument,
  availableBubbles,
  bubbleLinkLoadState,
  onBubbleLinkCreated,
  onBubbleLinkRemoved,
  onRetryBubbleLinks,
  onBubbleDeleted,
  onBubbleUpdated,
}: {
  activeView: WorkspacePanelView;
  discussionCount: number;
  discussionsContent: ReactNode;
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
  requestBubbleDelete?: BubbleDeleteRequest;
  requestBubbleLinkCreate?: BubbleLinkCreateRequest;
  requestBubbleLinkDelete?: BubbleLinkDeleteRequest;
  bubbleSaveDelayMs?: number;
  documentContextSelection: DocumentMultiSelectionController;
  documentLibrary: DocumentLibraryController;
  documentUploadInputRef: Ref<HTMLInputElement>;
  requestDocument?: DocumentDetailRequest;
  availableBubbles: Bubble[];
  bubbleLinkLoadState: BubbleLinkLoadState;
  onBubbleLinkCreated: (link: BubbleLink) => void;
  onBubbleLinkRemoved: (link: BubbleLink) => void;
  onRetryBubbleLinks: () => void;
  onBubbleDeleted: (bubble: Bubble) => void;
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
      {activeView === 'discussions' && discussionsContent}
      {activeView === 'documents' &&
        (documentContextSelection.isActive ? (
          <DocumentContextSelectionPanel
            controller={documentContextSelection}
          />
        ) : (
          panelSlots?.documents ?? (
            <DocumentsPanel
              analyticsClient={analyticsClient}
              controller={documentLibrary}
              projectId={project.id}
              requestDocument={requestDocument}
              uploadInputRef={documentUploadInputRef}
            />
          )
        ))}
      {activeView === 'inspector' &&
        (inspectorSelection && inspectorContent != null ? (
          inspectorContent
        ) : inspectorSelection?.kind === 'bubble' &&
          selectedBubble?.id === inspectorSelection.id ? (
          <BubbleInspector
            analyticsClient={analyticsClient}
            availableBubbles={availableBubbles}
            bubble={selectedBubble}
            bubbleLinks={bubbleLinkLoadState.links}
            key={selectedBubble.id}
            linkLoadStatus={bubbleLinkLoadState.status}
            onBubbleLinkCreated={onBubbleLinkCreated}
            onBubbleLinkRemoved={onBubbleLinkRemoved}
            onBubbleDeleted={onBubbleDeleted}
            onBubbleUpdated={onBubbleUpdated}
            onRetryBubbleLinks={onRetryBubbleLinks}
            requestCreateLink={requestBubbleLinkCreate}
            requestDelete={requestBubbleDelete}
            requestDeleteLink={requestBubbleLinkDelete}
            requestUpdate={requestBubbleUpdate}
            saveDelayMs={bubbleSaveDelayMs}
          />
        ) : (
          <InspectorEmptyState />
        ))}
    </section>
  );
}

export function ProjectWorkspace({
  project,
  initialDocumentUploads,
  onInitialDocumentUploadsStarted,
  requestBubbleCreate,
  requestBubbles = getProjectBubbles,
  requestBubblePlacement,
  requestBubblePositionUpdate,
  requestBubblePositionsUpdate,
  requestBubbleDelete,
  requestBubbleUpdate,
  requestBubbleLinks = getBubbleLinks,
  requestBubbleLinkCreate,
  requestBubbleLinkDelete,
  requestViewportUpdate,
  canvasMultiSelection = null,
  viewportSaveDelayMs,
  bubbleSaveDelayMs,
  documentLibraryRequests,
  documentPollIntervalMs,
  requestDocument,
  discussionCount = 0,
  panelSlots,
  overlaySlots,
  emptyActionHandlers,
  discussionLifecycleRequests,
  discussionPanelRequests,
  extractionRequests,
  onExtractDiscussionKnowledge,
  onInspectDiscussionContext,
  onDiscussionDraftSubmit,
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
    initialDocumentUploads && initialDocumentUploads.length > 0
      ? 'documents'
      : getDefaultPanelView(discussionCount),
  );
  const [activatedDocumentLibraryProjectId, setActivatedDocumentLibraryProjectId] =
    useState<string | null>(() =>
      initialDocumentUploads && initialDocumentUploads.length > 0
        ? project.id
        : null,
    );
  const [documentUploadPickerProjectId, setDocumentUploadPickerProjectId] =
    useState<string | null>(null);
  const [selectedBubbleId, setSelectedBubbleId] = useState<string | null>(null);
  const [
    knowledgeExtractionTargetSelection,
    setKnowledgeExtractionTargetSelection,
  ] = useState<KnowledgeExtractionTargetSelectionRequest | null>(null);
  const [discussionDeletionState, setDiscussionDeletionState] = useState<
    (DiscussionDeleteTarget & { projectId: string }) | null
  >(null);
  const discussionPendingDeletion =
    discussionDeletionState?.projectId === currentProject.id
      ? discussionDeletionState
      : null;
  const [bubbleLinkLoadState, setBubbleLinkLoadState] =
    useState<BubbleLinkLoadState>({ status: 'loading', links: [] });
  const [bubbleLinkRequestKey, setBubbleLinkRequestKey] = useState(0);
  const discussionVisibility = useDiscussionVisibility(currentProject.id);
  const discussionContextSelection = useDiscussionContextSelection(
    currentProject.id,
  );
  const documentLibraryEnabled =
    activatedDocumentLibraryProjectId === currentProject.id ||
    activePanel === 'documents' ||
    discussionContextSelection.phase === 'selecting_documents';
  const documentLibrary = useDocumentLibrary({
    analyticsClient,
    enabled: documentLibraryEnabled,
    pollIntervalMs: documentPollIntervalMs,
    projectId: currentProject.id,
    requests: documentLibraryRequests,
  });
  const initialUploadPolicy = documentLibrary.policy;
  const uploadInitialDocument = documentLibrary.uploadFile;
  const initialDocumentUploadsStartedRef = useRef(false);
  const previousContextSelectionPhaseRef = useRef(
    discussionContextSelection.phase,
  );
  const documentContextReadinessTrackedRef = useRef(false);
  const projectDiscussions = useProjectDiscussions({
    analyticsClient,
    enabled:
      activePanel === 'discussions' && panelSlots?.discussions === undefined,
    projectId: currentProject.id,
    requests: discussionPanelRequests,
  });
  const panelButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const documentUploadInputRef = useRef<HTMLInputElement | null>(null);
  const bubbleCollection = useProjectBubbles({
    projectId: currentProject.id,
    requestBubbles,
  });
  const {
    addBubble,
    isBubbleRemoved,
    removeBubble,
    replaceBubble,
  } = bubbleCollection;
  const availableBubbles = bubbleCollection.loadState.bubbles;
  const selectedBubble =
    availableBubbles.find((bubble) => bubble.id === selectedBubbleId) ?? null;
  const canvasInspectorSelection: WorkspaceInspectorSelection | null =
    selectedBubble
      ? { id: selectedBubble.id, kind: 'bubble' }
      : null;
  const validInspectorSelection =
    inspectorSelection?.isValid === false
      ? null
      : inspectorSelection ?? canvasInspectorSelection;

  useEffect(() => {
    if (
      initialDocumentUploadsStartedRef.current ||
      !initialDocumentUploads ||
      initialDocumentUploads.length === 0 ||
      !initialUploadPolicy
    ) {
      return;
    }

    // Deferring the handoff lets React's development-only Strict Mode cleanup
    // finish before upload controllers are created.
    const timeout = window.setTimeout(() => {
      if (initialDocumentUploadsStartedRef.current) {
        return;
      }

      initialDocumentUploadsStartedRef.current = true;
      for (const file of initialDocumentUploads) {
        uploadInitialDocument(file, 'project_creation');
      }
      onInitialDocumentUploadsStarted?.();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [
    initialUploadPolicy,
    initialDocumentUploads,
    onInitialDocumentUploadsStarted,
    uploadInitialDocument,
  ]);

  useEffect(() => {
    if (inspectorSelection?.isValid === false) {
      onInspectorSelectionInvalidated?.(inspectorSelection);
    }
  }, [inspectorSelection, onInspectorSelectionInvalidated]);

  useEffect(() => {
    if (
      documentUploadPickerProjectId !== currentProject.id ||
      activePanel !== 'documents' ||
      !documentLibrary.policy ||
      !documentUploadInputRef.current
    ) {
      return;
    }

    setDocumentUploadPickerProjectId(null);
    documentUploadInputRef.current.click();
  }, [
    activePanel,
    currentProject.id,
    documentLibrary.policy,
    documentUploadPickerProjectId,
  ]);

  useEffect(() => {
    const controller = new AbortController();

    requestBubbleLinks(currentProject.id, controller.signal)
      .then((links) => {
        if (controller.signal.aborted) {
          return;
        }

        const currentLinks = links.filter(
          (link) =>
            !isBubbleRemoved(link.bubble_a_id) &&
            !isBubbleRemoved(link.bubble_b_id),
        );
        const seenPairs = new Set<string>();
        const validLinks = currentLinks.filter((link) => {
          const pair = `${link.bubble_a_id}\0${link.bubble_b_id}`;
          const isValid =
            link.project_id === currentProject.id &&
            typeof link.id === 'string' &&
            link.id.length > 0 &&
            typeof link.bubble_a_id === 'string' &&
            typeof link.bubble_b_id === 'string' &&
            link.bubble_a_id < link.bubble_b_id &&
            typeof link.created_at === 'string' &&
            !seenPairs.has(pair);

          if (isValid) {
            seenPairs.add(pair);
          }

          return isValid;
        });

        if (validLinks.length !== currentLinks.length) {
          throw new Error('The bubble link response contained invalid records.');
        }

        setBubbleLinkLoadState({ status: 'ready', links: validLinks });
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return;
        }

        setBubbleLinkLoadState((current) => ({
          status: 'error',
          links: current.links,
        }));
      });

    return () => controller.abort();
  }, [
    isBubbleRemoved,
    bubbleLinkRequestKey,
    currentProject.id,
    requestBubbleLinks,
  ]);

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
    if (view === 'documents') {
      setActivatedDocumentLibraryProjectId(currentProject.id);
    } else {
      setDocumentUploadPickerProjectId(null);
    }

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
      setSelectedBubbleId(bubble?.id ?? null);

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

      replaceBubble(bubble);
    },
    [currentProject.id, replaceBubble],
  );
  const handleKnowledgeExtractionResolved = useCallback(
    (response: KnowledgeExtractionResolutionResponse) => {
      if (response.project_id !== currentProject.id) {
        return;
      }

      if (response.resolution.kind === 'new_bubble') {
        addBubble(response.resolution.bubble);
      } else if (response.resolution.kind === 'update_bubble') {
        replaceBubble(response.resolution.bubble);
      }
    },
    [addBubble, currentProject.id, replaceBubble],
  );
  const handleKnowledgeExtractionTargetSelectionChange = useCallback(
    (selection: KnowledgeExtractionTargetSelectionRequest | null) => {
      if (selection && selection.projectId !== currentProject.id) {
        return;
      }

      setKnowledgeExtractionTargetSelection(selection);
    },
    [currentProject.id],
  );

  const handleBubbleLinkCreated = useCallback((link: BubbleLink) => {
    setBubbleLinkLoadState((current) => ({
      status: 'ready',
      links: current.links.some((candidate) => candidate.id === link.id)
        ? current.links
        : [...current.links, link],
    }));
  }, []);

  const handleBubbleLinkRemoved = useCallback((link: BubbleLink) => {
    setBubbleLinkLoadState((current) => ({
      status: 'ready',
      links: current.links.filter((candidate) => candidate.id !== link.id),
    }));
  }, []);

  const handleBubbleDeleted = useCallback((bubble: Bubble) => {
    setSelectedBubbleId((current) =>
      current === bubble.id ? null : current,
    );
    removeBubble(bubble.id);
    setBubbleLinkLoadState((current) => ({
      status: current.status,
      links: current.links.filter(
        (link) =>
          link.bubble_a_id !== bubble.id && link.bubble_b_id !== bubble.id,
      ),
    }));
  }, [removeBubble]);

  const handleRetryBubbleLinks = useCallback(() => {
    setBubbleLinkLoadState((current) => ({
      status: 'loading',
      links: current.links,
    }));
    setBubbleLinkRequestKey((key) => key + 1);
  }, []);

  const currentDescription = useMemo(
    () =>
      Object.freeze({
        projectId: currentProject.id,
        currentDescription: currentProject.description,
      }),
    [currentProject.description, currentProject.id],
  );
  const openDraftWithContext = useCallback(
    (
      entryPoint: DiscussionContextEntryPoint,
      includeSelectedBubble: boolean,
    ) => {
      const selectedSource: DiscussionContextSourceCandidate[] =
        includeSelectedBubble &&
        selectedBubble?.project_id === currentProject.id
          ? [
              {
                id: selectedBubble.id,
                kind: 'bubble',
                projectId: currentProject.id,
                title: selectedBubble.title,
              },
            ]
          : [];

      discussionContextSelection.prepare({
        entryPoint:
          selectedSource.length > 0 ? 'selected_bubble' : entryPoint,
        initialSources: selectedSource,
      });
      discussionVisibility.openDraft();
    },
    [
      currentProject.id,
      discussionContextSelection,
      discussionVisibility,
      selectedBubble,
    ],
  );
  const internalStartDiscussionFromCanvas = useCallback(
    () => openDraftWithContext('canvas_action', true),
    [openDraftWithContext],
  );
  const internalStartDiscussionFromPanel = useCallback(
    () => openDraftWithContext('discussions_panel', false),
    [openDraftWithContext],
  );
  const startDiscussionFromCanvas =
    emptyActionHandlers?.['start-discussion'] ??
    internalStartDiscussionFromCanvas;
  const startDiscussionFromPanel =
    emptyActionHandlers?.['start-discussion'] ??
    internalStartDiscussionFromPanel;
  const internalUploadDocumentFromCanvas = () => {
    setDocumentUploadPickerProjectId(currentProject.id);
    selectPanel('documents');
  };
  const uploadDocumentFromCanvas =
    emptyActionHandlers?.['upload-document'] ??
    internalUploadDocumentFromCanvas;
  const discussionContextMultiSelection =
    useMemo<CanvasMultiSelection | null>(() => {
      if (
        canvasMultiSelection !== null ||
        discussionContextSelection.phase !== 'selecting_bubbles'
      ) {
        return null;
      }

      return {
        allowEmptySelection: true,
        confirmLabel: 'Use selected bubbles',
        initialBubbleIds: discussionContextSelection.selection.bubble_ids,
        instruction: 'Choose bubbles for this discussion',
        onCancel: discussionContextSelection.backFromSourceSelection,
        onConfirm: (selection) => {
          discussionContextSelection.confirmSourceSelection(
            'bubble',
            selection.bubbles.map((bubble) => ({
              id: bubble.id,
              kind: 'bubble',
              projectId: bubble.project_id,
              title: bubble.title,
            })),
          );
        },
      };
    }, [canvasMultiSelection, discussionContextSelection]);
  const knowledgeExtractionCanvasSelection =
    useMemo<CanvasMultiSelection | null>(() => {
      if (
        canvasMultiSelection !== null ||
        !knowledgeExtractionTargetSelection ||
        knowledgeExtractionTargetSelection.projectId !== currentProject.id
      ) {
        return null;
      }

      return {
        confirmLabel: 'Use this bubble',
        initialBubbleIds:
          knowledgeExtractionTargetSelection.initialBubbleId === null
            ? []
            : [knowledgeExtractionTargetSelection.initialBubbleId],
        instruction: 'Choose one bubble to update',
        maximumSelectionCount: 1,
        onCancel: knowledgeExtractionTargetSelection.onCancel,
        onConfirm: (selection) => {
          const [target] = selection.bubbles;

          if (
            selection.bubbles.length !== 1 ||
            !target ||
            target.project_id !== currentProject.id
          ) {
            return;
          }

          knowledgeExtractionTargetSelection.onConfirm(target);
        },
      };
    }, [
      canvasMultiSelection,
      currentProject.id,
      knowledgeExtractionTargetSelection,
    ]);
  const resolvedCanvasMultiSelection =
    canvasMultiSelection ??
    knowledgeExtractionCanvasSelection ??
    discussionContextMultiSelection;
  const discussionContextDocumentSelection =
    useMemo<DocumentMultiSelection | null>(() => {
      if (
        discussionContextSelection.phase !== 'selecting_documents'
      ) {
        return null;
      }

      return {
        allowEmptySelection: true,
        confirmLabel: 'Use selected documents',
        initialDocumentIds:
          discussionContextSelection.selection.document_ids,
        instruction: 'Choose documents for this discussion',
        onCancel: discussionContextSelection.backFromSourceSelection,
        onConfirm: (selection) => {
          trackDocumentAnalytics(analyticsClient, 'document_context_readiness_checked', {
            project_id: currentProject.id,
            document_ids: selection.documentIds,
            action: 'selection_confirmed',
            ready_count: selection.documents.length,
            unavailable_count: 0,
          });
          discussionContextSelection.confirmSourceSelection(
            'document',
            selection.documents.map((document) => ({
              id: document.id,
              kind: 'document',
              projectId: document.project_id,
              title: document.title,
            })),
          );
        },
      };
    }, [analyticsClient, currentProject.id, discussionContextSelection]);
  const documentContextSelection = useDocumentMultiSelection({
    documents: documentLibrary.documents,
    multiSelection: discussionContextDocumentSelection,
    projectId: currentProject.id,
  });

  useEffect(() => {
    const previousPhase = previousContextSelectionPhaseRef.current;
    previousContextSelectionPhaseRef.current =
      discussionContextSelection.phase;

    if (discussionContextSelection.phase !== 'selecting_documents') {
      documentContextReadinessTrackedRef.current = false;
    }

    if (
      discussionContextSelection.phase === 'selecting_documents' &&
      previousPhase !== 'selecting_documents'
    ) {
      setActivatedDocumentLibraryProjectId(currentProject.id);
      setActivePanel('documents');
    }

    if (
      discussionContextSelection.phase === 'selecting_documents' &&
      documentLibrary.status === 'ready' &&
      !documentContextReadinessTrackedRef.current
    ) {
      const readyCount = documentLibrary.documents.filter(
        ({ processing_status }) => processing_status === 'ready',
      ).length;
      documentContextReadinessTrackedRef.current = true;
      trackDocumentAnalytics(analyticsClient, 'document_context_readiness_checked', {
        project_id: currentProject.id,
        document_ids: documentLibrary.documents.map(({ id }) => id),
        action: 'selection_opened',
        ready_count: readyCount,
        unavailable_count: documentLibrary.documents.length - readyCount,
      });
    }
  }, [
    analyticsClient,
    currentProject.id,
    discussionContextSelection.phase,
    documentLibrary.documents,
    documentLibrary.status,
  ]);

  const isContextSourceSelection =
    discussionVisibility.visibleDiscussion?.kind === 'draft' &&
    (discussionContextSelection.phase === 'selecting_bubbles' ||
      discussionContextSelection.phase === 'selecting_documents');
  const isKnowledgeExtractionTargetSelection =
    knowledgeExtractionCanvasSelection !== null;
  const discussionOverlay =
    typeof overlaySlots?.discussion === 'function'
      ? overlaySlots.discussion(discussionVisibility)
      : overlaySlots?.discussion;
  const isDiscussionVisible =
    (discussionVisibility.visibleDiscussion !== null &&
      !isContextSourceSelection &&
      !isKnowledgeExtractionTargetSelection) ||
    discussionPendingDeletion !== null;
  const visibleDiscussionDeleteTarget =
    discussionVisibility.visibleDiscussion?.kind === 'persisted'
      ? {
          id: discussionVisibility.visibleDiscussion.discussionId,
          title: discussionVisibility.visibleDiscussion.title,
        }
      : null;
  const minimizeDiscussion = useCallback(() => {
    const visible = discussionVisibility.visibleDiscussion;

    if (visible?.kind === 'persisted') {
      trackAnalytics(analyticsClient, 'discussion_minimized', {
        project_id: currentProject.id,
        discussion_id: visible.discussionId,
        occurred_at: new Date().toISOString(),
      });
    } else if (visible?.kind === 'draft') {
      discussionContextSelection.cancel();
    }

    discussionVisibility.minimize();
  }, [
    analyticsClient,
    currentProject.id,
    discussionContextSelection,
    discussionVisibility,
  ]);
  const handleDiscussionOpen = useCallback(
    async (discussion: Parameters<typeof projectDiscussions.openDiscussion>[0]) => {
      const opened = await projectDiscussions.openDiscussion(discussion);

      if (opened) {
        discussionVisibility.openDiscussion({
          id: opened.id,
          title: opened.title,
        });
      }
    },
    [discussionVisibility, projectDiscussions],
  );
  const openDiscussionDeleteConfirmation = useCallback(
    (discussion: DiscussionDeleteTarget) => {
      projectDiscussions.clearDeleteError();
      setDiscussionDeletionState({
        ...discussion,
        projectId: currentProject.id,
      });
    },
    [currentProject.id, projectDiscussions],
  );
  const closeDiscussionDeleteConfirmation = useCallback(() => {
    if (projectDiscussions.deletingDiscussionId !== null) {
      return;
    }

    projectDiscussions.clearDeleteError();
    setDiscussionDeletionState(null);
  }, [projectDiscussions]);
  const confirmDiscussionDelete = useCallback(async () => {
    if (!discussionPendingDeletion) {
      return;
    }

    const target = discussionPendingDeletion;
    const wasDeleted = await projectDiscussions.deleteDiscussion(target);

    if (!wasDeleted) {
      return;
    }

    setDiscussionDeletionState((current) =>
      current?.projectId === target.projectId && current.id === target.id
        ? null
        : current,
    );

    if (
      discussionVisibility.visibleDiscussion?.kind === 'persisted' &&
      discussionVisibility.visibleDiscussion.discussionId === target.id
    ) {
      discussionVisibility.minimize();
    }
  }, [
    discussionPendingDeletion,
    discussionVisibility,
    projectDiscussions,
  ]);
  const resolvedDiscussionCount =
    panelSlots?.discussions === undefined
      ? projectDiscussions.discussions.length
      : discussionCount;
  const discussionsContent =
    panelSlots?.discussions ?? (
      <DiscussionsPanel
        deletingDiscussionId={projectDiscussions.deletingDiscussionId}
        discussions={projectDiscussions.discussions}
        error={projectDiscussions.error}
        onDelete={openDiscussionDeleteConfirmation}
        onOpen={(discussion) => {
          void handleDiscussionOpen(discussion);
        }}
        onRetry={projectDiscussions.refresh}
        onStart={startDiscussionFromPanel}
        openingDiscussionId={projectDiscussions.openingDiscussionId}
        openError={projectDiscussions.openError}
        status={projectDiscussions.status}
      />
    );

  return (
    <CurrentProjectDescriptionContext.Provider value={currentDescription}>
      <main
        className="relative flex h-screen min-h-[480px] min-w-80 flex-col overflow-hidden bg-[#eef1f5] text-[#1e2733] [font-family:'IBM_Plex_Sans',system-ui,sans-serif] [font-synthesis:none] [text-rendering:optimizeLegibility]"
        data-project-id={currentProject.id}
      >
        <ProjectBar project={currentProject} descriptionStatus={descriptionStatus} />

        <div
          className={`relative flex min-h-0 flex-1 transition-[filter,opacity] duration-150 motion-reduce:transition-none ${
            isDiscussionVisible ? 'opacity-55 blur-[2px]' : ''
          }`}
          data-workspace-content
          aria-hidden={isDiscussionVisible ? 'true' : undefined}
          inert={isDiscussionVisible ? true : undefined}
        >
          <CanvasSurface
            analyticsClient={analyticsClient}
            bubbleCollection={bubbleCollection}
            bubbleLinks={bubbleLinkLoadState.links}
            multiSelection={resolvedCanvasMultiSelection}
            emptyState={({ onCreateBubble }) => (
              <EmptyCanvasContent
                analyticsClient={analyticsClient}
                emptyActionHandlers={{
                  ...emptyActionHandlers,
                  'start-discussion': startDiscussionFromCanvas,
                  'create-bubble':
                    emptyActionHandlers?.['create-bubble'] ?? onCreateBubble,
                  'upload-document': uploadDocumentFromCanvas,
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
            requestBubblePlacement={requestBubblePlacement}
            requestBubblePositionUpdate={requestBubblePositionUpdate}
            requestBubblePositionsUpdate={requestBubblePositionsUpdate}
            requestViewportUpdate={requestViewportUpdate}
            onBubbleSelectionChange={handleBubbleSelectionChange}
            onStartDiscussion={startDiscussionFromCanvas}
            viewportSaveDelayMs={viewportSaveDelayMs}
          />

          <aside
            className={`flex shrink-0 bg-white transition-opacity duration-150 motion-reduce:transition-none ${
              resolvedCanvasMultiSelection
                ? 'pointer-events-none opacity-40'
                : ''
            }`}
            aria-label="Project tools"
            aria-hidden={resolvedCanvasMultiSelection ? 'true' : undefined}
            inert={resolvedCanvasMultiSelection ? true : undefined}
          >
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
              availableBubbles={availableBubbles}
              bubbleLinkLoadState={bubbleLinkLoadState}
              documentContextSelection={documentContextSelection}
              documentLibrary={documentLibrary}
              documentUploadInputRef={documentUploadInputRef}
              discussionCount={resolvedDiscussionCount}
              discussionsContent={discussionsContent}
              inspectorSelection={validInspectorSelection}
              selectedBubble={selectedBubble}
              panelSlots={panelSlots}
              project={currentProject}
              onProjectSaved={setCurrentProject}
              onDescriptionStatusChange={setDescriptionStatus}
              requestDescriptionUpdate={requestDescriptionUpdate}
              requestDocument={requestDocument}
              descriptionSaveDelayMs={descriptionSaveDelayMs}
              requestBubbleUpdate={requestBubbleUpdate}
              requestBubbleDelete={requestBubbleDelete}
              requestBubbleLinkCreate={requestBubbleLinkCreate}
              requestBubbleLinkDelete={requestBubbleLinkDelete}
              bubbleSaveDelayMs={bubbleSaveDelayMs}
              onBubbleLinkCreated={handleBubbleLinkCreated}
              onBubbleLinkRemoved={handleBubbleLinkRemoved}
              onBubbleDeleted={handleBubbleDeleted}
              onRetryBubbleLinks={handleRetryBubbleLinks}
              onBubbleUpdated={handleBubbleUpdated}
            />
          </aside>
        </div>

        {discussionOverlay ??
          (discussionVisibility.visibleDiscussion &&
            !isContextSourceSelection &&
            (onDiscussionDraftSubmit ? (
              <DiscussionModal
                isObscured={discussionPendingDeletion !== null}
                key={
                  discussionVisibility.visibleDiscussion.kind === 'draft'
                    ? discussionVisibility.visibleDiscussion.key
                    : discussionVisibility.visibleDiscussion.discussionId
                }
                onDelete={
                  visibleDiscussionDeleteTarget
                    ? () =>
                        openDiscussionDeleteConfirmation(
                          visibleDiscussionDeleteTarget,
                        )
                    : undefined
                }
                onDraftPromptChange={discussionVisibility.updateDraftPrompt}
                onDraftSubmit={onDiscussionDraftSubmit}
                onMinimize={minimizeDiscussion}
                visibleDiscussion={discussionVisibility.visibleDiscussion}
              />
            ) : (
              <DiscussionExperience
                analyticsClient={analyticsClient}
                canSelectBubbleContext={canvasMultiSelection === null}
                canSelectDocumentContext
                contextSelection={discussionContextSelection}
                controller={discussionVisibility}
                extractionRequests={extractionRequests}
                isObscured={discussionPendingDeletion !== null}
                onExtractKnowledge={onExtractDiscussionKnowledge}
                onKnowledgeExtractionResolved={
                  handleKnowledgeExtractionResolved
                }
                onKnowledgeExtractionTargetSelectionChange={
                  canvasMultiSelection === null
                    ? handleKnowledgeExtractionTargetSelectionChange
                    : undefined
                }
                onInspectContext={onInspectDiscussionContext}
                onDiscussionChanged={projectDiscussions.updateDiscussion}
                onDelete={openDiscussionDeleteConfirmation}
                onMinimize={minimizeDiscussion}
                projectId={currentProject.id}
                requests={discussionLifecycleRequests}
              />
            )))}
        {discussionPendingDeletion && (
          <DiscussionDeleteDialog
            error={
              projectDiscussions.deleteError
                ? 'Couldn’t delete the discussion. Try again.'
                : null
            }
            isDeleting={
              projectDiscussions.deletingDiscussionId ===
              discussionPendingDeletion.id
            }
            onCancel={closeDiscussionDeleteConfirmation}
            onConfirm={() => {
              void confirmDiscussionDelete();
            }}
            target={discussionPendingDeletion}
          />
        )}
      </main>
    </CurrentProjectDescriptionContext.Provider>
  );
}

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ChevronLeft,
  CirclePlus,
  MessageSquare,
  Upload,
} from 'lucide-react';
import {
  getBubbleLinks,
  getProjectBubbles,
  getProjectTerritories,
  type Bubble,
  type BubbleLink,
  type KnowledgeExtractionResolutionResponse,
  type Project,
  type TerritoryCreateRequest,
} from '../api';
import {
  analytics,
  trackAnalytics,
  type AnalyticsClient,
  type AnalyticsEventProperties,
} from '../analytics';
import { focusRing } from '../ui/focusRing';
import { isPrimaryShortcut } from '../ui/keyboardShortcut';
import {
  CanvasSurface,
  type BubbleListRequest,
  type CanvasSaveStatus,
  type CanvasMultiSelection,
  type ProjectViewportUpdateRequest,
  type TerritoryListRequest,
  type TerritoryDeleteRequest,
  type TerritoryRenameRequest,
  type TerritoryVisibleCountUpdateRequest,
} from '../canvas/CanvasSurface';
import { useProjectBubbles } from '../canvas/useProjectBubbles';
import type { BubbleCreateRequest } from '../bubbles/CreateBubbleDialog';
import { BubbleReaderModal } from '../bubbles/BubbleReaderModal';
import {
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
  type DiscussionSourceCatalog,
  type ProjectDiscussionRequests,
  type DiscussionVisibilityController,
} from '../discussions';
import {
  useDocumentLibrary,
  type DocumentDetailRequest,
  type DocumentLibraryRequests,
} from '../documents';
import type {
  KnowledgeExtractionRequests,
  KnowledgeExtractionTargetSelectionRequest,
} from '../knowledge-extraction';
import type {
  ProjectDescriptionSaveStatus,
  ProjectDescriptionUpdateRequest,
} from '../projects/ProjectDescriptionEditor';
import { navigate } from '../utils/routing';
import { CurrentProjectDescriptionContext } from './currentProjectDescription';
import { getDefaultPanelView, type WorkspacePanelView } from './panelModel';
import { createProjectSourceCatalog } from './projectSourceCatalog';
import {
  WorkspaceSidebar,
  type BubbleLinkLoadState,
  type PanelCollapseSource,
  type PanelSelectionMode,
  type WorkspaceInspectorSelection,
  type WorkspacePanelSlots,
} from './WorkspaceSidebar';

export type {
  WorkspaceInspectorSelection,
  WorkspacePanelSlots,
} from './WorkspaceSidebar';

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

const requestNoTerritories: TerritoryListRequest = async () => [];

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
  requestTerritories?: TerritoryListRequest;
  requestTerritoryCreate?: TerritoryCreateRequest;
  requestTerritoryDelete?: TerritoryDeleteRequest;
  requestTerritoryRename?: TerritoryRenameRequest;
  requestTerritoryVisibleCountUpdate?: TerritoryVisibleCountUpdateRequest;
  requestBubbleDelete?: BubbleDeleteRequest;
  requestBubbleUpdate?: BubbleUpdateRequest;
  requestBubbleLinks?: BubbleLinkListRequest;
  requestBubbleLinkCreate?: BubbleLinkCreateRequest;
  requestBubbleLinkDelete?: BubbleLinkDeleteRequest;
  requestViewportUpdate?: ProjectViewportUpdateRequest;
  canvasMultiSelection?: CanvasMultiSelection | null;
  viewportSaveDelayMs?: number;
  visibleCountSaveDelayMs?: number;
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
  bubbleCount,
  project,
  saveStatus,
  territoryCount,
}: {
  bubbleCount: number;
  project: Project;
  saveStatus: ProjectDescriptionSaveStatus;
  territoryCount: number;
}) {
  const status = projectBarStatus[saveStatus];

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

      <span className="ml-auto hidden shrink-0 text-[10.5px] text-[#8b97a6] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] md:inline">
        {bubbleCount} {bubbleCount === 1 ? 'bubble' : 'bubbles'} ·{' '}
        {territoryCount} {territoryCount === 1 ? 'territory' : 'territories'}
      </span>

      <span
        className={`inline-flex shrink-0 items-center gap-1.5 text-[10.5px] font-medium tracking-[0.04em] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${status.textClasses}`}
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

export function ProjectWorkspace({
  project,
  initialDocumentUploads,
  onInitialDocumentUploadsStarted,
  requestBubbleCreate,
  requestBubbles = getProjectBubbles,
  requestTerritories,
  requestTerritoryCreate,
  requestTerritoryDelete,
  requestTerritoryRename,
  requestTerritoryVisibleCountUpdate,
  requestBubbleDelete,
  requestBubbleUpdate,
  requestBubbleLinks = getBubbleLinks,
  requestBubbleLinkCreate,
  requestBubbleLinkDelete,
  requestViewportUpdate,
  canvasMultiSelection = null,
  viewportSaveDelayMs,
  visibleCountSaveDelayMs,
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
  const [canvasSaveStatus, setCanvasSaveStatus] =
    useState<CanvasSaveStatus>('saved');
  const [activePanel, setActivePanel] = useState<WorkspacePanelView>(() =>
    initialDocumentUploads && initialDocumentUploads.length > 0
      ? 'documents'
      : getDefaultPanelView(discussionCount),
  );
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  const [activatedDocumentLibraryProjectId, setActivatedDocumentLibraryProjectId] =
    useState<string | null>(() =>
      initialDocumentUploads && initialDocumentUploads.length > 0
        ? project.id
        : null,
    );
  const [documentUploadPickerProjectId, setDocumentUploadPickerProjectId] =
    useState<string | null>(null);
  const [createBubbleDialogProjectId, setCreateBubbleDialogProjectId] =
    useState<string | null>(null);
  const [selectedBubbleId, setSelectedBubbleId] = useState<string | null>(null);
  const [readerBubbleId, setReaderBubbleId] = useState<string | null>(null);
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
    discussionVisibility.visibleDiscussion?.kind === 'draft';
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
  const projectDiscussions = useProjectDiscussions({
    analyticsClient,
    enabled:
      activePanel === 'discussions' && panelSlots?.discussions === undefined,
    projectId: currentProject.id,
    requests: discussionPanelRequests,
  });
  const documentUploadInputRef = useRef<HTMLInputElement | null>(null);
  const bubbleCollection = useProjectBubbles({
    projectId: currentProject.id,
    requestBubbles,
    requestTerritories:
      requestTerritories ??
      (requestBubbles === getProjectBubbles
        ? getProjectTerritories
        : requestNoTerritories),
  });
  const {
    addBubble,
    isBubbleRemoved,
    removeBubble,
    replaceBubble,
    retry: refreshBubbleCollection,
  } = bubbleCollection;
  const availableBubbles = bubbleCollection.loadState.bubbles;
  const visibleTerritoryCount = useMemo(() => {
    const occupiedTerritoryIds = new Set(
      availableBubbles.map(({ territory_id }) => territory_id),
    );

    return bubbleCollection.loadState.territories.filter(
      ({ id, kind }) => kind === 'manual' || occupiedTerritoryIds.has(id),
    ).length;
  }, [availableBubbles, bubbleCollection.loadState.territories]);
  const discussionSourceCatalog: DiscussionSourceCatalog = useMemo(
    () =>
      createProjectSourceCatalog({
        bubbles: availableBubbles,
        documents: documentLibrary.documents,
        projectId: currentProject.id,
      }),
    [availableBubbles, currentProject.id, documentLibrary.documents],
  );
  const selectedBubble =
    availableBubbles.find((bubble) => bubble.id === selectedBubbleId) ?? null;
  const readerBubble =
    availableBubbles.find((bubble) => bubble.id === readerBubbleId) ?? null;
  const readerLinkedTitles = useMemo(() => {
    if (!readerBubble) {
      return [];
    }

    const bubblesById = new Map(
      availableBubbles.map((bubble) => [bubble.id, bubble]),
    );

    return bubbleLinkLoadState.links.flatMap((link) => {
      const linkedBubbleId =
        link.bubble_a_id === readerBubble.id
          ? link.bubble_b_id
          : link.bubble_b_id === readerBubble.id
            ? link.bubble_a_id
            : null;
      const linkedBubble = linkedBubbleId
        ? bubblesById.get(linkedBubbleId)
        : null;

      return linkedBubble ? [linkedBubble.title] : [];
    });
  }, [availableBubbles, bubbleLinkLoadState.links, readerBubble]);
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

        setBubbleLinkLoadState({ status: 'ready', links: currentLinks });
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

  function selectPanel(
    view: WorkspacePanelView,
    mode: PanelSelectionMode = 'reveal',
  ) {
    if (view === 'documents') {
      setActivatedDocumentLibraryProjectId(currentProject.id);
    } else {
      setDocumentUploadPickerProjectId(null);
    }

    if (mode === 'reveal') {
      setIsPanelCollapsed(false);
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

  const togglePanelCollapsed = useCallback(
    (source: PanelCollapseSource) => {
      const collapsed = !isPanelCollapsed;

      setIsPanelCollapsed(collapsed);
      trackAnalytics(analyticsClient, 'project_panel_collapsed', {
        project_id: currentProject.id,
        collapsed,
        source,
      });
    },
    [analyticsClient, currentProject.id, isPanelCollapsed],
  );

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
      // Inspecting a bubble is a request to read it, so a collapsed panel reopens.
      setIsPanelCollapsed(false);

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
        const bubble = response.resolution.bubble;
        addBubble(bubble);

        if (
          !bubbleCollection.loadState.territories.some(
            ({ id }) => id === bubble.territory_id,
          )
        ) {
          refreshBubbleCollection();
        }
      } else if (response.resolution.kind === 'update_bubble') {
        replaceBubble(response.resolution.bubble);
      }
    },
    [
      addBubble,
      bubbleCollection.loadState.territories,
      currentProject.id,
      refreshBubbleCollection,
      replaceBubble,
    ],
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
  const createBubbleFromDiscussion =
    emptyActionHandlers?.['create-bubble'] ??
    (() => setCreateBubbleDialogProjectId(currentProject.id));
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
    knowledgeExtractionCanvasSelection;
  const isKnowledgeExtractionTargetSelection =
    knowledgeExtractionCanvasSelection !== null;
  const discussionOverlay =
    typeof overlaySlots?.discussion === 'function'
      ? overlaySlots.discussion(discussionVisibility)
      : overlaySlots?.discussion;
  const isDiscussionVisible =
    (discussionVisibility.visibleDiscussion !== null &&
      !isKnowledgeExtractionTargetSelection) ||
    discussionPendingDeletion !== null;
  const visibleDiscussionDeleteTarget =
    discussionVisibility.visibleDiscussion?.kind === 'persisted'
      ? {
          id: discussionVisibility.visibleDiscussion.discussionId,
          title: discussionVisibility.visibleDiscussion.title,
        }
      : null;

  // The rail is inert behind a discussion or a canvas multi-selection, so the
  // shortcut stays with whatever owns the screen then.
  useEffect(() => {
    if (isDiscussionVisible || resolvedCanvasMultiSelection) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isPrimaryShortcut(event, 'b')) {
        return;
      }

      event.preventDefault();
      togglePanelCollapsed('shortcut');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDiscussionVisible, resolvedCanvasMultiSelection, togglePanelCollapsed]);
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
  const workspaceSaveStatus: ProjectDescriptionSaveStatus =
    descriptionStatus === 'error' || canvasSaveStatus === 'error'
      ? 'error'
      : descriptionStatus === 'saving' || canvasSaveStatus === 'saving'
        ? 'saving'
        : descriptionStatus === 'dirty' || canvasSaveStatus === 'dirty'
          ? 'dirty'
          : 'saved';
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
        <ProjectBar
          bubbleCount={availableBubbles.length}
          project={currentProject}
          saveStatus={workspaceSaveStatus}
          territoryCount={visibleTerritoryCount}
        />

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
            createBubbleDialogOpen={
              createBubbleDialogProjectId === currentProject.id
            }
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
            requestTerritoryCreate={requestTerritoryCreate}
            requestTerritoryDelete={requestTerritoryDelete}
            requestTerritoryRename={requestTerritoryRename}
            requestViewportUpdate={requestViewportUpdate}
            requestTerritoryVisibleCountUpdate={
              requestTerritoryVisibleCountUpdate
            }
            onBubbleSelectionChange={handleBubbleSelectionChange}
            onBubbleReaderOpen={(bubble) => setReaderBubbleId(bubble.id)}
            onCreateBubbleDialogOpenChange={(open) =>
              setCreateBubbleDialogProjectId(
                open ? currentProject.id : null,
              )
            }
            onSaveStatusChange={setCanvasSaveStatus}
            onStartDiscussion={startDiscussionFromCanvas}
            viewportSaveDelayMs={viewportSaveDelayMs}
            visibleCountSaveDelayMs={visibleCountSaveDelayMs}
          />

          <WorkspaceSidebar
            activeView={activePanel}
            analyticsClient={analyticsClient}
            availableBubbles={availableBubbles}
            bubbleLinkLoadState={bubbleLinkLoadState}
            bubbleSaveDelayMs={bubbleSaveDelayMs}
            descriptionSaveDelayMs={descriptionSaveDelayMs}
            discussionCount={resolvedDiscussionCount}
            discussionsContent={discussionsContent}
            documentLibrary={documentLibrary}
            documentUploadInputRef={documentUploadInputRef}
            inspectorSelection={validInspectorSelection}
            isCollapsed={isPanelCollapsed}
            isDisabled={resolvedCanvasMultiSelection !== null}
            onBubbleDeleted={handleBubbleDeleted}
            onBubbleLinkCreated={handleBubbleLinkCreated}
            onBubbleLinkRemoved={handleBubbleLinkRemoved}
            onBubbleUpdated={handleBubbleUpdated}
            onDescriptionStatusChange={setDescriptionStatus}
            onProjectSaved={setCurrentProject}
            onRetryBubbleLinks={handleRetryBubbleLinks}
            onSelectPanel={selectPanel}
            onToggleCollapsed={togglePanelCollapsed}
            panelSlots={panelSlots}
            project={currentProject}
            requestBubbleDelete={requestBubbleDelete}
            requestBubbleLinkCreate={requestBubbleLinkCreate}
            requestBubbleLinkDelete={requestBubbleLinkDelete}
            requestBubbleUpdate={requestBubbleUpdate}
            requestDescriptionUpdate={requestDescriptionUpdate}
            requestDocument={requestDocument}
            selectedBubble={selectedBubble}
          />
        </div>

        {discussionOverlay ??
          (discussionVisibility.visibleDiscussion &&
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
                onCreateBubble={createBubbleFromDiscussion}
                onDelete={openDiscussionDeleteConfirmation}
                onMinimize={minimizeDiscussion}
                projectId={currentProject.id}
                requests={discussionLifecycleRequests}
                sourceCatalog={discussionSourceCatalog}
                onUploadDocument={uploadDocumentFromCanvas}
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
        {readerBubble && !isDiscussionVisible && (
          <BubbleReaderModal
            bubble={readerBubble}
            linkedTitles={readerLinkedTitles}
            onClose={() => setReaderBubbleId(null)}
            onEdit={() => {
              setReaderBubbleId(null);
              handleBubbleSelectionChange(readerBubble);
            }}
          />
        )}
      </main>
    </CurrentProjectDescriptionContext.Provider>
  );
}

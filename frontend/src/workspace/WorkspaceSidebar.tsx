import {
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import {
  CircleDot,
  FileText,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Search,
  type LucideIcon,
} from 'lucide-react';
import type { Bubble, BubbleLink, Project } from '../api';
import type { AnalyticsClient } from '../analytics';
import {
  BubbleInspector,
  type BubbleDeleteRequest,
  type BubbleLinkCreateRequest,
  type BubbleLinkDeleteRequest,
  type BubbleUpdateRequest,
} from '../bubbles/BubbleInspector';
import {
  DocumentsPanel,
  type DocumentDetailRequest,
  type DocumentLibraryController,
} from '../documents';
import {
  ProjectDescriptionEditor,
  type ProjectDescriptionSaveStatus,
  type ProjectDescriptionUpdateRequest,
} from '../projects/ProjectDescriptionEditor';
import { focusRing } from '../ui/focusRing';
import { primaryShortcutLabel } from '../ui/keyboardShortcut';
import type { WorkspacePanelView } from './panelModel';

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

export type BubbleLinkLoadState =
  | { status: 'loading'; links: BubbleLink[] }
  | { status: 'ready'; links: BubbleLink[] }
  | { status: 'error'; links: BubbleLink[] };

/** `reveal` reopens a collapsed panel; `keep-collapsed` only moves the tab. */
export type PanelSelectionMode = 'reveal' | 'keep-collapsed';

export type PanelCollapseSource = 'rail_toggle' | 'panel_tab' | 'shortcut';

interface PanelDefinition {
  view: WorkspacePanelView;
  label: string;
  icon: LucideIcon;
}

const panelDefinitions: PanelDefinition[] = [
  { view: 'discussions', label: 'Discussions', icon: MessageSquare },
  { view: 'documents', label: 'Documents', icon: FileText },
  { view: 'project', label: 'Project', icon: CircleDot },
  { view: 'inspector', label: 'Inspector', icon: Search },
];

const panelShortcutLabel = primaryShortcutLabel('b');

export interface WorkspaceSidebarProps {
  activeView: WorkspacePanelView;
  analyticsClient: AnalyticsClient;
  availableBubbles: Bubble[];
  bubbleLinkLoadState: BubbleLinkLoadState;
  bubbleSaveDelayMs?: number;
  descriptionSaveDelayMs?: number;
  discussionCount: number;
  discussionsContent: ReactNode;
  documentLibrary: DocumentLibraryController;
  documentUploadInputRef: Ref<HTMLInputElement>;
  inspectorSelection: WorkspaceInspectorSelection | null;
  isCollapsed: boolean;
  isDisabled: boolean;
  onBubbleDeleted: (bubble: Bubble) => void;
  onBubbleLinkCreated: (link: BubbleLink) => void;
  onBubbleLinkRemoved: (link: BubbleLink) => void;
  onBubbleUpdated: (bubble: Bubble) => void;
  onDescriptionStatusChange: (status: ProjectDescriptionSaveStatus) => void;
  onProjectSaved: (project: Project) => void;
  onRetryBubbleLinks: () => void;
  onSelectPanel: (
    view: WorkspacePanelView,
    mode?: PanelSelectionMode,
  ) => void;
  onToggleCollapsed: (source: PanelCollapseSource) => void;
  panelSlots?: WorkspacePanelSlots;
  project: Project;
  requestBubbleDelete?: BubbleDeleteRequest;
  requestBubbleLinkCreate?: BubbleLinkCreateRequest;
  requestBubbleLinkDelete?: BubbleLinkDeleteRequest;
  requestBubbleUpdate?: BubbleUpdateRequest;
  requestDescriptionUpdate?: ProjectDescriptionUpdateRequest;
  requestDocument?: DocumentDetailRequest;
  selectedBubble: Bubble | null;
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
  analyticsClient,
  availableBubbles,
  bubbleLinkLoadState,
  bubbleSaveDelayMs,
  descriptionSaveDelayMs,
  discussionCount,
  discussionsContent,
  documentLibrary,
  documentUploadInputRef,
  inspectorSelection,
  isCollapsed,
  onBubbleDeleted,
  onBubbleLinkCreated,
  onBubbleLinkRemoved,
  onBubbleUpdated,
  onDescriptionStatusChange,
  onProjectSaved,
  onRetryBubbleLinks,
  panelSlots,
  project,
  requestBubbleDelete,
  requestBubbleLinkCreate,
  requestBubbleLinkDelete,
  requestBubbleUpdate,
  requestDescriptionUpdate,
  requestDocument,
  selectedBubble,
}: Omit<
  WorkspaceSidebarProps,
  'isDisabled' | 'onSelectPanel' | 'onToggleCollapsed'
>) {
  const activeDefinition = panelDefinitions.find(
    ({ view }) => view === activeView,
  )!;
  const hasDefaultProjectEditor = panelSlots?.project === undefined;
  const inspectorContent =
    activeView === 'inspector' &&
    inspectorSelection &&
    panelSlots?.inspector !== undefined
      ? typeof panelSlots.inspector === 'function'
        ? panelSlots.inspector(inspectorSelection)
        : panelSlots.inspector
      : undefined;

  return (
    <section
      // Collapsing keeps the panel mounted so in-flight edits and their pending
      // saves survive the round trip; only the rail stays on screen.
      className={
        isCollapsed
          ? 'hidden'
          : 'flex w-[min(336px,calc(100vw-52px))] shrink-0 flex-col border-l border-[#e1e6ec] bg-white sm:w-[336px]'
      }
      aria-labelledby={`workspace-panel-tab-${activeView}`}
      hidden={isCollapsed}
      id="workspace-active-panel"
      role="tabpanel"
    >
      <header className="flex min-h-[50px] items-center gap-2 border-b border-[#eef1f5] px-[18px] py-[13px]">
        <h2 className="text-sm font-semibold text-[#1e2733]">
          {activeDefinition.label}
        </h2>
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
      {activeView === 'project' &&
        !hasDefaultProjectEditor &&
        panelSlots?.project}
      {activeView === 'discussions' && discussionsContent}
      {activeView === 'documents' &&
        (panelSlots?.documents ?? (
          <DocumentsPanel
            analyticsClient={analyticsClient}
            controller={documentLibrary}
            projectId={project.id}
            requestDocument={requestDocument}
            uploadInputRef={documentUploadInputRef}
          />
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

export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  const {
    activeView,
    isCollapsed,
    isDisabled,
    onSelectPanel,
    onToggleCollapsed,
  } = props;
  const panelButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handlePanelKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | undefined;

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = (index + 1) % panelDefinitions.length;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex =
        (index - 1 + panelDefinitions.length) % panelDefinitions.length;
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
    // Roving the rail is navigation, not a request to reopen the panel.
    onSelectPanel(nextDefinition.view, 'keep-collapsed');
    panelButtonRefs.current[nextIndex]?.focus();
  }

  return (
    <aside
      className={`flex shrink-0 bg-white transition-opacity duration-150 motion-reduce:transition-none ${
        isDisabled ? 'pointer-events-none opacity-40' : ''
      }`}
      aria-label="Project tools"
      aria-hidden={isDisabled ? 'true' : undefined}
      inert={isDisabled ? true : undefined}
    >
      <div className="flex w-[52px] shrink-0 flex-col items-center gap-2 border-l border-[#e1e6ec] bg-white py-3">
        <button
          className={`grid size-[38px] cursor-pointer place-items-center rounded-[10px] bg-transparent text-[#8b97a6] transition-colors duration-150 hover:bg-[#f6f8fc] hover:text-[#5c6a7a] motion-reduce:transition-none ${focusRing}`}
          type="button"
          aria-controls="workspace-active-panel"
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? 'Show panel' : 'Hide panel'}
          data-workspace-panel-toggle
          title={`${isCollapsed ? 'Show panel' : 'Hide panel'} (${panelShortcutLabel})`}
          onClick={() => onToggleCollapsed('rail_toggle')}
        >
          {isCollapsed ? (
            <PanelRightOpen
              className="size-[18px]"
              strokeWidth={1.7}
              aria-hidden="true"
            />
          ) : (
            <PanelRightClose
              className="size-[18px]"
              strokeWidth={1.7}
              aria-hidden="true"
            />
          )}
        </button>

        <span
          className="h-px w-6 shrink-0 bg-[#e1e6ec]"
          aria-hidden="true"
        />

        <nav
          className="flex flex-col items-center gap-1"
          aria-label="Workspace panels"
          aria-orientation="vertical"
          role="tablist"
        >
          {panelDefinitions.map(({ view, label, icon: Icon }, index) => {
            const isActive = activeView === view;
            const isOpen = isActive && !isCollapsed;

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
                aria-expanded={isOpen}
                aria-selected={isActive}
                data-active={isActive ? 'true' : 'false'}
                id={`workspace-panel-tab-${view}`}
                role="tab"
                tabIndex={isActive ? 0 : -1}
                title={label}
                onClick={() => {
                  if (isActive) {
                    onToggleCollapsed('panel_tab');
                    return;
                  }

                  onSelectPanel(view);
                }}
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
                <Icon
                  className="size-[19px]"
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </nav>
      </div>

      <WorkspacePanel {...props} />
    </aside>
  );
}

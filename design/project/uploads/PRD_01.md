# PRD 01 — Project Workspace

## Problem

Before users can build reusable project knowledge, they need a stable workspace that is quick to create, easy to reopen, and understandable without onboarding overhead.

The workspace must provide a consistent shell for the canvas, discussions, documents, project description, and contextual inspection. It must also avoid generating content or imposing a structure before the user has begun thinking. A new project should feel ready for work, not pre-populated with AI assumptions.

This PRD owns project creation, project-level metadata, the main project shell, project description editing, and the shared right-panel navigation. Canvas interactions, discussion behavior, context selection, extraction, and document processing are owned by their respective feature PRDs.

## Target Users and Feature Impact

- **Primary user:** An individual beginning or continuing a new, complex project through repeated AI-assisted exploration.
- **User need:** Create a project with minimal setup, understand where project information lives, and return to the same working state later.
- **Feature impact:** This is the entry point and navigation foundation for all other MVP capabilities. Bubble canvas, discussion, context, extraction, and document features depend on the project workspace and its project identifier, description, routing, persistence, and panel shell.

## Success criteria

1. A user can create a project by providing a title and short description without completing a questionnaire or supplying any additional information.
2. Immediately after creation, the user lands on that project's empty canvas with no AI-generated bubbles, assumptions, goals, risks, questions, discussions, or documents.
3. The empty workspace presents entry points to start a discussion, create a bubble manually, and upload a document; each action opens the corresponding feature flow without leaving the project.
4. A user can leave the newly created project and later reopen the same project through the application's project-entry surface.
5. Reopening a project always opens the project canvas rather than automatically reopening a previous discussion modal.
6. The project title and current project description remain unchanged after a page reload or reopening the project in a later session.
7. A user can open the Project view in the right panel, edit the project description, save the change, reload the project, and see the saved description.
8. A project-description edit affects only discussions created after the edit; existing discussions retain the project-description snapshot captured when they were created.
9. The project screen contains one right-side panel with icon controls for Discussions, Documents, Project, and Inspector views.
10. Selecting a right-panel icon replaces the panel's content without changing the panel's position or width and without navigating away from the current project.
11. At most one right-panel view is displayed at a time, and the active icon has a distinct visual state.
12. The Discussions view can receive and display the project's discussion list, the Documents view can receive and display the project's document list, the Project view displays the description editor, and the Inspector view can display the currently selected inspectable item.
13. When no bubble or context badge is selected, the Inspector view presents an explicit empty state rather than stale details from a previous selection.
14. Creating or editing the project updates its `updated_at` value, and the project-entry surface can use that value to order or label projects consistently.
15. Analytics record project creation, project opening, project-description editing, right-panel view changes, and empty-state action selection with the correct project identifier.

## Scope

### In scope

- **Project creation UI:** Build a minimal creation flow containing a required project title and required short description. Do not add a guided questionnaire, templates, suggested goals, or AI-generated setup content.
- **Project creation API:** Add the command or endpoint that validates input, creates the project record, initializes timestamps and default canvas viewport values, and returns the identifier required to open the project workspace.
- **Project persistence model:** Implement the project fields `id`, `title`, `description`, `created_at`, `updated_at`, `canvas_viewport_x`, `canvas_viewport_y`, and `canvas_zoom`. Canvas-specific behavior is owned by the Bubble Canvas PRD, but the project record stores its persisted viewport state.
- **Project-entry surface:** Provide the minimum application-level mechanism required to create a project and reopen an existing one. The exact presentation may be a compact project list or equivalent entry view, but it must not become a project-management dashboard.
- **Project routing:** Add stable routing or navigation for opening a project by identifier. Entering a project resolves to the canvas workspace rather than a discussion-specific route.
- **Project workspace shell:** Build the layout container that hosts the canvas, discussion overlay, persistent primary actions, and right-side panel integration points.
- **Empty-project state:** Display an empty canvas with clear actions to start a discussion, create a bubble manually, or upload a document. These actions delegate to the owning feature modules.
- **Project description editor:** Add a Project panel view that loads, edits, validates, and persists the current description. The editor must expose saving progress, success, and failure clearly enough to prevent silent data loss.
- **Description integration contract:** Expose the current project description to the Discussion Context feature so each new discussion can capture it. Existing frozen discussion context must not be updated when the description changes.
- **Right-panel shell:** Implement a single stable right-side panel with icon-based switching between Discussions, Documents, Project, and Inspector. Only the Project view's internal feature behavior is implemented here; other views receive their content from their owning PRDs.
- **Panel state management:** Track the active panel view and selected inspectable item within the project workspace. Clear or replace Inspector content when selection changes or becomes invalid.
- **Feature integration interfaces:** Define typed interfaces or equivalent contracts for the Discussions list, Documents list, Project editor, and Inspector content so feature modules can populate the common shell without duplicating panel infrastructure.
- **Loading, empty, and error states:** Handle project creation, project loading, missing or inaccessible project identifiers, project-description save failures, and empty panel content.
- **Analytics:** Instrument project creation, project opening, description updates, panel-view switches, and empty-state action selection.

### Out of scope

- Bubble creation, editing, deletion, linking, selection, positioning, compact layout, pan, or zoom behavior
- Discussion message UI, AI responses, AI-generated titles, minimization, Active state, reopening, or deletion
- Bubble or document context selection and frozen-context creation
- Knowledge-extraction entry points, proposal generation, review, approval, update, or rejection
- Document upload processing, text extraction, inspection, deletion, or context serialization
- Search across projects or project contents
- Project folders, tags, favorites, sorting controls, filters, or dashboards
- Project templates, example projects, AI-generated starter bubbles, or guided onboarding questionnaires
- Project duplication, export, import, archiving, or deletion
- Team workspaces, project sharing, roles, or permissions
- User profiles, billing, account administration, or organization management
- Customizable panel layouts, detachable panels, multiple simultaneous side panels, or user-resizable panel behavior unless separately specified
- Restoring an automatically open discussion when entering a project
- Global command palette or keyboard-navigation system beyond basic accessible controls

## Risks / Open Questions

- **Project-entry surface is underspecified:** The source MVP requires users to reopen projects but does not define whether the application opens the last project automatically or presents a project list. This affects routing and first-run architecture. The current leaning is a minimal project list showing title and last-updated time, with a Create project action.
- **Description saving model:** Autosave reduces explicit work but creates ambiguity around failures and partially typed text; an explicit Save action is clearer but adds friction. The current leaning is debounced autosave with an unambiguous saving/saved/error indicator, provided failed edits remain recoverable in the editor.
- **Panel default view:** The product defines available views but not which one appears when a project opens. Choosing Discussions may overemphasize chat; choosing Project may waste space after setup. The current leaning is Discussions when the project has discussions and Project for a completely new project, but this should be validated against the desired canvas-first feel.
- **Panel width:** A stable width is required when switching views, but the actual width and small-screen behavior are undefined. The wrong choice may constrain document inspection or obscure too much canvas. The implementation should define responsive breakpoints before feature panels are built.
- **Title editing:** The project description is explicitly editable, but the source requirements do not state whether project titles can be renamed. Adding title editing is small technically but changes the acceptance contract. The current leaning is to keep title editing out of this PRD until explicitly included.
- **Project deletion:** Deleting discussions and bubbles is specified elsewhere, but project deletion is not. Implementing it without recovery semantics risks accidental loss of the entire workspace. It remains out of scope until confirmation and retention behavior are defined.
- **Empty-state ownership:** The workspace should expose three starting actions, but their components are implemented by separate feature PRDs. Without stable integration contracts, each feature may create competing entry points. This PRD should own placement and visual hierarchy; feature PRDs should own the launched flow.
- **Inspector selection lifecycle:** The Inspector can display bubble details or frozen context, but those selections originate in other features. The shell must avoid showing stale content when an item is deleted, a modal closes, or the active discussion changes. The leaning is to clear invalid selection automatically and show an explicit empty state.
- **`updated_at` semantics:** Ordering projects by latest activity requires deciding which actions update the project timestamp. Updating it for every pan or zoom could create noisy ordering; updating it only for metadata edits would ignore meaningful work. The shared analytics and persistence design should define a limited set of meaningful project-activity events before implementation.

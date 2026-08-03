# PRD 02 — Bubble Canvas

## Problem

Nuée replaces long conversation history as the primary project memory with a visual collection of durable knowledge bubbles. For that model to work, users need a canvas where knowledge remains easy to see, arrange, inspect, edit, connect, and reuse without turning organization into a separate job.

The canvas must support free spatial organization while making no claim that position carries semantic meaning. It must also remain stable across sessions: bubbles, links, positions, zoom, and viewport cannot feel temporary or unreliable.

This PRD owns the infinite canvas, bubble presentation and lifecycle, manual links, selection primitives, compact layout, and persistence of canvas state. Starting discussions with selected bubbles, creating frozen context, and reviewing extraction proposals are owned by their respective PRDs.

## Target Users and Feature Impact

- **Primary user:** An individual exploring a new, complex project who wants durable project knowledge to remain more visible and reusable than messages in a conventional AI conversation.
- **User need:** See what knowledge exists, arrange it according to personal preference, inspect and refine individual ideas, and select relevant bubbles for later work.
- **Feature impact:** The canvas is Nuée's primary project-memory surface. Manual bubble creation, approved extraction results, discussion context selection, and future knowledge refinement all depend on its bubble model, placement behavior, selection state, and persistence interfaces.

## Success criteria

1. Opening a project displays its bubble canvas as the primary workspace surface, including when the project contains no bubbles.
2. A user can pan the canvas independently of the browser page and zoom in or out using supported pointer or trackpad controls.
3. After the user changes the canvas viewport or zoom level, reloads the project, and reopens it, the last successfully persisted viewport and zoom level are restored.
4. A user can create a bubble directly from the canvas by providing a non-empty title and non-empty content without first starting a discussion.
5. A manually created bubble may include an optional summary; when no summary is provided, the bubble card displays a deterministic preview derived from the beginning of its content.
6. A newly created bubble appears within the user's visible working area and can be moved immediately after creation.
7. Every bubble card displays enough information to distinguish it from nearby bubbles, including at minimum its title and summary or content preview.
8. Selecting a bubble gives that bubble a distinct primary visual state and exposes its complete title, summary, content, source information when available, and last content-updated date through the Inspector integration.
9. When exactly one bubble is selected, its manually linked bubbles receive a distinct secondary linked state and unrelated bubbles do not change appearance.
10. Manual links are not rendered as permanent connecting lines on the canvas.
11. A user can move a bubble to a new canvas position, reload the project, and find the bubble at the last successfully persisted position.
12. Moving one bubble does not change the stored position of another bubble unless the user invokes Compact layout.
13. A user can edit an existing bubble's title, summary, and content, save the edit, reload the project, and see the saved values.
14. Editing a bubble changes its content `updated_at` timestamp but does not alter the frozen content stored in discussions created before the edit.
15. A user can delete a bubble; after deletion, it no longer appears on the canvas after reload and no bubble-link record continues to reference it.
16. Deleting a bubble does not delete its source discussion, discussion messages, other bubbles, or frozen copies already stored in existing discussions.
17. A user can manually create a link between two bubbles in the same project and later remove that link.
18. Creating or removing a link is reflected when either linked bubble is selected and remains correct after reloading the project.
19. The system prevents duplicate link records representing the same pair of bubbles, regardless of the order in which the two bubble identifiers are supplied.
20. A user can select more than one bubble when the canvas is placed into a multi-selection flow by an owning feature such as Discussion Context.
21. In multi-selection mode, selected bubble identifiers can be handed to the initiating feature without copying or mutating bubble content.
22. Cancelling a multi-selection flow restores the previous normal canvas interaction state without changing bubble data or positions.
23. A persistent Compact layout action is available whenever the project contains at least two bubbles.
24. Invoking Compact layout repositions bubbles into a denser readable cluster, preserves a configured minimum gap between cards, and produces no overlapping bubble rectangles.
25. Compact layout changes only bubble positions; it does not modify bubble titles, summaries, contents, links, sources, or content `updated_at` timestamps.
26. Running Compact layout on an unchanged set of bubbles more than once does not continually move bubbles after a valid compact arrangement has been reached.
27. The canvas exposes a placement interface that allows a newly approved extraction result to be positioned near the existing bubble cluster without the Extraction feature implementing canvas geometry itself.
28. All bubble mutations reject cross-project references: a bubble cannot be positioned, linked, edited, selected for handoff, or deleted through a different project's canvas.
29. Loading, saving, or layout failures produce a visible recoverable error state and do not silently replace the last successfully persisted bubble or canvas data.
30. Analytics record manual bubble creation, bubble inspection, content editing, deletion, movement, link creation and removal, multi-selection completion, and Compact layout use with the correct project and bubble identifiers.

## Scope

### In scope

- **Canvas rendering surface:** Implement an effectively infinite two-dimensional workspace that fills the central project area and supports bubble rendering, pan, zoom, selection, dragging, and integration with the project workspace shell.
- **Canvas interaction controller:** Handle pointer, mouse, and trackpad interactions without allowing canvas gestures to unintentionally scroll or zoom the surrounding application. Define interaction precedence between panning, bubble dragging, normal selection, and feature-initiated multi-selection.
- **Viewport persistence:** Read and write `canvas_viewport_x`, `canvas_viewport_y`, and `canvas_zoom` on the project record. Use throttled or debounced persistence so continuous gestures do not create excessive writes, and flush the latest stable state when practical before navigation.
- **Bubble card component:** Render a consistent movable card containing the bubble title and one-sentence summary or deterministic content preview. Provide visual states for default, hover, primary selection, secondary linked selection, dragging, saving, and error conditions.
- **Bubble details integration:** Supply the selected bubble's complete synthesized content and metadata to the Inspector view owned by the Project Workspace PRD. Clear or refresh Inspector data when the selected bubble changes, is edited, or is deleted.
- **Manual bubble creation flow:** Add a canvas entry point for creating a bubble with required `title` and `content` fields and an optional `summary`. Validate whitespace-only input and preserve entered content when a recoverable save error occurs.
- **Bubble persistence model:** Implement the bubble fields `id`, `project_id`, `title`, `summary`, `content`, `position_x`, `position_y`, `created_at`, `updated_at`, `source_kind`, `source_discussion_id`, and `source_message_ids`. Manual bubbles may use an internal manual `source_kind` without requiring a visible “Created manually” label.
- **Bubble CRUD API:** Add project-scoped commands or endpoints to create, read, update, reposition, and delete bubbles. Separate content edits from high-frequency position updates so layout changes do not incorrectly present as knowledge revisions.
- **Manual creation placement:** Place a manually created bubble within the current visible working area using a deterministic non-overlapping placement rule. The precise anchor—viewport center, selected canvas point, or creation-control origin—must be consistent within the implemented flow.
- **External placement service:** Expose a project-scoped placement operation for bubbles created by other features. The Knowledge Extraction PRD can request placement near the current cluster, but this PRD owns collision avoidance and position persistence.
- **Bubble dragging:** Update the bubble visually during drag, resolve the final canvas coordinates, persist the final position, and recover cleanly if the save fails.
- **Bubble editing flow:** Allow direct editing of `title`, `summary`, and `content` from the bubble details experience. Saved edits replace the current visible version; no version-history interface is introduced.
- **Frozen-context compatibility:** Ensure edits and deletion affect the current bubble record only. Existing discussions continue to use their stored context snapshots and must not dereference live bubble content when rendered or sent to the AI.
- **Bubble deletion:** Remove the bubble from the current project and remove all manual link records involving it. Provide the hooks needed for the Inspector and selection controller to clear invalid state.
- **Selection state:** Support one primary selected bubble during normal browsing and an explicit multi-selection mode initiated by another feature. Selection is transient UI state and is not persisted between project sessions.
- **Selection handoff contract:** Return selected bubble identifiers and current live records to the Discussion Context feature at confirmation time. Frozen snapshots are not created by the canvas; they are created when the discussion begins.
- **Bubble-link persistence model:** Implement project-scoped symmetric manual links using `id`, `project_id`, `bubble_a_id`, `bubble_b_id`, and `created_at`, with canonical ordering or an equivalent uniqueness constraint.
- **Link-management UI:** Provide a way to add and remove manual links while inspecting or editing a bubble. Candidate bubbles must come from the same project, and the bubble cannot be linked to itself.
- **Linked highlighting:** When one bubble is selected in normal mode, derive its direct manual links and apply the secondary linked visual state. Do not recursively highlight links of links unless separately specified later.
- **Compact layout engine:** Add a persistent action and deterministic layout operation that moves the current project's bubbles into a denser, readable, non-overlapping cluster while retaining stable ordering where practical.
- **Compact layout persistence:** Persist every changed bubble position as one logical operation, prevent partial UI state from being mistaken for a successful layout, and restore the last successfully saved arrangement after failure or reload.
- **Canvas loading and empty states:** Render the empty canvas, bubble-loading state, partial failure handling, and retry paths without replacing the project shell or navigating the user elsewhere.
- **Performance baseline:** Keep pan, zoom, selection, and drag interactions responsive for the expected MVP project size. The exact supported bubble count should be established through an implementation benchmark rather than presented as unlimited scale.
- **Analytics:** Instrument bubble creation source, inspection, edit, delete, drag completion, link changes, Compact layout, multi-selection start/cancel/confirm, and canvas viewport restoration. Do not log full bubble content in analytics payloads.

### Out of scope

- Starting, rendering, minimizing, reopening, or deleting discussions
- Generating AI responses or AI-created discussion titles
- Deciding when context selection is offered or converting selected bubbles into frozen discussion context
- Adding, removing, or changing context after a discussion starts
- Knowledge-extraction message selection, synthesis, proposal review, approval, update choice, or rejection
- Automatically creating bubbles from conversations or documents without explicit user approval
- Document upload, document inspection, document placement on the canvas, or bubble-to-document links
- Automatic bubble links, link recommendations, relationship labels, or link direction visible to the user
- Permanent connection lines, graph edges, node physics, force-directed layout, or semantic spatial positioning
- Bubble types, confidence levels, statuses, tags, concepts, or other classification metadata
- Search, filtering, sorting controls, minimaps, named groups, swimlanes, sections, or large-canvas overview modes
- Duplicate-bubble detection, merge flows, contradiction detection, or knowledge audits
- Bubble version history, revision comparison, undo history across sessions, or stale-context warnings
- Importing an existing knowledge graph or automatically arranging a large legacy knowledge base
- Real-time collaborative cursors, concurrent multi-user editing, permissions, or shared selections
- Persisting selection state, hovered state, open editors, or Inspector state between sessions
- Assigning semantic meaning to bubble coordinates or using position to influence AI context selection
- Mobile-first canvas interactions or specialized touch-only gestures unless separately specified

## Risks / Open Questions

- **Manual freedom versus rapid canvas disorder:** Free placement supports personal working memory, but users may quickly create an unreadable surface. Compact layout is the only MVP recovery mechanism. The current leaning is to preserve unrestricted movement and measure how soon users ask for groups, search, minimaps, or stronger layout assistance.
- **Manual creation anchor:** A new manual bubble could appear at the viewport center, at a clicked canvas coordinate, or near the existing cluster. Each option has different discoverability and predictability. The current leaning is viewport-centered placement with collision avoidance because manual creation begins from the user's current area of attention.
- **Card information density:** Showing only a title may be too ambiguous; showing too much content makes the canvas noisy. The current leaning is title plus one-sentence summary or short content preview, with full content in the Inspector.
- **Bubble dimensions:** Fixed-size cards simplify collision detection and compact layout but truncate more content; content-responsive cards improve scanning but can make layouts unstable after edits. The implementation must define size constraints before the layout algorithm is finalized. The current leaning is constrained width and height with preview truncation.
- **Autosave versus explicit save for content edits:** Autosave reduces friction but makes partial edits and failure recovery harder to understand. Explicit save is safer but more administrative. The current leaning should remain consistent with the Project description editor unless usability testing shows bubble editing needs a different model.
- **Deletion safety:** Bubble deletion is required, but confirmation, undo, and soft deletion are not defined. Immediate hard deletion risks accidental knowledge loss; mandatory confirmation adds friction. The current leaning is a confirmation step that clearly states existing frozen discussion context will remain, without building a full trash or recovery system.
- **Position-save failure:** Optimistically moving a card feels responsive, but a failed persistence request can leave the visible and stored positions inconsistent. The leaning is optimistic dragging with a visible save failure and retry, while retaining the unsaved local position until the user leaves or explicitly reverts.
- **Meaning of `updated_at`:** Position changes occur frequently and should not make a bubble look newly revised. The current leaning is for bubble `updated_at` to represent title, summary, or content changes only, while position persistence uses separate write metadata or no user-visible timestamp change.
- **Compact-layout determinism:** A perfectly optimal packing algorithm is unnecessary, but unstable results will erode spatial memory. The current leaning is a deterministic grid or masonry-style layout ordered by existing spatial order or creation time, rather than force simulation.
- **Compact-layout transaction size:** Repositioning many bubbles can require many writes. Individual requests risk partial success; one batch request is more coherent but requires backend support. The current leaning is a project-scoped batch-position endpoint with transactional behavior where the datastore permits it.
- **Multi-selection interaction:** Modifier-key selection is efficient for desktop users but hidden; an explicit context-selection state is clearer but interrupts normal navigation. Since multi-selection primarily serves discussion context, the current leaning is an explicit mode initiated by that feature, with optional conventional modifier-key support only if it does not introduce ambiguity.
- **Selection and linked highlighting during multi-selection:** Highlighting both selected context candidates and manually linked bubbles could confuse users. The current leaning is to suppress secondary linked highlighting while multi-selection mode is active unless a linked bubble is itself selected.
- **Direct links only versus transitive neighborhoods:** Highlighting all reachable bubbles may create visual noise and imply a semantic graph the MVP does not support. The current leaning is to highlight only directly linked bubbles.
- **Expected scale:** “Infinite canvas” describes navigation, not capacity. Without a stated performance target, implementation choices may be either over-engineered or inadequate. Before release, the team should establish an expected upper bound for MVP testing based on observed projects and benchmark that many visible cards.
- **Concurrent edits across tabs:** Two open tabs could overwrite bubble content or position with stale data. Full collaborative conflict resolution is out of scope, but silent last-write-wins may surprise users. The current leaning is optimistic concurrency for content edits when feasible and last-write-wins for viewport and position updates.

## Commit Plan

The commits below are ordered so each one leaves the application in a coherent state and establishes contracts needed by the next slice. The design references are `1.c` (populated canvas inside the project shell), `3.a` (bubble selected with primary and secondary-linked states), `3.b` (manual create dialog and delete confirmation), and `3.c` (feature-initiated multi-selection and the persistent Compact-layout action).

1. **`feat(bubbles): add the persistent bubble domain and API`**
   - Add the migration and entity for `id`, `project_id`, `title`, `summary`, `content`, `position_x`, `position_y`, `created_at`, `updated_at`, `source_kind`, `source_discussion_id`, and `source_message_ids`, with an internal manual `source_kind` for canvas-created bubbles.
   - Add typed project-scoped create, read, update, reposition, and delete operations in NestJS. Keep content edits and position updates on separate endpoints so repositioning never touches `updated_at`.
   - Enforce cross-project rejection from the first commit rather than retrofitting it: a bubble cannot be read, edited, moved, or deleted through another project's routes.
   - Cover field defaults, validation, the content-versus-position split, `updated_at` semantics, cross-project rejection, and missing bubble identifiers with service/controller tests.

2. **`feat(canvas): render the pan-and-zoom canvas surface`**
   - Render the effectively infinite surface inside the project workspace's central area, filling the shell without displacing the project bar, primary actions, or right panel.
   - Add the interaction controller for pointer, mouse, and trackpad pan and zoom, capturing gestures so the surrounding application never scrolls or zooms unintentionally.
   - Add canvas loading, empty, and load-failure/retry states that resolve in place instead of navigating the user away from the project. No bubbles are rendered yet.

3. **`feat(canvas): persist and restore the project viewport`**
   - Write `canvas_viewport_x`, `canvas_viewport_y`, and `canvas_zoom` to the project record with debounced or throttled persistence so continuous gestures do not create excessive writes.
   - Flush the latest stable viewport before navigation and restore it when the project is reopened; viewport-only changes must not reorder the project list.
   - Test restore-after-reload, write coalescing during a continuous gesture, flush-on-navigation, and failure without loss of the last persisted viewport.

4. **`feat(canvas): render bubble cards from the project`**
   - Build the bubble card from design `1.c`: title plus one-sentence summary or a deterministic preview derived from the beginning of the content, with the constrained width and height and preview truncation proposed by this PRD.
   - Load the project's bubbles onto the canvas at their persisted positions and handle partial load failure without replacing already-rendered data.
   - Scaffold the card visual states used by later slices: default, hover, dragging, saving, and error.

5. **`feat(bubbles): create bubbles manually from the canvas`**
   - Implement the manual create dialog from design `3.b` with required `title` and `content`, optional `summary`, whitespace-only validation, and entered values preserved after a recoverable save error.
   - Implement viewport-centered deterministic placement with collision avoidance, so a new bubble lands in the visible working area and can be moved immediately.
   - Build the placement rule as a reusable project-scoped service and expose it as the external placement operation, since the Extraction PRD's requirement is the same geometry and should not reimplement canvas math.
   - Add component and service tests for validation, save failure and retry, deterministic placement, and non-overlapping results.

6. **`feat(canvas): drag bubbles with persisted positions`**
   - Update the card optimistically during drag, resolve final canvas coordinates, and persist the final position through the position endpoint only.
   - On save failure, show a visible recoverable error with retry while retaining the unsaved local position until the user leaves or explicitly reverts.
   - Assert that moving one bubble never changes another bubble's stored position and that a completed drag does not change content `updated_at`.

7. **`feat(bubbles): inspect and edit bubbles through the Inspector`**
   - Add primary selection state with its distinct visual treatment from design `3.a` and supply the selected bubble's full title, summary, content, source information, and last content-updated date through the Inspector slots wired in `a5ac345f`.
   - Implement the title, summary, and content edit flow, keeping the save model consistent with the project-description editor, and refresh or clear Inspector data when the selection changes or the bubble is edited.
   - Guarantee frozen-context compatibility: saved edits replace the current record only and must not alter snapshots stored in existing discussions.
   - Test persisted reloads, `updated_at` semantics, stale-response protection, and Inspector refresh on selection change.

8. **`feat(links): add symmetric manual bubble links`**
   - Add the project-scoped link model with `id`, `project_id`, `bubble_a_id`, `bubble_b_id`, and `created_at`, using canonical ordering or an equivalent constraint so the same pair cannot be stored twice in either argument order.
   - Add link creation and removal from the Inspector, restricted to bubbles in the same project and never to the bubble itself.
   - Apply the secondary linked state from design `3.a` when exactly one bubble is selected, highlighting direct links only and leaving unrelated bubbles unchanged. Links are never drawn as permanent connecting lines.

9. **`feat(bubbles): delete bubbles with link cleanup`**
   - Add the delete confirmation from design `3.b`, stating clearly that existing frozen discussion context is retained.
   - Cascade removal of every link record referencing the deleted bubble, and invalidate Inspector and selection state so no stale details remain.
   - Sequenced after links deliberately so the cascade is built and tested in one place. Assert that deletion leaves source discussions, messages, other bubbles, and frozen copies intact.

10. **`feat(canvas): support feature-initiated multi-selection`**
    - Implement the explicit multi-selection mode from design `3.c`, entered by an owning feature rather than by ambient canvas interaction.
    - Return selected bubble identifiers and live records to the initiating feature at confirmation time without copying or mutating bubble content; frozen snapshots are not created here.
    - Restore the previous normal interaction state on cancel without changing bubble data or positions, and suppress secondary linked highlighting while the mode is active unless a linked bubble is itself selected.
    - Keep this the integration seam the Discussion Context PRD consumes, following the same contract pattern as `a5ac345f`.

11. **`feat(canvas): add the deterministic compact layout`**
    - Add the persistent Compact-layout action from design `3.c`, available whenever the project contains at least two bubbles.
    - Implement a deterministic grid or masonry layout with stable ordering, a configured minimum gap, no overlapping rectangles, and no further movement once a valid arrangement is reached.
    - Add the project-scoped batch position endpoint with transactional behavior where the datastore permits, and roll back to the last saved arrangement on failure so partial UI state is never mistaken for success.
    - Assert that compaction changes positions only, leaving titles, summaries, contents, links, sources, and content `updated_at` untouched.

12. **`feat(analytics): instrument the bubble-canvas funnel`**
    - Emit the PRD's events through the existing typed analytics boundary from `487a1aa5`: manual creation, inspection, edit, delete, drag completion, link creation and removal, multi-selection start/cancel/confirm, Compact layout, and viewport restoration.
    - Attach the correct project and bubble identifiers with minimal event-specific properties, and never log full bubble content in payloads.
    - Add event-contract tests asserting that failed saves emit no success event and that retries do not duplicate events.

13. **`test(bubbles): cover the bubble-canvas journey + end of PRD "Bubble Canvas"`**
    - Add an end-to-end test for `open project → create bubble → move → edit → link → inspect → compact → reload`, mirroring `3e02a33d`.
    - Assert that positions, links, zoom, and viewport survive reload, that deletion cleans up links without touching discussions, and that a cancelled multi-selection leaves the canvas unchanged.
    - Run the repository's build, lint, unit, and end-to-end commands. Visual comparison and final interaction QA remain manual against designs `1.c`, `3.a`, `3.b`, and `3.c`.
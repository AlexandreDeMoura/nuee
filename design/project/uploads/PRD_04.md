# PRD 04 — Discussion Context

## Problem

AI answers depend heavily on the context supplied to the model, but conventional chat products often make that context implicit, unstable, or difficult to inspect. Users may not know which project knowledge influenced an answer, and later edits to source material can silently change the meaning of a continued conversation.

Nuée needs a context model that preserves user control and makes each discussion reproducible. Before a discussion begins, the user may explicitly choose existing bubbles and complete documents. The current project description is always included. When the discussion starts, Nuée captures the selected content as immutable snapshots. The discussion then uses those snapshots for its entire lifetime, even if the original bubbles, documents, or project description are edited or deleted later.

This PRD owns context invitation, bubble and document selection, project-description inclusion, context snapshot creation, frozen-context persistence, context badges, frozen-content inspection, and the immutable-context contract. The Bubble Canvas PRD owns bubble rendering and selection mechanics on the canvas. The Document Library PRD owns document upload, processing, listing, and inspection outside a discussion. The Focused Discussions PRD owns discussion creation, messages, model responses, and the discussion modal.

## Target Users and Feature Impact

- **Primary user:** An individual who wants to reuse selected project knowledge in a focused AI discussion without allowing the system to silently decide or change that context.
- **User need:** Know what information will be supplied to the AI, start with no additional context when appropriate, inspect exactly what a discussion used later, and trust that subsequent source edits will not rewrite the discussion's reasoning state.
- **Feature impact:** Discussion Context is the boundary between the project's current knowledge and a discussion's frozen reasoning state. It consumes live bubbles, documents, and the project description, creates immutable snapshots, supplies those snapshots to Focused Discussions, and exposes them through context badges and the Inspector.

## Success criteria

1. A user can start a discussion without selecting any bubble or document.
2. A discussion started without selected bubbles or documents still receives a frozen snapshot of the current project description.
3. Before a new discussion begins, the user is given a clear opportunity to add bubble or document context or continue without either.
4. A user can select one bubble as context for a new discussion.
5. A user can select several bubbles as context for the same new discussion.
6. A user cannot select a bubble belonging to another project as context.
7. Bubble selection uses the Bubble Canvas feature's explicit selection state and clearly distinguishes selected bubbles from unselected bubbles.
8. A user can cancel bubble-context selection without creating a discussion or changing any bubble.
9. A user can select one complete uploaded document as context for a new discussion.
10. A user can select several complete documents as context for the same new discussion.
11. A user cannot select an individual document passage, page, or excerpt in the MVP.
12. A user cannot select a document belonging to another project as context.
13. A document that has not completed the processing required for model use cannot be silently included as successful context.
14. When document processing is unavailable or failed, the interface identifies the affected document and prevents discussion creation with an incomplete snapshot unless the user removes that document.
15. A user can combine selected bubbles and selected documents in the same discussion context.
16. The user can review the complete list of selected bubbles and documents before confirming discussion creation.
17. Removing an item during pre-discussion selection removes only that pending selection and does not edit or delete the source.
18. The project description is included automatically and cannot be deselected in the MVP.
19. The project description snapshot contains the description value that exists when the discussion is created, not the value that existed when context selection first opened.
20. Each selected bubble snapshot contains the bubble's complete current synthesized content required for AI use when the discussion is created.
21. Each selected document snapshot contains the complete processed document content available when the discussion is created.
22. Context snapshots are created only when the discussion begins; entering, cancelling, or changing the pre-discussion selection state does not create durable frozen-context records.
23. If a selected bubble or document is edited after selection begins but before the discussion is confirmed, the snapshot uses the latest authorized content at confirmation time.
24. If a selected bubble or document is deleted or becomes inaccessible before confirmation, discussion creation stops and the user is told which selection must be removed or reviewed.
25. Discussion creation does not succeed unless the discussion record and all required context snapshots are persisted as one coherent operation or recoverable workflow.
26. After successful creation, the discussion receives exactly one frozen project-description snapshot and one frozen snapshot for each confirmed bubble and document.
27. Repeated clicks or retries during discussion creation do not create duplicate snapshots for the same discussion and source selection.
28. Each frozen context item stores enough source metadata to display its source kind and title even if the live source is later deleted.
29. Editing the project description after discussion creation does not change the frozen project-description content used by that discussion.
30. Editing a selected bubble after discussion creation does not change the bubble content used by that discussion.
31. Editing or replacing a selected document after discussion creation does not change the document content used by that discussion.
32. Deleting a selected bubble or document after discussion creation does not remove its frozen content from an existing non-deleted discussion.
33. Adding new bubbles or documents to the project after discussion creation does not add them to the discussion.
34. A user cannot add context to an existing discussion.
35. A user cannot remove context from an existing discussion.
36. A user cannot replace a frozen context item with its current live version inside the same discussion.
37. A user cannot temporarily disable a frozen context item for one message inside the discussion.
38. To use different context, the user must start a new discussion.
39. Every selected bubble and document is represented by a context badge in the discussion interface after creation.
40. The interface represents the automatically included project description either as a persistent project-context badge or as another explicit indicator that is visible and inspectable.
41. Context badges remain available after minimizing, reopening, or reloading the discussion.
42. Clicking a context badge opens that item's frozen content in the right-side Inspector without closing the discussion.
43. The Inspector clearly identifies the item as frozen discussion context rather than the current editable source.
44. Inspecting frozen context does not navigate the canvas to the live source or replace the frozen content with current source content.
45. When the live source still exists, the MVP may identify its source title or kind, but the displayed discussion-context body remains the frozen snapshot.
46. Context badges accurately reflect every context item supplied to the model; no hidden bubble or document context is added by the product.
47. The model request for every message in the discussion includes the same frozen context package and the discussion's persisted message history.
48. The model request never silently dereferences the current bubble, document, or project-description records in place of stored snapshots.
49. Context items are serialized in a stable, distinguishable format so the model can identify project description, bubble, and document boundaries.
50. If the total selected context cannot be processed within the application's supported model limits, the user is blocked before discussion creation and receives an actionable explanation rather than an incomplete discussion with silently omitted items.
51. Failure to load one frozen context item when reopening a discussion is treated as a data error and is visibly reported; the system does not substitute live content.
52. Frozen-context records are accessible only through their owning project and discussion.
53. Deleting a discussion removes or makes inaccessible its frozen-context records according to the deletion policy defined by Focused Discussions.
54. Selecting or inspecting context does not alter bubble `updated_at`, document `updated_at`, project description content, or canvas positions.
55. Analytics record context-selection entry, cancellation, confirmed bubble count, confirmed document count, no-additional-context creation, snapshot failure, context-badge inspection, and context-size rejection without logging full bubble, document, or project-description content.

## Scope

### In scope

- **Context-selection coordinator:** Implement the pre-discussion flow that lets the user continue with only project context or add bubbles and documents before creating a discussion.
- **Entry-point integration:** Support context selection from the persistent New discussion action, from a bubble or multi-bubble selection on the canvas, and from the write-first discussion flow described by Focused Discussions.
- **No-additional-context path:** Provide a clear path that creates a discussion with only the automatically included project-description snapshot.
- **Pending-selection state:** Maintain transient project-scoped selection state for bubble and document identifiers before confirmation. Pending selections are not durable discussion context and are discarded on cancellation.
- **Bubble-selection integration:** Activate and consume the Bubble Canvas multi-selection mode, display selected states, support removal and cancellation, and receive current authorized bubble records at confirmation time.
- **Document-selection integration:** Allow complete documents to be selected through the Documents panel, reflect selection state consistently across panel views, and verify that each document is ready for model use.
- **Mixed-context review:** Present the pending bubble and document selections together before confirmation, including source titles, source kinds, item counts, and removal controls.
- **Project-description inclusion:** Read the current project description at discussion-creation time and include it as a mandatory frozen context item. An empty description remains a valid explicit snapshot if empty descriptions are allowed by Project Workspace.
- **Authorization and ownership validation:** Confirm that every selected source belongs to the current project and is accessible to the current user immediately before snapshot creation.
- **Live-source revalidation:** Re-fetch or otherwise validate selected sources when the user confirms creation so snapshots do not rely on stale client-side content.
- **Context-package builder:** Normalize the current project description, selected bubble content, and processed document text into a typed package with stable ordering and clear boundaries.
- **Frozen-context persistence model:** Implement records containing at minimum `id`, `discussion_id`, `source_kind`, `source_id` where retained, `source_title`, `frozen_content`, `created_at`, and a stable display or serialization order.
- **Supported source kinds:** Support `project_description`, `bubble`, and `document`. Additional source kinds require a later PRD.
- **Snapshot uniqueness:** Prevent duplicate frozen-context records caused by repeated creation requests. The same source should appear at most once in one discussion unless a future use case explicitly supports duplicates.
- **Atomic discussion handoff:** Coordinate with Focused Discussions so a discussion is not presented as successfully created without its complete required frozen-context package. Use a transaction where practical or an idempotent recoverable workflow otherwise.
- **Creation idempotency:** Associate context confirmation with a client or server idempotency key so network retries cannot create duplicate discussions or context snapshots.
- **Model-context formatter:** Convert frozen context records into the model input used for every response in the discussion. Preserve source boundaries and source labels without exposing internal database identifiers to the model unnecessarily.
- **Stable context reuse:** Ensure every model turn loads the stored frozen-context records rather than live sources and uses them consistently with the persisted discussion history.
- **Context-size validation:** Estimate or measure the complete context package before discussion creation against the selected model's supported input limit and any product-defined safety margin.
- **No-silent-truncation rule:** Block creation or require the user to remove context when the package exceeds supported limits. Do not silently drop a selected bubble, document, or part of a document.
- **Context badges:** Render one badge for each selected bubble and document and an explicit project-context indicator. Handle overflow with a compact but complete interaction rather than omitting badges.
- **Inspector integration:** On badge activation, send the stored frozen-context record to the Project Workspace Inspector and label it as immutable discussion context.
- **Frozen-source metadata:** Preserve displayable source titles and kinds so a snapshot remains understandable after a source rename or deletion. A source title is itself frozen for the context badge unless the team explicitly decides badges should display live titles.
- **Source-change independence:** Keep frozen-context records self-contained. Bubble, document, and project-description edits or deletions must not cascade into existing discussion snapshots.
- **Immutable-context enforcement:** Expose no mutation endpoint or interface for context items after discussion creation. Reject attempts to add, remove, edit, disable, or refresh a snapshot.
- **Reopen and reload behavior:** Load context badges and frozen content with the discussion so minimizing, reopening, and page reload preserve the same inspectable package.
- **Failure states:** Handle deleted pending sources, authorization changes, document-processing failures, snapshot-persistence errors, model-limit violations, and frozen-context loading failures without substituting live content.
- **Cross-project isolation:** Scope all reads and writes by both project and discussion ownership and reject guessed or reused identifiers from another project.
- **Deletion integration:** When Focused Discussions deletes a discussion, cascade, soft-delete, or otherwise make its frozen-context records inaccessible according to the shared deletion policy.
- **Analytics:** Instrument selection behavior and snapshot outcomes using counts, kinds, size bands, and identifiers. Do not send full context content or sensitive document text to analytics.

### Out of scope

- Automatically selecting bubbles or documents based on the user's prompt
- Recommending potentially relevant bubbles or documents
- Ranking, scoring, or explaining why context is relevant
- Adding context after a discussion has started
- Removing, editing, disabling, or refreshing context inside an existing discussion
- Switching an existing discussion from frozen content to current live source versions
- Warning that frozen context has become stale compared with current sources
- Comparing frozen and current source versions
- Duplicating or restarting a discussion automatically with current context
- Selecting individual document pages, passages, highlights, sections, or search results
- Selecting individual sentences or fields from a bubble
- Using bubble links, canvas proximity, or source recency to infer additional context
- Including hidden project knowledge that the user did not select, other than the mandatory project description
- Automatic document summarization for the purpose of reducing context size
- Partial or lossy document inclusion when a full selected document exceeds model limits
- Compressing, trimming, or summarizing selected context without explicit product behavior and user visibility
- Persisting unfinished context selections or restoring them across sessions
- Editing source bubbles, documents, or the project description from the frozen-context Inspector
- Direct navigation from a frozen badge to and replacement with the live source
- Bubble extraction from documents or frozen context; selection of frozen context as an extraction source is owned by Knowledge Extraction
- Message composition, response generation, title generation, discussion ordering, minimization, reopening, or deletion UI
- Bubble card rendering, bubble dragging, bubble CRUD, manual links, compact layout, or canvas persistence
- Document upload, file conversion, OCR, document management, or general document inspection
- Search, filtering, knowledge audits, contradiction detection, or duplicate detection
- Team-shared context, permissions beyond project ownership, or concurrent collaborative selection
- Context templates, saved context sets, favorite sources, or reusable context presets
- Per-message context overrides, model routing based on context, or multi-model comparison
- Supporting context sources outside the Nuée project, such as web pages, integrations, or pasted external connectors

## Risks / Open Questions

- **Explicit invitation versus interaction friction:** Asking about context before every discussion reinforces control but may slow users who usually want no additional context. The current leaning is a lightweight choice with a prominent continue-without-additional-context path rather than forcing users through a multi-step wizard.
- **Write-first versus context-first flow:** Letting the user write the first prompt before choosing context feels natural, while context-first makes the reasoning state clearer earlier. Both flows are included in the MVP, but they must converge on one confirmation and snapshot operation before submission.
- **Project-description visibility:** The project description is always included, but making it an ordinary badge may consume space and imply it can be removed. Keeping it implicit risks hidden context. The current leaning is a persistent, non-removable project-context indicator that can be inspected like other badges.
- **Snapshot timing:** Content could be captured when selected or when the discussion is confirmed. Capturing on selection can preserve exactly what the user saw but creates hidden drafts and stale pending state. The current leaning is capture at confirmation, with live-source revalidation immediately before persistence.
- **Source edits during selection:** Another tab or request may modify a bubble or document between selection and confirmation. Using the latest value is simple but may differ from what the user initially reviewed. The current leaning is latest-at-confirmation for the MVP, with a visible error only when a source disappears or becomes inaccessible.
- **Source-title semantics:** A frozen badge can retain the title captured at discussion creation or show a source's current title while keeping frozen body content. Live titles create subtle inconsistency. The current leaning is to freeze the title with the content so the entire badge remains reproducible.
- **Empty project descriptions:** The project description is mandatory context, but a newly created project may have an empty or minimal description. The product must decide whether an empty snapshot is valid or project creation requires content. The current leaning is to preserve the Project Workspace rule and allow an explicit empty snapshot rather than block discussion creation here.
- **Large documents and model limits:** Full-document selection is simple but can exceed model limits quickly. Silent truncation would violate user trust; blocking may make document context feel unreliable. The current leaning is strict preflight validation and an actionable request to remove documents, while passage selection and summarization remain post-MVP.
- **Token-estimation accuracy:** Provider tokenization varies, and the discussion history grows after creation even though context is fixed. A package that initially fits may leave too little room for later messages. The implementation needs a conservative safety margin and a defined behavior when the growing history approaches the limit.
- **Long-running discussion limits:** Frozen context plus full history may eventually exceed model input capacity. This PRD prohibits changing context but does not define history compaction or discussion termination. Before implementation, Focused Discussions and AI orchestration must decide whether to block further messages, summarize history transparently, or impose a practical discussion length.
- **Atomic creation across services:** If discussion creation and snapshot persistence occur in separate services, partial failure could leave an unusable discussion or orphaned snapshots. The current leaning is a single backend orchestration endpoint with transaction or idempotent compensation rather than client-controlled sequential writes.
- **Document processing readiness:** The Document Library may list a document before extracted text is ready. Context selection must communicate pending and failed states consistently. The current leaning is to show the document but disable its selection until usable text exists.
- **Context-badge overflow:** Several selected sources may exceed the discussion header width. Collapsing them into a count saves space but can obscure what the AI used. The leaning is to show a limited row plus an expandable complete list, while never hiding the total count.
- **Inspector ownership:** The same right-side Inspector serves current bubbles and frozen context. Without strong labeling, users may believe they are editing the source or viewing its latest state. The frozen state should use unmistakable copy and omit edit controls.
- **Deleted-source traceability:** Preserving `source_id` after source deletion helps auditing but may conflict with hard-deletion or privacy requirements. At minimum, the frozen snapshot needs its own source kind and title; whether identifiers survive deletion should follow the application's data-retention policy.
- **No hidden context versus system instructions:** The model will still receive application-level system instructions that are not project knowledge. Product language should distinguish model instructions from project context so the “everything provided” promise is not technically misleading. The UI promise should refer to user/project knowledge supplied as context.
- **Security and sensitive documents:** Full document text may contain sensitive information. Snapshotting duplicates that content and increases the number of stored copies. Storage encryption, access control, deletion behavior, and model-provider data handling must be reviewed before document context is released.
- **Analytics privacy:** Context size and source counts are useful for product learning, but titles or content could reveal sensitive project information. Analytics should use categorical metrics and identifiers only, with no full text.
- **Context order:** The order of project description, bubbles, and documents may influence the model. A stable order improves reproducibility, but the ideal priority is unvalidated. The current leaning is project description first, then bubbles in user-confirmed order, then documents in user-confirmed order.
- **Duplicate source selection:** A bubble might be selected from the canvas and added again through another interaction path. The current leaning is source-level deduplication before confirmation, with one visible selection and one snapshot.

## Commit Plan

The commits below are ordered so each slice leaves the application in a coherent state and
preserves the existing feature boundaries. Discussion Context owns selection and context-package
construction; Focused Discussions continues to own discussion and message lifecycle; the AI module
continues to own provider-neutral model access; the workspace, canvas, and Documents panel expose
their existing integration seams rather than absorbing context-specific behavior.

Two dependencies must be explicit before the complete PRD can ship:

- The Document Library must provide a project-scoped context-source read contract containing, at
  minimum, document identifier, frozen-to-be title, processing readiness, and complete processed
  text. These commits consume that contract but do not implement upload, extraction, OCR, or general
  document management.
- The current application is a trusted single-user system. In this implementation, "authorized"
  means that every source is resolved through its owning project. Per-user access control remains a
  prerequisite for untrusted or multi-user deployment.

The MVP decisions used by this plan are: capture the latest authorized source values at
confirmation; freeze source titles with bodies; retain source identifiers without foreign keys to
live sources; order project description first, then bubbles in confirmed order, then documents in
confirmed order; show project context as a persistent inspectable indicator; make soft-deleted
discussion context inaccessible; and block creation or later messages when the complete input
exceeds the configured model budget. The MVP does not silently truncate context or compact message
history.

### Phase A — Contracts and backend

1. **`feat(shared): define typed discussion-context contracts`**
   Replace the opaque `FrozenContext = Record<string, unknown>` with a versioned package containing
   typed frozen items for `project_description`, `bubble`, and `document`. Each item includes its
   identifier, source kind, retained source identifier, frozen source title, frozen content,
   creation timestamp, and stable display order. Add the ordered pending-selection input
   (`bubble_ids` and `document_ids`) and a discussion-creation idempotency key. Change
   `CreateDiscussionInput` so the client submits source identifiers rather than source bodies.
   Preserve a legacy response variant so existing discussions remain readable without
   destructively reinterpreting historical opaque JSON. *Verify: build.*

2. **`feat(backend): persist immutable discussion context items`**
   Add a registered migration for `discussion_context_items`, linked only to its owning discussion
   so deleting a live bubble or document cannot cascade into a snapshot. Enforce unique display
   order, source-level uniqueness, and exactly one project-description item for each new
   discussion. Add discussion context version, expected item count, project-scoped creation
   idempotency key, and normalized-request fingerprint metadata. Update repository ports and the
   SQLite implementation to insert a complete context package and detect missing, duplicate,
   malformed, or corrupt rows on reads. Keep the existing `discussions.frozen_context` value as the
   read path for legacy discussions; new versioned discussions use item rows as the authority.
   Expose no repository or HTTP mutation operation for individual frozen items. *Verify: backend
   build, lint, unit.*

3. **`feat(backend): assemble frozen context from live project sources`**
   Introduce a narrow `discussion-context/` feature that reads the current project description,
   project-scoped bubbles, and ready document context sources immediately before persistence. It
   deduplicates identifiers while preserving first-confirmed order, freezes source titles, includes
   each bubble's complete AI-relevant synthesized content, includes each document's complete
   processed text, and creates a valid project-description item even if the workspace eventually
   allows an empty description. Return structured item-level errors for missing, inaccessible,
   cross-project, pending, or failed sources without logging their content. Source reads must not
   alter content timestamps, canvas positions, or processing metadata. Export only the completed
   package to Discussions so that discussion lifecycle code never interprets or refreshes live
   source semantics. *Verify: backend build, lint, unit.*

4. **`feat(ai): format and budget frozen discussion context`**
   Add one canonical model-context formatter that serializes item kind, frozen title, order, and
   complete frozen content with stable, distinguishable boundaries while omitting internal database
   identifiers. Treat all frozen text as reference data rather than model instructions. Add a
   provider-neutral input-budget capability that accounts for application instructions, formatted
   context, persisted history, the next user message, reserved output, and a configured safety
   margin. Use a conservative estimator behind a replaceable port rather than adding a tokenizer
   dependency. Apply the same formatter and budget calculation to creation and every later turn.
   When growing history no longer fits, block the new message before persistence; never drop or
   summarize frozen items silently. *Verify: backend build, lint, unit.*

5. **`feat(backend): create discussions atomically from context selections`**
   Rework the project-scoped discussion creation endpoint to validate the selection, build the
   package at confirmation time, preflight its complete first-turn model input, and atomically
   insert the discussion, every expected frozen item, and the first pending user message. Store a
   fingerprint of the normalized prompt and ordered selection. Reusing the same idempotency key
   with the same payload returns the existing discussion; reusing it with a different payload
   returns a stable conflict. Source validation, size rejection, or snapshot failure must leave no
   partial discussion or orphaned context rows. If model generation fails after coherent
   persistence, retain the existing recoverable failed-turn behavior. Translate expected source,
   size, idempotency, and persistence failures into stable application errors without exposing SQL
   details. *Verify: backend build, lint, unit.*

6. **`test(backend): cover discussion-context persistence and HTTP journeys`**
   Add repository, service, model-port, and e2e coverage for project-only context; one and several
   bubbles; one and several documents; mixed selections; duplicate selections; latest values at
   confirmation; source deletion or readiness changes before confirmation; source edits, renames,
   and deletion after creation; cross-project identifiers; repeated creation requests; conflicting
   idempotency reuse; transaction rollback; stable model context on every turn; initial and
   long-history size rejection; corrupt or missing context rows; context inaccessibility after
   discussion deletion; and unchanged source timestamps and canvas positions. Use in-memory SQLite
   and deterministic source/model fakes where appropriate, plus the real project-scoped HTTP
   journey. *Verify: backend build, lint, unit, e2e.*

### Phase B — Frontend selection and creation

7. **`feat(frontend): add discussion-context API validation`**
   Update the discussion API client to submit ordered source identifiers and a creation idempotency
   key. Add runtime validation for versioned context packages: supported kinds, unique identifiers
   and display orders, mandatory project-description item, expected item count, timestamps, titles,
   and content. A malformed or incomplete package places discussion loading into a visible data
   error and never falls back to current project, bubble, or document records. Keep requests
   injectable and abortable for tests. *Verify: frontend build, lint, unit.*

8. **`feat(frontend): coordinate transient discussion context`**
   Add a project-scoped context-selection coordinator with explicit invitation, bubble selection,
   document selection, combined review, submitting, and recoverable-error states. Support entry from
   the Discussions panel and persistent canvas action, from a selected canvas bubble or
   multi-selection flow, and from the existing write-first draft. Preserve the draft prompt while
   the user temporarily enters a source-selection view. Store only pending identifiers and display
   metadata; do not create frozen records before confirmation. Deduplicate repeated additions,
   discard all pending state on cancellation or project change, and provide a prominent
   continue-with-project-context-only path. *Verify: frontend build, lint, unit.*

9. **`feat(frontend): select bubble context on the canvas`**
   Connect the coordinator to the existing controlled `CanvasMultiSelection` seam. Seed the flow
   with an explicitly selected bubble when appropriate, support one or several bubbles, reuse the
   canvas's selected and unselected visual states, and allow re-entry with previous pending choices.
   Confirm returns only project-scoped identifiers and cached review metadata; cancel or Escape
   returns to the invitation or draft without creating a discussion or changing any bubble. Removing
   a bubble from review affects only pending selection. Cover cancellation, empty confirmation,
   deduplication, local deletion during selection, keyboard operation, and selection-state cleanup.
   *Verify: frontend build, lint, unit.*

10. **`feat(frontend): select document context in the Documents panel`**
    After the Document Library's context-source contract lands, add its controlled whole-document
    selection adapter. Allow one or several ready documents, preserve selected state across panel
    views, and make pending or failed documents visible but unselectable with a document-specific
    explanation. Reject records from another project at the client boundary while relying on the
    server for authoritative enforcement. Support mixed document and bubble selections without
    passage, page, excerpt, or partial-document controls. Removing a document affects only pending
    selection. *Verify: frontend build, lint, unit.*

11. **`feat(frontend): review context and create discussions safely`**
    Add the final combined review containing the persistent non-removable project-description
    indicator, complete bubble and document lists, source kinds, counts, frozen-to-be titles, and
    removal controls. Make context-first and write-first entry paths converge on this one
    confirmation and creation request. Retain one creation idempotency key across duplicate clicks
    and uncertain network retries; generate a new key when the user changes the prompt or selection.
    Preserve the prompt and pending selection after recoverable source, processing, size, or
    snapshot errors. Mark affected items using structured server errors and let the user remove or
    review them before retrying. Once a discussion is coherently persisted, transition to its
    existing failed-turn recovery if only response generation failed. Remove the temporary
    client-side project-description snapshot builder. *Verify: frontend build, lint, unit.*

### Phase C — Frozen-context presentation and close-out

12. **`feat(frontend): inspect complete frozen context from discussion badges`**
    Replace the temporary project-only badge resolver with a one-to-one projection of persisted
    context items. Show the non-removable project-context indicator and a badge for every selected
    bubble and document, using frozen titles. Handle overflow with a limited row plus an accessible
    expandable complete list that always exposes the accurate total. Activating a badge sends the
    stored item to the Project Workspace Inspector, keeps the discussion open, labels the view as
    immutable frozen discussion context, and exposes no edit, live-navigation, disable, remove, or
    refresh control. Adjust the current overlay boundary so the canvas remains unavailable while
    the discussion and frozen Inspector form one coherent accessible focus region; do not leave an
    interactive Inspector outside an `aria-modal` focus trap. Reloading, minimizing, and reopening
    must restore the same badges and inspection bodies from persisted context only. *Verify:
    frontend build, lint, unit; manual UI QA separately.*

13. **`feat: harden discussion-context accessibility, analytics, and integration`**
    Instrument context-selection entry and entry point, cancellation, confirmed bubble and document
    counts, project-only creation, snapshot failure, context-badge inspection, and size rejection.
    Analytics may include project/discussion/context identifiers, source kinds, counts, error codes,
    latency, and categorical size bands, but never source titles or full project, bubble, or
    document content. Complete keyboard, focus-restoration, live-error, non-color-only selection,
    and reduced-motion behavior. Add frontend integration journeys for write-first prompt
    preservation, context-first creation, cancellation, duplicate submission, source errors, mixed
    review, reload, badge overflow, and frozen inspection. Update `ARCHITECTURE_ANALYSIS.md`,
    `BACKEND_ARCHITECTURE_ANALYSIS.md`, and the synchronized technical-direction files wherever the
    implementation supersedes the temporary opaque-context boundary. *Verify: full build, lint,
    unit, and backend e2e; manual UI QA separately.*

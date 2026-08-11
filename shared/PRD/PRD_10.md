# PRD 10 — Territory Canvas

## Problem

PRD 02 modeled the canvas as free-floating bubble cards: every bubble owns an absolute position,
the user drags each card individually, and compact layout re-grids individual cards. That model
works while a project holds a handful of bubbles, but it degrades exactly when Nuée succeeds: a
project that has been through many discussions and extractions accumulates dozens of bubbles, and
a flat field of same-sized cards becomes a wall the user must spatially manage by hand. The canvas
stops being a map of what the project knows and becomes a chore.

The reference design (the "Fiscalité SASU" mock — French copy, illustrative only; the product
stays in English) replaces the flat field with **territories**: named groups of bubbles rendered
as one card each. A territory card has a header — title, a −/+ stepper controlling how many
bubbles are visible at once, and the group's total count — and a body listing its bubbles as
compact single-statement rows showing each bubble's summary. The card, not the bubble, is the
spatial unit: the user drags territories, compact layout arranges territories, and bubbles inside
a territory are simply listed in creation order. A `Recompose territories` action in the workspace
header asks the model to re-cluster all project bubbles into named territories. Bubbles keep their
full identity — title, content, inspector, reader modal, links, mentions, extraction, frozen
context — the territory is presentation-level grouping, never knowledge.

This PRD owns the territory data model and recompose workflow, the territory card and its
interactions, and the retirement of per-bubble spatial positions. It supersedes PRD 02's
per-bubble spatial model (individual card positions, per-bubble drag, per-bubble compact layout)
and narrows PRD 0's persistence criterion: the canvas now persists territory positions rather
than bubble positions. Everything else PRD 02 established — viewport persistence, pan, zoom,
selection feeding the inspector, the canvas as the primary knowledge surface — still holds.

## Target Users and Feature Impact

- **Primary user:** An individual whose project has accumulated enough bubbles (tens, not a
  handful) that a flat canvas no longer communicates the shape of what they know.
- **User need:** See the project's knowledge organized into a small number of named themes at a
  glance, skim each theme's statements without opening anything, expand any statement to its full
  bubble on demand, and re-organize the whole map in one action instead of dragging cards.
- **Feature impact:** The canvas feature changes its spatial unit from bubble to territory. The
  bubbles feature keeps full ownership of bubble content, inspection, and reading. The backend
  gains a `territories` feature owning territory persistence and the AI recompose workflow. The
  discussions, documents, and knowledge-extraction features are untouched except where they
  touch canvas selection surfaces, which keep their contracts.

## Definitions

- **Territory:** A persisted, project-scoped group of bubbles with a title, a canvas position, and
  a visible-count. Territories come in two kinds: `composed` territories, created only by the
  recompose workflow, and the single `ungrouped` territory that collects bubbles not yet assigned
  by a recompose. A bubble belongs to exactly one territory at all times.
- **Recompose:** The user-triggered workflow that sends every project bubble to the model and
  replaces all composed territories with a fresh set of named territories covering all bubbles.
- **Visible-count:** The per-territory number of bubble rows shown at once, controlled by the
  header stepper and persisted server-side.

## Success criteria

1. The canvas renders one card per non-empty territory; no free-floating bubble cards remain.
2. A territory card shows a header with the territory title, a −/+ stepper with the current
   visible-count, and the territory's total bubble count; its body lists the first visible-count
   bubbles in ascending `created_at` order (id as tiebreak).
3. Each bubble row displays the bubble's summary; when the summary is absent it falls back to the
   opening of the content, using the same preview derivation the canvas uses today. The row never
   shows the bubble title as its primary text.
4. Clicking a bubble row's chevron opens the existing `BubbleReaderModal` for that bubble, with
   unchanged reader behavior (summary callout, full content, links, provenance, edit handoff).
5. Clicking elsewhere on a bubble row selects the bubble and the sidebar inspector shows it,
   exactly as selecting a bubble card does today; editing, linking, and deletion flows are
   unchanged.
6. Dragging a territory card moves the whole territory; the position persists per territory with
   the same optimistic-save, retry, and revert semantics bubble positions have today. Bubbles
   are not individually draggable and have no persisted canvas position of their own.
7. Bubble order inside a territory is not user-arrangeable: rows always follow ascending
   `created_at`.
8. The stepper decrements to no fewer than 1 and increments to no more than the territory's
   total; the value persists server-side and reload restores it exactly. Save state surfaces
   through the workspace header's existing save indicator.
9. When a territory holds more bubbles than its visible-count, the card footer shows
   `+ N more bubbles`; activating it unlocks scrolling inside the card body at its current
   height — it never changes the visible-count, the card's height, or the territory's position.
10. Scrolling inside an unlocked card body scrolls the bubble list only; it never pans or zooms
    the canvas. Pointer and wheel interactions outside card bodies keep today's pan and zoom
    behavior.
11. The workspace header shows the project's bubble count and territory count, the
    `Recompose territories` action, and the existing save indicator.
12. Activating `Recompose territories` sends all project bubbles to the model and atomically
    replaces all composed territories with the returned set: every bubble is assigned to exactly
    one returned territory, each territory gets a concise generated title, and the previous
    composed territories cease to exist. The frozen context, messages, links, provenance, and
    content of every bubble are untouched.
13. Recompose is unavailable when the project has fewer than two bubbles or while a recompose is
    already in flight; the action shows an in-progress state and duplicate activation creates no
    duplicate work.
14. A failed or invalid model response leaves the existing territories completely unchanged and
    surfaces a stable, retryable error; no partial territory set is ever persisted or rendered.
15. A newly created bubble — manual creation or a knowledge-extraction `new_bubble` resolution —
    lands in the project's ungrouped territory. The ungrouped territory is created on first need,
    is titled `Ungrouped`, renders like any territory while it has bubbles, is hidden while
    empty, and is never removed or renamed by recompose.
16. Deleting a bubble removes its row; visible-counts clamp to the new total. Deleting the last
    bubble of a composed territory removes that territory in the same operation.
17. A project that existed before this feature opens with all its bubbles in the ungrouped
    territory, with nothing lost; the first recompose organizes it.
18. Compact layout arranges territory cards — using their real rendered heights — into the
    existing anchored grid behavior, persists territory positions in one batch with the existing
    saving, retry, and failure semantics, and is available from the unchanged bottom action bar
    when at least two territories are visible.
19. The bottom action bar keeps its three actions — start discussion, add bubble, compact — with
    unchanged placement and unchanged discussion and creation flows; bubble creation no longer
    asks for or computes a canvas placement.
20. Canvas multi-selection (extraction source picking, canvas-seeded discussion entry) operates on
    bubble rows inside territory cards: rows toggle with the existing checkbox affordance and
    confirmation bar, selection limits are honored, and consumers receive the same
    bubble-id-based result contract as today.
21. Discussion mentions, frozen context, extraction targeting, and bubble links are unchanged:
    bubbles remain individually addressable by title everywhere outside the canvas. Territory
    membership never appears in frozen context or model prompts other than the recompose prompt.
22. Viewport pan, zoom, and viewport persistence are unchanged.
23. The territory card is fully keyboard operable: the header, stepper buttons, each row, its
    chevron, and the `+ N more bubbles` control are focusable and labeled; stepper changes and
    scroll-unlock are announced; the card body scroll region is keyboard scrollable; reduced
    motion is respected.
24. Analytics record recompose requests, completions (territory and bubble counts), and failures
    (stable reason), stepper changes, scroll unlocks, reader opens from the canvas, territory
    drags, and territory compact applications — identifiers and counts only, never titles,
    summaries, or content.

## Scope

### In scope

- **Shared contract (`@nuee/shared-types`):** A `Territory` type (id, project id, kind, title,
  position, visible-count, timestamps), `territory_id` on `Bubble`, list/reposition/visible-count
  and recompose request/response contracts, and shared validation limits (territory title length,
  visible-count bounds, recompose territory-count bounds). Per-bubble position fields and the
  bubble reposition and placement contracts are removed.
- **Backend `territories/` feature:** Territory persistence (repository, migrations), the
  project-scoped territory list, per-territory visible-count update, single and batch territory
  reposition, and the recompose workflow. Recompose calls the neutral `ModelClient` structured
  output with all project bubbles (titles plus bounded summary/content excerpts inside the
  existing input budget), validates the returned assignment (every bubble exactly once, known ids
  only, bounded territory count, non-empty titles within limits), and persists the replacement
  set in one transaction. Bubble `territory_id` writes go through a narrow port exported by the
  bubbles feature, mirroring the extraction-writer pattern; the `ai/` module stays free of
  territory policy.
- **Bubbles backend changes:** `territory_id NOT NULL` on bubbles via table-rebuild migration;
  existing bubbles migrate into a per-project ungrouped territory; bubble creation and extraction
  resolution ensure and target the ungrouped territory; per-bubble position columns, the
  reposition endpoints, and the placement service/endpoint are removed. Deleting the last bubble
  of a composed territory deletes the territory transactionally.
- **Migration ordering:** The territories table is created before the bubbles rebuild; the
  per-project ungrouped territory is seeded from existing bubbles (position anchored at the
  bubbles' current top-left extent, default visible-count) so the pending migration set stays
  atomic and a pre-feature database opens correctly.
- **Territory card (canvas):** The card described by success criteria 1–10: fixed card width,
  height derived from visible rows, header with title/stepper/total, summary rows with chevron,
  `+ N more bubbles` scroll unlock, drag with persisted position, and the wheel/pointer
  exemption so card-body scrolling never pans the canvas. `BubbleCard` as a free canvas card is
  retired; the row reuses the existing preview derivation.
- **Canvas load and state:** The collection loads bubbles and territories together, groups
  bubbles client-side by `territory_id`, keeps explicit load states, and keeps every mutation
  (position, visible-count) optimistic with visible retry, exactly as canvas saves behave today.
- **Compact layout for territories:** Measured-height packing of territory cards from the
  existing anchor semantics, batch-persisted through the territory reposition contract, gated and
  surfaced by the unchanged bottom action bar.
- **Recompose UI:** The workspace-header counts, the `Recompose territories` action with
  disabled/in-flight/error states, and collection refresh from the recompose response.
- **Reader and inspector wiring:** Row chevron opens `BubbleReaderModal`, row click selects into
  the sidebar inspector; orchestration lives in the workspace (the lowest common owner), the
  canvas exposes typed callbacks, and the bubbles feature keeps ownership of both surfaces.
- **Multi-selection on rows:** The existing controlled multi-selection contract re-rendered as
  row checkboxes inside territory cards, preserving consumer contracts (extraction, canvas-seeded
  discussion entry).
- **Accessibility and analytics** as defined in the success criteria.

### Out of scope

- Manual territory creation, renaming, deletion, or reordering; any hand-editing of a
  territory's composition
- Moving a bubble between territories by any means other than recompose
- Reordering bubbles inside a territory; any per-bubble spatial position
- Nested, overlapping, or shared territories; a bubble in more than one territory
- Recompose scoped to a subset of bubbles, incremental recompose, or automatic/background
  recompose (including on bubble creation)
- User instructions or constraints steering the recompose model call
- Territory membership as knowledge: territories in frozen context, mentions, extraction
  prompts, or document flows
- Collapsing a territory to header-only, territory-level selection as a context shortcut, or
  territory-level actions on its bubbles
- Changing `BubbleReaderModal`, `BubbleInspector`, discussions, documents, links, or extraction
  behavior beyond the wiring named in scope
- Cross-device sync semantics beyond the existing last-write-wins updates

## Risks / Open Questions

- **Recompose output quality:** Clustering quality is the product bet. The contract bounds the
  blast radius: strict server-side validation, all-or-nothing persistence, and one retryable
  action. Titles and groupings the user dislikes cost one more recompose, never data. Prompt
  iteration happens behind the structured-output seam without contract changes.
- **Recompose input budget:** A project with many large bubbles could exceed the model input
  budget. Recompose sends bounded excerpts (title, summary, and a truncated content opening)
  through the existing input-token estimator; if the bounded form still exceeds the budget the
  request fails with the existing budget error rather than silently dropping bubbles.
- **Wheel-event conflict:** The canvas surface intercepts wheel events for pan/zoom with a
  non-passive listener. Unlocked card bodies must receive scroll instead; the exemption must be
  scoped to the scrollable region and verified on trackpads (pinch-zoom gates through
  ctrl/meta-wheel today). This is the most fragile interaction seam and gets explicit tests and
  manual QA.
- **Measured-height compact:** Row text wraps, so card heights are not derivable from counts
  alone; compact must read rendered heights. Compact already runs client-side against displayed
  state, so measurement is available — but layout must tolerate fonts/zoom and stay deterministic
  for a given measurement snapshot. The pure packing algorithm takes `(id, height)` pairs so it
  stays unit-testable without DOM.
- **`summary` as the row's face:** Rows render the summary, but `summary` is nullable and
  historically secondary; manual bubbles often have none. The content-opening fallback keeps rows
  meaningful, but projects with sparse summaries will read unevenly. If this bites, a follow-up
  can strengthen summary authoring (extraction already produces good ones); this PRD does not
  change bubble authoring.
- **Bubbles-table rebuild:** Adding `territory_id NOT NULL` and dropping position columns
  rebuilds the bubbles table under SQLite with foreign keys and indexes re-established. The
  migrations spec and e2e journeys must cover a database created before this PRD, including one
  with zero bubbles (no ungrouped territory seeded).
- **Loss of free spatial expression:** Users who arranged bubbles meaningfully lose that
  arrangement (everything lands in `Ungrouped` until recompose). Accepted for MVP: the product
  thesis is that named territories beat hand-placement at scale, and territory positions remain
  hand-arrangeable. The migration must not be reversible-lossy in any other way — only positions
  are forgotten.
- **Linked-bubble highlight:** The canvas's `LINKED` highlight on selection disappears with free
  cards. Links remain visible in the inspector and reader; if canvas-level link visibility
  proves missed, it returns as a row affordance in a follow-up.
- **Stepper write frequency:** Rapid −/+ tapping should debounce into the last value per
  territory (the viewport-save pattern) rather than a request per tap; the header save indicator
  carries visibility.
- **Concurrent recompose:** One user, one instance; the guard is the in-flight disable plus
  last-write-wins on the server. No idempotency key is introduced for recompose in this PRD —
  a duplicate that slips through produces a fresh valid composition, not corruption.
- **Default visible-count:** Recompose and migration default each territory's visible-count to
  `min(4, total)`. This is a product default, not a contract; tuning it later is a one-line
  change and persisted values are never overwritten by tuning.

## Commit Plan

The reference design is the "Fiscalité SASU" screenshot (French copy illustrative; product copy
in English). MVP decisions used by this plan: territories are AI-composed only (no manual
creation, rename, or reassignment); new bubbles land in a per-project `Ungrouped` territory that
recompose never removes; visible-count is server-persisted and clamped to `[1, total]` with a
`min(4, total)` default; bubble rows render summary with content-opening fallback; per-bubble
canvas positions are removed outright; recompose is synchronous, all-or-nothing, and retryable.

1. **`feat(shared): add the territory contract and retire bubble positions`**
   Add `Territory` (id, project id, `kind: 'composed' | 'ungrouped'`, title, position,
   visible-count, timestamps), `territory_id` on `Bubble`, the territory list, visible-count
   update, single/batch reposition, and recompose request/response contracts, plus shared limits
   (territory title length, visible-count bounds, recompose territory-count bounds). Remove
   bubble position fields, reposition inputs, and placement contracts. Update both sides'
   imports mechanically so the workspace compiles.
   *Verify: full build, lint, unit.*

2. **`feat(backend): persist territories and route bubbles through them`**
   Create the `territories/` feature: migrations (territories table; bubbles table rebuild
   adding `territory_id NOT NULL` with FK and index, dropping position columns; per-project
   ungrouped seeding anchored at the migrated bubbles' top-left extent), repository, service,
   and controller for the project-scoped list, visible-count update (clamped), and single/batch
   reposition. Export a narrow territory-assignment port from bubbles (extraction-writer
   pattern); bubble creation and extraction `new_bubble` resolution ensure and target the
   ungrouped territory; deleting a composed territory's last bubble deletes the territory in the
   same transaction. Remove bubble reposition and placement endpoints and the placement service.
   Cover migration of a pre-feature database (with and without bubbles) in the migrations spec
   and e2e journeys.
   *Verify: backend build, lint, unit, e2e.*

3. **`feat(backend): recompose territories with structured model output`**
   Add the recompose endpoint to `territories/`: load all project bubbles, build the bounded
   prompt (title, summary, truncated content opening) within the existing input budget, call
   `generateStructuredOutput`, validate the assignment (every bubble exactly once, known ids
   only, bounded territory count, titles non-empty within limits), and atomically replace all
   composed territories — insert new set with default visible-counts, reassign bubbles through
   the port, delete emptied predecessors. Reject with stable, retryable errors on invalid output
   or provider failure, leaving state untouched; require at least two bubbles. Extend the fake
   model client for deterministic compositions and cover the workflow in unit and e2e tests.
   *Verify: backend build, lint, unit, e2e.*

4. **`feat(frontend): render territory cards on the canvas`**
   Load territories alongside bubbles in the canvas collection and render one card per non-empty
   territory: header (title, stepper display, total), summary rows in ascending `created_at`
   with the existing preview fallback, chevron affordance, and `+ N more bubbles` footer.
   Static in this commit: stepper and footer render without mutation, drag stays disabled, and
   the free `BubbleCard` rendering is removed. Keep explicit load states and the empty state.
   *Verify: frontend build, lint, unit.*

5. **`feat(frontend): drag territories and compact the territory layout`**
   Move drag from bubbles to territories with the same optimistic save, retry, and revert
   overlays, persisted through the territory reposition contract. Rework compact layout into a
   pure measured-height packer over `(id, height)` pairs, wire measurement from rendered cards,
   and batch-persist through the same contract, gated by the unchanged bottom action bar
   (enabled at two or more visible territories). Remove bubble-position save paths and their
   overlays.
   *Verify: frontend build, lint, unit.*

6. **`feat(frontend): control territory visible-count and in-card scrolling`**
   Make the stepper live: clamp to `[1, total]`, apply optimistically, debounce persistence per
   territory, and surface save state through the workspace header indicator. Implement scroll
   unlock: activating `+ N more bubbles` enables scrolling of the card body at its current
   height, with the wheel/pointer exemption so card-body scrolling never pans or zooms the
   canvas, keyboard scrollability, and announced state changes. Cover clamping after deletion
   and total changes.
   *Verify: frontend build, lint, unit; manual trackpad QA separately.*

7. **`feat(frontend): recompose action, reader and selection wiring`**
   Add the workspace-header counts and the `Recompose territories` action with disabled,
   in-flight, and retryable error states, refreshing the collection from the response. Wire row
   chevron to `BubbleReaderModal` and row click to sidebar-inspector selection through typed
   canvas callbacks orchestrated by the workspace. Re-render multi-selection as row checkboxes
   preserving the existing result contract for extraction and canvas-seeded discussion entry.
   Simplify bubble creation: no placement input; created and extracted bubbles appear in the
   ungrouped territory.
   *Verify: frontend build, lint, unit.*

8. **`feat(frontend): territory analytics, accessibility, and close-out`**
   Instrument recompose requested/completed/failed (counts and stable reasons only), stepper
   changes, scroll unlocks, canvas reader opens, territory drags, and territory compact
   applications — never titles, summaries, or content — and retire per-bubble position events.
   Complete keyboard operability, labels, announcements, focus management, and reduced motion
   across the card. Add integration journeys: grouped render with fallback rows, stepper clamp
   and persistence, scroll unlock, drag save failure with retry, compact over measured heights,
   recompose success/invalid-output/failure, reader from row, multi-selection on rows, and a
   pre-feature project opening into `Ungrouped`. Update the architecture-improvement ledgers
   where this supersedes recorded weaknesses.
   *Verify: full build, lint, unit, backend e2e; manual UI QA against the reference screenshot
   separately.*

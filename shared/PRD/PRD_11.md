# PRD 11 — Manual Territories

## Problem

PRD 10 made the territory the canvas's spatial unit, but left its composition entirely to the
model: territories exist only as output of the `Recompose territories` workflow, and the single
`Ungrouped` territory collects everything else. The user cannot create a territory, name one,
delete one, or decide where a bubble lands. In practice this inverts who owns the map: the user
watches groupings appear and can only answer with another full recompose, which dissolves whatever
the previous run produced. Curation — "these five statements are my pricing research, keep them
together" — is impossible, and every recompose puts existing groupings at risk.

This PRD moves territory composition from the model to the user. Territories become manually
created, renamed, and deleted; every moment a bubble enters the project — manual creation or a
knowledge-extraction `new_bubble` resolution — the user chooses where it lands: `Ungrouped`, an
existing territory, or a new territory created on the spot. The recompose workflow is **removed
entirely**: endpoint, prompt, service, header action, and analytics. Existing composed territories
are not lost — they migrate to manual territories the user now owns and can rename or delete.

Everything else PRD 10 established still holds: the territory card and its rows, drag and
persisted positions, visible-count and the stepper, scroll unlock, compact layout, selection and
reader wiring, the `Ungrouped` lifecycle, viewport persistence. This PRD supersedes PRD 10's
recompose workflow (success criteria 11–14 as they concern recompose, and the
"AI-composed only" MVP decision) and its rule that a composed territory is auto-deleted with its
last bubble.

## Target Users and Feature Impact

- **Primary user:** An individual organizing project knowledge who knows how their bubbles group
  better than a clustering prompt does, and who wants groupings that stay put.
- **User need:** Create a named territory in one action, decide at extraction or creation time
  where a bubble belongs, rename or delete groupings as understanding evolves, and never have a
  hand-built arrangement destroyed by an AI action.
- **Feature impact:** The canvas feature gains territory creation, rename, and delete surfaces and
  the empty-territory card state. The bubbles feature gains a destination input on creation. The
  knowledge-extraction feature gains a destination choice on `new_bubble` resolution. The backend
  `territories/` feature gains create/rename/delete and loses the recompose workflow; `ai/` loses
  a consumer and changes not at all. Discussions and documents are untouched.

## Definitions

- **Manual territory:** A persisted, project-scoped territory created, renamed, and deleted by the
  user. Replaces `composed` as the only territory kind besides `ungrouped`; existing composed
  territories migrate to manual with title, position, visible-count, and membership intact.
- **Destination:** The user's choice of where a bubble lands when it is created: the `Ungrouped`
  territory (default), an existing territory, or a new territory named on the spot. One shared
  contract expresses this in both bubble creation and extraction resolution.
- **Empty territory:** A manual territory holding zero bubbles. Unlike `Ungrouped` (hidden while
  empty), an empty manual territory stays visible with an explanatory message until the user
  deletes it.

## Success criteria

1. The bottom action bar shows four actions — start discussion, add bubble, add territory,
   compact — with the existing three unchanged in behavior and placement.
2. Activating add territory asks for a title (non-empty after trimming, within the shared
   territory-title limit, validation errors shown inline); confirming creates the territory and
   renders its card centered in the current viewport, immediately draggable with the same
   optimistic-save, retry, and revert semantics as any territory.
3. An empty manual territory renders its card: header with title and total count `0`, a body
   message explaining the territory holds no bubbles yet, no stepper interaction and no
   `+ N more bubbles` footer. It remains visible until explicitly deleted — never auto-hidden,
   never auto-deleted.
4. Deleting the last bubble of a territory no longer deletes the territory: the card stays and
   shows the empty state. Visible-count clamping on deletion otherwise behaves as today.
   `Ungrouped` keeps its PRD 10 lifecycle exactly: hidden while empty, never deleted.
5. Every territory except `Ungrouped` can be renamed from its card header; the new title is
   validated like creation, persists server-side, and save state surfaces through the workspace
   header's existing save indicator.
6. Every territory except `Ungrouped` can be deleted from its card after an explicit confirmation
   that states how many bubbles will move to `Ungrouped`. Deletion is transactional: the
   territory's bubbles are reassigned to `Ungrouped` (created on first need) and the territory
   removed in one operation. Bubbles lose nothing — content, links, provenance, frozen-context
   references are untouched.
7. Rename and delete attempts against `Ungrouped` are rejected server-side with a stable error;
   the UI never offers them.
8. The bubble creation flow includes a destination selector defaulting to `Ungrouped`, offering
   every existing territory by title plus a new-territory option with an inline title input. The
   created bubble lands in the chosen destination.
9. Resolving a knowledge-extraction proposal as `new_bubble` includes the same destination
   selector with the same default and options. The extracted bubble lands in the chosen
   destination and the extraction flow closes on success exactly as it does today.
10. Choosing the new-territory destination in either flow creates the territory and assigns the
    bubble atomically: on any failure nothing is partially persisted — no orphan territory, no
    misplaced bubble — and the operation is retryable with the flow's existing error surface.
11. A territory created through a destination selector appears on the canvas centered in the
    current viewport, like bar-created territories, with the default visible-count.
12. The recompose workflow is fully removed: no `Recompose territories` header action, no
    recompose endpoint, prompt, or service, no recompose analytics. The workspace header keeps
    its bubble count, territory count, and save indicator.
13. A project with composed territories from PRD 10 opens with those territories intact as manual
    territories — same titles, positions, visible-counts, and membership — now renameable and
    deletable. The `composed` kind no longer exists in the contract or the database.
14. `update_bubble` extraction resolutions and all bubble editing flows leave the bubble's
    territory unchanged.
15. The new surfaces are fully keyboard operable and labeled: the creation dialog manages focus
    and restores it on close, rename is reachable and cancelable from the keyboard, the delete
    confirmation traps focus and announces its consequence, the destination selector is a labeled
    group whose options and inline title input are focusable, and the empty-territory message is
    exposed to assistive technology. Reduced motion is respected.
16. Analytics record territory creations (with a stable source: action bar, bubble creation, or
    extraction), renames, deletions (with moved-bubble count), and destination choices (stable
    kind only) — identifiers and counts only, never titles, summaries, or content. All recompose
    events are retired.

## Scope

### In scope

- **Shared contract (`@nuee/shared-types`):** `TerritoryKind` becomes `'manual' | 'ungrouped'`.
  Add territory create (title, position), rename, and delete request/response contracts, and a
  `TerritoryDestination` union — ungrouped | existing (territory id) | new (title, position) —
  reused by bubble creation and extraction resolution. Remove the recompose request/response
  contracts and recompose-specific limits (territory-count bounds); the territory-title limit is
  reused as-is.
- **Backend `territories/` feature:** Create (validate title, persist with default visible-count),
  rename (manual only), and delete (manual only; transactional reassignment of member bubbles to
  the ensured `Ungrouped` territory through the existing bubbles-feature assignment port, then
  territory removal). Stable errors for unknown territory, `Ungrouped` as rename/delete target,
  and title validation. Remove the recompose endpoint, service, prompt, and their tests; remove
  the fake model client's recompose composition support if nothing else uses it.
- **Migration:** Rebuild or update the territories table so `kind` allows `'manual' | 'ungrouped'`
  and every existing `composed` row becomes `manual`, preserving all other columns. The migrations
  spec and e2e journeys cover a PRD 10-era database with composed territories opening correctly.
- **Bubbles backend changes:** Bubble creation accepts an optional destination (default
  ungrouped): existing-territory destinations validate project-scoped membership; new-territory
  destinations create the territory and the bubble in one transaction. The auto-delete of a
  territory losing its last bubble is removed.
- **Knowledge-extraction backend changes:** The `new_bubble` resolution input carries the same
  optional destination with the same semantics and the same atomicity, implemented through the
  existing territory/bubble ports — extraction still never talks to `DiscussionsService` or
  `ModelClient` for this.
- **Canvas and workspace UI:** The fourth bottom-bar action with its creation dialog; the
  empty-territory card body; rename and delete affordances on the territory card header with the
  delete confirmation; removal of the `Recompose territories` header action and its states.
  Viewport-centered placement is computed where viewport state already lives and passed down as a
  typed callback, so destination-created territories place identically from the extraction and
  bubble-creation flows.
- **Destination selector UI:** One selector component owned where the flows converge, rendered in
  the bubble-creation flow (bubbles feature) and the extraction proposal review
  (knowledge-extraction feature), defaulting to `Ungrouped`, listing territories by title, and
  exposing the inline new-territory title input with shared-limit validation.
- **Collection refresh:** Territory create, rename, and delete update the canvas collection with
  the same explicit load-state and optimistic/refresh discipline existing territory mutations use.
- **Accessibility and analytics** as defined in the success criteria, including retiring
  recompose events and updating the architecture-improvement ledgers where recompose removal
  supersedes recorded weaknesses.

### Out of scope

- Moving an existing bubble between territories after creation, by any means
- Any AI-assisted composition: recompose has no successor in this PRD, and no model call is added
  or kept for territory purposes
- Renaming, deleting, hiding, or repositioning rules for `Ungrouped` beyond PRD 10's
- Reordering bubbles inside a territory; per-bubble positions
- Nested, overlapping, or shared territories; merging or splitting territories
- Bulk assignment (moving many bubbles at once), territory-level actions on member bubbles
- Uniqueness constraints on territory titles (duplicates are allowed; territories are addressed
  by id everywhere)
- Territory membership as knowledge: frozen context, mentions, extraction prompts, and document
  flows still never see territories
- Changing discussion, document, reader, inspector, selection, compact, or viewport behavior

## Risks / Open Questions

- **Losing the scale thesis:** PRD 10's bet was that AI clustering beats hand-placement at scale;
  this PRD bets the opposite — that user-owned groupings beat model-owned ones. A project with
  hundreds of ungrouped bubbles now has no one-action organizer. Accepted deliberately: manual
  curation plus per-bubble destination choice keeps `Ungrouped` from growing unbounded in normal
  use, and an AI assist can return later behind the same structured-output seam without contract
  changes to the manual model.
- **Destination friction at extraction:** Extraction resolution was one click; the selector adds
  a decision. Defaulting to `Ungrouped` keeps the fast path one click — the selector costs
  nothing unless the user engages it. If the selector's territory list grows long, a follow-up
  can add filtering; this PRD renders a plain list.
- **Atomic new-territory destination:** The new-territory path spans two features (territories,
  bubbles — and extraction above them). The transaction lives with the feature that owns the
  triggering workflow, composing the existing ports; if port composition cannot express one
  transaction cleanly, the fallback is a narrow explicit capability, not cross-feature SQL.
- **Kind migration:** Changing the `kind` CHECK constraint likely rebuilds the territories table
  under SQLite with FKs re-established; bubbles' `territory_id` references must survive. Covered
  by the migrations spec against a PRD 10-era database, including one whose composed territories
  are non-empty.
- **Empty-territory drift:** Territories that are never filled and never deleted accumulate as
  visible empty cards. Accepted: they are the user's own artifacts, cost one delete each, and
  hiding them (the `Ungrouped` rule) would make just-created territories invisible — the worse
  failure. Compact layout treats an empty card like any other measured card.
- **Placement collisions:** Every creation places at the viewport center, so consecutive
  creations stack. Placement applies a small deterministic offset when the computed point is
  already occupied by a territory anchor; beyond that, overlap is resolved by drag or compact,
  as PRD 10 already accepts for arbitrary drags.
- **Rename surface:** Inline header editing competes with drag (the header is the drag handle).
  The rename affordance must be a distinct focusable control (not click-to-edit on the title
  text) so drag, selection, and rename never share a gesture. Exact affordance is a design
  detail inside this constraint.
- **Deleted-territory expectations:** Users may fear delete destroys bubbles. The confirmation
  copy states the exact bubble count moving to `Ungrouped`; analytics record the moved count to
  verify the flow behaves as promised.

## Commit Plan

MVP decisions used by this plan: recompose is removed with no successor; `composed` migrates to
`manual`; empty manual territories render with an explanatory message and are only removed by
explicit delete; last-bubble deletion no longer deletes a territory; destinations default to
`Ungrouped` and exist at bubble creation and extraction `new_bubble` resolution only; territory
titles need not be unique; placement is viewport-centered with a deterministic collision nudge.

1. **`feat(shared): manual territory contracts, retire recompose`**
   Change `TerritoryKind` to `'manual' | 'ungrouped'`; add create/rename/delete territory
   contracts and the `TerritoryDestination` union; thread the optional destination through the
   bubble-creation and extraction `new_bubble` resolution inputs; remove the recompose contracts
   and recompose-only limits. Update both sides' imports mechanically so the workspace compiles.
   *Verify: full build, lint, unit.*

2. **`feat(backend): create, rename, and delete territories`**
   Migrate `composed` → `manual` (table rebuild preserving rows, FKs, and indexes). Add the
   create, rename, and delete endpoints to `territories/`: title validation against the shared
   limit, manual-only guards with stable errors for `Ungrouped` targets, and transactional delete
   that reassigns member bubbles to the ensured `Ungrouped` territory through the bubbles
   assignment port. Remove the auto-delete of a territory losing its last bubble. Cover the
   migration (PRD 10-era database, composed territories with and without bubbles) and the new
   lifecycle in unit and e2e tests.
   *Verify: backend build, lint, unit, e2e.*

3. **`feat(backend): route bubble destinations, remove recompose`**
   Accept the optional destination in bubble creation and extraction `new_bubble` resolution:
   validate existing-territory destinations project-scoped, create new-territory destinations
   atomically with the bubble, default to `Ungrouped`. Remove the recompose endpoint, service,
   prompt, tests, and the fake model client's composition support if now unused. Extend e2e
   journeys: bubble into existing territory, extraction into new territory, atomic failure
   leaving no orphan territory.
   *Verify: backend build, lint, unit, e2e.*

4. **`feat(frontend): create territories from the action bar`**
   Add the fourth bottom-bar action and its creation dialog (title validation, viewport-centered
   placement with collision nudge, focus management), render the empty-territory card body, and
   remove the `Recompose territories` header action with its states and API module surface. Keep
   collection load states and mutation retry semantics unchanged.
   *Verify: frontend build, lint, unit.*

5. **`feat(frontend): rename and delete territories from the card`**
   Add the header rename affordance (distinct control, keyboard cancelable, shared-limit
   validation, save-indicator surfacing) and the delete flow with its bubble-count confirmation,
   refreshing the collection so moved bubbles appear under `Ungrouped`. Territory stays rendered
   when its last bubble is deleted.
   *Verify: frontend build, lint, unit.*

6. **`feat(frontend): pick a destination at bubble creation and extraction`**
   Build the destination selector (default `Ungrouped`, territories by title, inline new-territory
   title input) and render it in the bubble-creation flow and the extraction proposal review,
   wiring placement through the workspace-provided callback. New-territory resolution creates,
   assigns, and closes the extraction flow on success; failures stay retryable in each flow's
   existing error surface.
   *Verify: frontend build, lint, unit.*

7. **`feat(frontend): manual-territory analytics, accessibility, and close-out`**
   Instrument creations by source, renames, deletions with moved counts, and destination kinds —
   never titles or content — and retire recompose events. Complete keyboard operability, labels,
   announcements, and reduced motion across the dialog, rename, delete confirmation, selector,
   and empty state. Add integration journeys: create-rename-delete round trip, empty card
   persistence, extraction into a new territory closing the flow, bubble creation into an
   existing territory, and a PRD 10-era project opening with composed territories as manual.
   Update the architecture-improvement ledgers where recompose removal supersedes recorded
   weaknesses.
   *Verify: full build, lint, unit, backend e2e; manual UI QA separately.*

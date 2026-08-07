# PRD 09 — Inline Mention Context for Discussions

## Problem

PRD 04 shipped discussion context as a four-step flow: the user writes a first prompt, submits it,
lands on an invitation screen, then leaves the modal to pick bubbles (the canvas takes over) or
documents (the right panel takes over), and finally confirms a separate review step before the
discussion actually starts. Every guarantee it established is right — explicit selection, mandatory
project description, snapshot at confirmation, immutable frozen context — but the path to them
costs four surfaces and hides the composer at the exact moment the user is mid-thought.

The new design — `design/project/Discussion Context Flow.html`, section **1a**, frames **A1–A5** —
collapses selection into the composer itself. Typing `@` while drafting opens one searchable list
that groups bubbles and documents together; attaching turns a source into a removable chip above
the input; the project description is present from the first frame as a locked, non-removable chip;
and a persistent line states how many sources will freeze when the user sends. Sending is the
confirmation: chips become the existing frozen badges and the composer states that context is now
locked. The variant in section 1b (persistent side rail) was considered and not adopted.

This PRD owns the mention-driven selection experience: the `@` trigger, the unified source list,
attachment chips, the freeze-count line, the empty-project state, and the post-send frozen
transition. It deliberately changes no backend behavior: the frozen-context data model, atomic
creation, idempotency, budget validation, context badges, and the frozen Inspector from PRD 04
remain the authority. PRD 04's success criteria for immutability, snapshot timing, and inspection
still hold; this PRD supersedes only its selection-flow criteria and UI (invitation, canvas and
panel takeover selection, and the separate review step).

## Target Users and Feature Impact

- **Primary user:** An individual starting a focused discussion who already knows, while writing
  the question, which project knowledge it should draw on.
- **User need:** Attach bubbles and documents without leaving the composer or losing the draft,
  see at all times exactly what will freeze, and keep the option to just ask with project context
  only.
- **Feature impact:** Selection moves from a workspace-spanning coordinator (invitation → canvas
  takeover → panel takeover → review) into the discussion draft itself. The canvas and Documents
  panel no longer host discussion-context selection modes; the workspace's role shrinks to
  supplying a read-only source catalog to the draft.

## Success criteria

1. A user can attach context sources while writing the first prompt, on the same surface, without
   submitting the prompt first and without any separate invitation or review step.
2. Typing `@` in the draft composer opens one list containing both project bubbles and project
   documents, grouped by kind, filtered by the text typed after `@`.
3. The mention list is fully keyboard operable: arrows move, Enter attaches, Escape dismisses and
   returns focus to the composer without losing the draft.
4. Attaching a source adds exactly one removable chip above the composer; attaching the same source
   again does not create a duplicate chip.
5. A chip can be removed before sending — via its remove control or by deleting its mention token
   in the draft text; either way removes both the chip and the token, affects only the pending
   attachment, and never touches the source itself.
6. Chip removal plays a brief exit animation so a detach caused by text editing is never silent;
   the animation respects reduced-motion preferences.
7. The project description appears from the first frame as a visually locked, non-removable chip
   labeled as always included.
8. A persistent line near the send button states the number of sources that will freeze on send,
   counting the project description plus every attached chip.
9. The user can send with no attached sources; the discussion is created with only the frozen
   project-description snapshot, and nothing in the flow nags or blocks.
10. Documents that are not ready for model use are visible in the mention list but cannot be
    attached, with a document-specific explanation; ready documents are identifiably marked.
11. Only whole documents can be attached; no passage, page, or excerpt selection exists.
12. Sources from another project never appear in the mention list, and the server continues to
    reject cross-project identifiers regardless of client state.
13. In a project with no bubbles and no documents, the mention list shows an explicit empty state
    that says the project description is already included and offers the two creation paths
    (upload a document, create a bubble) without blocking the prompt.
14. Starting a discussion from a selected canvas bubble (or multi-selection) pre-attaches those
    bubbles as chips in the draft; the user can remove them like any other chip.
15. Dismissing or abandoning the draft discards pending chips and creates no durable records;
    switching projects resets all pending state.
16. Snapshots are still created only at send: the frozen content is the latest authorized source
    value at creation time, exactly as PRD 04 defines.
17. Sending performs the same atomic creation as PRD 04: discussion, complete frozen-context
    package, and first user turn persist as one coherent operation under one idempotency key;
    duplicate clicks and retries create no duplicate discussions or snapshots.
18. If a selected source is deleted, becomes inaccessible, or fails validation at send, creation
    stops, the affected chip is identified from the structured server error, and the prompt plus
    remaining chips are preserved for correction and retry.
19. Context-size rejection continues to block creation with an actionable message; nothing is
    silently truncated or dropped.
20. After successful creation the chips hand off to the existing frozen context badges, and the
    composer area states that context is locked for this discussion, when it froze, and that a new
    discussion is the way to change it.
21. After send, no interface exists to add, remove, refresh, or disable context — unchanged from
    PRD 04 — and reload, minimize, and reopen restore badges from persisted context only.
22. The wire contract is unchanged: creation still submits ordered `bubble_ids` and `document_ids`
    with an idempotency key, and frozen order remains project description, then bubbles, then
    documents in attach order.
23. The canvas multi-selection and Documents panel selection surfaces no longer activate for
    discussion-context selection; their other consumers (compact layout, extraction, document
    management) are unaffected.
24. The mention popover implements the ARIA combobox pattern (or equivalent) with correct roles,
    active-descendant management, and live result counts; chip removal and attach actions are
    announced.
25. Analytics record mention-list opens, attaches (kind and input method), chip removals — split
    by remove control versus token deletion — empty-state displays and CTA activation, not-ready
    attach attempts, and per-creation source counts — identifiers, kinds, and counts only, never
    titles or content.

## Scope

### In scope

- **Mention trigger and popover:** Detect `@` at the caret in the draft composer; render a single
  anchored popover with a search echo, grouped bubble and document results, match count, keyboard
  navigation, and the footer hint row shown in frame A2.
- **Unified source catalog:** A typed, read-only, project-scoped catalog (id, kind, title,
  secondary line, document readiness) assembled by the workspace — the existing lowest common
  owner of bubble and document state — and passed into the discussions feature. No new fetching
  and no `fetch` in feature code.
- **Attachment chips:** The chip row from frames A1/A3: locked project-description chip first,
  one removable chip per attached source, kind icons, deduplication, and overflow handling that
  never hides the total count.
- **Inline mention rendering:** The attached source's title rendered as a highlighted token in the
  draft text (frame A3). Token and chip are one attachment: removing the chip deletes its token
  text, and editing or deleting the token text detaches the chip — the CLI-mention model — with a
  brief chip exit animation so a text-driven detach is never silent. Backspace at a token's edge
  deletes the whole token atomically. The draft and the persisted message are plain text
  throughout; no markup ever reaches the creation request.
- **Freeze-count line:** The persistent `N SOURCES FREEZE WHEN YOU SEND` line, updating with the
  chip set, and the pre-attach hint (`Type @ to bring in a bubble or document`).
- **Empty-project state:** Frame A5's empty mention list with the two creation CTAs, delegated via
  callbacks to the owning features (documents upload, bubble creation); the draft remains sendable
  throughout.
- **Entry-point convergence:** Panel action, canvas action, selected-bubble, and multi-selection
  entries all open the same draft; bubble entries seed chips instead of entering a selection mode.
- **Coordinator simplification:** Collapse the phase machine (`invitation`, `selecting_bubbles`,
  `selecting_documents`, `review`) into the draft state; retain pending-source ownership,
  deduplication, submit/error/failure handling, selection revisions, idempotency-key rotation, and
  project-change reset.
- **Send-time behavior:** Unchanged creation request and failure handling; structured source
  errors mapped onto specific chips; prompt and chips preserved through recoverable failures;
  failed-turn recovery unchanged once the discussion is coherently persisted.
- **Frozen transition:** Frame A4's handoff — chips to the existing frozen badge row, plus the
  locked-context line with the freeze time in the composer area.
- **Decommissioning:** Remove the invitation and review screens, the canvas takeover wiring, and
  the Documents panel context-selection activation for discussions, without breaking those
  surfaces' other owners.
- **Accessibility and analytics** as defined in the success criteria.

### Out of scope

- Any change to backend contracts, frozen-context persistence, snapshot assembly, budget
  validation, idempotency, or the discussion lifecycle
- Any change to frozen badges, the frozen Inspector, or the immutable-context contract after send
- Adding, removing, or refreshing context in an existing discussion
- Automatic, recommended, or ranked context; mention autocomplete driven by prompt semantics
- Passage, page, excerpt, or partial-document selection
- Mentioning discussions, messages, frozen context, or sources outside the project
- Full in-composer document upload or bubble authoring (the empty-state CTAs route to the owning
  features; their flows are unchanged)
- Persisting unfinished drafts or pending chips across sessions
- The 1b side-rail variant from the design file
- Rich-text editing of the draft beyond the mention token rendering

## Risks / Open Questions

- **Token-versus-chip coupling:** Token and chip are one attachment, matching the mention model of
  AI CLIs: any edit that breaks a token's text detaches its chip, and removing a chip deletes its
  token. The residual risk is an accidental detach while editing near a token; it is mitigated by
  atomic whole-token deletion at the token's edges and by the animated chip exit, which makes the
  detach visible the moment it happens. Restoring an accidentally detached source is one `@`
  mention away, so no undo mechanism is warranted for the MVP.
- **Persisted prompt text:** Frame A4 shows the sent message as plain prose. Because tokens are
  literal title text at tracked positions, the draft already is the message — nothing is
  serialized or substituted at send, and no markup can leak into the immutable message record.
- **Highlight fidelity:** The backdrop-highlight technique chosen for commit 3 (findings recorded
  there) depends on the mirror element sharing the textarea's exact text metrics; a mismatch shows
  as a drifted highlight, not data corruption. Sharing one class set between the two elements and
  covering wrap-heavy drafts in tests bounds the risk, and the worst-case degradation is an
  unhighlighted but perfectly editable plain-text mention.
- **Popover reach versus canvas browsing:** The old canvas takeover let users spatially browse
  before choosing; the mention list is search-first. Users who don't remember a bubble's name may
  miss it. The canvas-seeded entry (select bubbles, then start a discussion) remains the browsing
  path, so both recall styles survive — this should be watched in analytics rather than solved
  preemptively.
- **Not-ready documents:** Showing them disabled (leaning, per frame A2's `READY` marker being the
  exception state) preserves the PRD 04 rule that unprocessed documents cannot silently join
  context, but a mostly-disabled list in a young project may read as broken; the empty-state copy
  and per-item explanations carry that weight.
- **Empty-state CTAs cross features:** `Upload a document` and `Create a bubble` from inside the
  draft cross into documents and bubbles ownership. They must stay thin callbacks that open the
  owning feature's existing flow; the open question is whether the draft survives in the
  background (leaning: yes, minimized, consistent with the existing write-first draft).
- **Chip overflow:** Many attachments can outgrow the chip row. The frozen badge row already
  solved overflow (limited row plus complete expandable list); the pending row should reuse that
  pattern rather than invent one.
- **Freeze-count honesty:** The count includes the always-on project description (frame A5 shows
  `1 SOURCE` with nothing attached). This is the honest number but may momentarily confuse users
  who attached nothing; copy should make the description chip visibly part of the count.
- **Coordinator refactor blast radius:** `ProjectWorkspace` wires selection phases into the
  canvas, Documents panel, overlays, and the discussion modal. Collapsing the phase machine
  touches all of them; the commit plan isolates the removal into one refactor commit with the
  seams re-verified by the existing integration tests before decommissioning.
- **Frozen timestamp display:** Frame A4 shows `frozen at 14:32`. The context creation time is
  persisted; display formatting (relative versus absolute, timezone) should follow the existing
  workspace conventions rather than introduce a new format.

## Commit Plan

The reference design is `design/project/Discussion Context Flow.html`, section **1a** (frames
**A1–A5**); frame 0a in the same file documents the flow being replaced. All work is frontend: the
backend keeps the PRD 04 contract (`bubble_ids`, `document_ids`, `idempotency_key`; snapshot at
confirmation; atomic creation; frozen order description → bubbles → documents), so no backend or
shared-package commit is required. Discussions owns the mention flow; the workspace supplies the
source catalog; canvas and documents give up their discussion-selection modes but keep every other
responsibility.

MVP decisions used by this plan: token and chip are one attachment — deleting a token's text
detaches its chip (with an animated, reduced-motion-aware exit so the detach is visible) and
removing a chip deletes its token, mirroring the mention model of AI CLIs; the draft is plain text
with tokens as tracked ranges, so the persisted message needs no serialization; not-ready
documents are visible but unattachable; the freeze count includes the project description;
canvas-seeded entries pre-attach chips; the pending chip row reuses the frozen badge row's
overflow pattern; and the draft survives (minimized) when an empty-state CTA opens another
feature.

1. **`feat(frontend): expose a project source catalog to the discussion draft`**
   In the workspace (already the lowest common owner of bubble and document state), assemble a
   typed read-only catalog of mentionable sources — id, kind, title, secondary line, and document
   readiness — from the existing `useProjectBubbles` and `useDocumentLibrary` state, with no new
   fetching. Pass it into the discussions feature as a prop-level port so components stay testable
   with fakes. Cover filtering, readiness mapping, cross-project exclusion, and empty projects.
   *Verify: frontend build, lint, unit.*

2. **`feat(frontend): open the mention list from the draft composer`**
   Implement frame A2 of `design/project/Discussion Context Flow.html` (1a): detect `@` at the
   caret in the draft composer, anchor one popover above it with the typed query echoed, grouped
   `BUBBLES` and `DOCUMENTS` results, match count, ready markers, disabled not-ready documents
   with per-item explanations, and the `↑↓ move · ⏎ attach · esc dismiss` footer. Use the ARIA
   combobox pattern with active-descendant management and a live result count. Include frame A5's
   empty state with the two creation CTAs as injected callbacks (no documents or bubbles logic in
   discussions). Selection here only reports the chosen source; attachment state lands in the next
   commit. *Verify: frontend build, lint, unit.*

3. **`feat(frontend): attach mention sources as chips with a live freeze count`**
   Implement frames A1 and A3: the chip row above the composer with the locked, non-removable
   `Project description · ALWAYS` chip first, one removable chip per attached source with kind
   icons and deduplication, and the `N SOURCES FREEZE WHEN YOU SEND` line counting the description
   plus attachments. Token and chip are one attachment: removing a chip deletes its token text,
   any edit that breaks a token's text detaches its chip, Backspace or Delete at a token edge
   removes the whole token atomically, and every chip removal plays a brief reduced-motion-aware
   exit animation so text-driven detaches are never silent. Reuse the frozen badge row's overflow
   pattern for many chips. Sending stays enabled with any non-empty prompt and zero attachments.
   *Implementation findings:* the highlight uses the backdrop-mirror technique — a `div` painted
   behind the existing `<textarea>` with identical text metrics (`white-space: pre-wrap`, shared
   font/padding classes, synced scroll), the textarea's text made transparent with a visible
   `caret-color`, and the mirror rendering the same string with token ranges wrapped in styled
   spans. This keeps native caret, selection, IME, paste, undo, and mobile behavior — everything
   `contenteditable` breaks — needs no editor dependency, and leaves `useAutoGrowTextarea`
   untouched since the textarea still owns the text. Tokens are literal title text tracked as
   character ranges in a pure draft model: each controlled change is diffed against the previous
   value (common prefix/suffix), ranges after the edit shift by the length delta, and a range the
   edit intersects is dropped, which is what detaches the chip; the model is framework-free and
   unit-testable without DOM. *Verify: frontend build, lint, unit.*

4. **`refactor(frontend): collapse the context-selection coordinator into the draft`**
   Rework `useDiscussionContextSelection` to a draft-shaped state: remove the `invitation`,
   `selecting_bubbles`, `selecting_documents`, and `review` phases plus `returnPhase`, keeping
   pending-source ownership, deduplication, `submitting`/`error` handling, structured
   source-failure mapping onto chips, selection revisions, idempotency-key rotation, and
   project-change reset. Remove the invitation and review screens from
   `DiscussionContextSelection`, the canvas takeover and Documents panel activation wiring from
   `ProjectWorkspace`, and the phase plumbing in `DiscussionExperience`. Selected-bubble and
   multi-selection entry points now seed chips in the draft. Canvas multi-selection and document
   selection seams survive for their other owners. Recoverable creation failures preserve the
   prompt and remaining chips and mark the offending chip from the server's structured error.
   *Verify: frontend build, lint, unit.*

5. **`feat(frontend): hand pending chips off to frozen badges after send`**
   Implement frame A4: on successful creation the chip row yields to the existing persisted frozen
   badge row, and the composer area shows the locked-context line — context frozen for this
   discussion, the freeze time, and that a new discussion is the way to change it — using the
   persisted context creation timestamp and the workspace's existing time formatting. Reload,
   minimize, and reopen restore badges and the locked line from persisted context only. No change
   to badge rendering, the frozen Inspector, or immutability enforcement. *Verify: frontend build,
   lint, unit; manual UI QA against frames A1–A5 separately.*

6. **`feat(frontend): mention-flow analytics, accessibility, and close-out`**
   Instrument mention-list opens, attaches (source kind, keyboard versus pointer), chip removals,
   empty-state displays and CTA activation, not-ready attach attempts, and per-creation attached
   counts — identifiers, kinds, counts, and error codes only, never titles or content — and retire
   selection-phase events that no longer exist. Complete focus restoration, non-color-only ready
   states, reduced motion, and announced attach/remove actions. Add integration journeys: attach
   via keyboard and pointer, duplicate mention, chip removal via the remove control and via token
   deletion (including atomic edge deletion), zero-attachment send, not-ready document, empty project with CTA, canvas-seeded entry, source failure with retry preserving the
   draft, and reload after creation. Update `FRONTEND_ARCHITECTURE_IMPROVEMENTS.md` where this
   supersedes recorded weaknesses, and annotate PRD 04 to point its selection-flow sections here.
   *Verify: full build, lint, unit, and backend e2e; manual UI QA separately.*

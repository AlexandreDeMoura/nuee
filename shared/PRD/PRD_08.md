# PRD 08 — Guided Bubble Extraction

## Problem

PRD 05 shipped extraction as a source picker in front of a fixed prompt: tick messages, get one
proposal, review it. What the bubble becomes is entirely the model's call, and the prompt gives it
no sense of length — it asks for coherent content and advertises a 50,000-character ceiling. In
practice extraction produces bubbles of 900 words and more, which is well past what a unit of
canvas knowledge should hold.

The user already knows why they are extracting. The same AI answer becomes a different bubble
depending on whether it is filed as an investment risk or a logistics fact, and on whether the
project wants one line or three paragraphs. Today the only way to express that is to rewrite the
generated draft by hand, which defeats the point of generating it.

The request step also reads as a flat list of equally-weighted source cards with no sense of
sequence, no visible count of what is included, and no way to take the whole thread in one click.

This PRD reworks the extraction request into one deliberate `Extract as bubble` dialog with three
ordered steps: what to include, optional instructions, and how much detail. It adds two new request
parameters — free-text instructions and a three-level detail choice — and replaces the
`whole_discussion` selection mode with an explicit `Select all`.

This PRD owns the request-step dialog, message-list presentation, the instructions and detail-level
contracts through to the extraction prompt, and their persistence in the extraction attempt. It
does not change proposal review, the three resolutions, provenance, placement, target-update
concurrency, frozen-context assembly, or discussion messages. PRD 05 remains the reference for
everything downstream of `Generate bubble`.

## Target Users and Feature Impact

- **Primary user:** An individual extracting a bubble from a focused discussion who has a specific
  intent for it — a framing, an emphasis, an omission, a length — that the model cannot infer from
  the selected messages alone.
- **User need:** Say what the bubble is for before it is generated, and get a draft that already
  fits the project instead of one that must be rewritten in review.
- **Feature impact:** Turns extraction from a one-shot summarizer into a directed one. The
  instructions become a second, clearly-subordinate input next to the source snapshot, so the
  grounding guarantees of PRD 05 must survive contact with arbitrary user text.

## Success criteria

### Dialog and structure

1. The extraction request is presented as one dialog titled `Extract as bubble` that names the
   source discussion, with a close control and a footer holding `Cancel` and `Generate bubble`.
2. The dialog presents three numbered, labelled steps in order: what to include, instructions
   (marked optional), and how much detail. All three are reachable without leaving the dialog.
3. The footer summarizes the pending request — selected message count and chosen detail level — and
   states that the draft is reviewed before it lands on the canvas.
4. Both `Cancel` and the close control leave without creating a proposal, modifying the discussion,
   or touching project knowledge, and return focus to the entry point that opened the dialog.
5. The existing entry points are unchanged: the discussion header and below every completed AI
   response. Launching below a response preselects that response and marks it in the list as the
   message extraction started from.

### Message selection

6. Messages are listed in discussion order with their role, their position in the thread, and a
   truncated preview of their content.
7. A count of selected messages against the total is visible while selecting (`2 of 5 messages`).
8. A `Select all` control ticks every eligible message in one action; once everything is ticked the
   same control clears the selection.
9. Individual messages remain independently toggleable with checkbox semantics, keyboard operation,
   and a visible selected state, before and after using `Select all`.
10. The `whole_discussion` selection mode is removed from the request contract. Every submitted
    request carries the explicit list of message identifiers the user ticked, and the generated
    snapshot contains exactly those messages — nothing is resolved or expanded at submission time.
11. Frozen-context snapshots attached to the discussion remain selectable in a distinct group below
    the messages, with their PRD 05 semantics unchanged.
12. `Generate bubble` stays disabled until at least one eligible source — message or frozen
    snapshot — is selected.

### Instructions

13. Step 2 offers an optional multi-line instructions field explaining that it says what the bubble
    is for or what to leave out.
14. Omitting instructions produces the same request and the same prompt as before this change.
15. Preset suggestion chips insert their text into the instructions field, where the user can edit
    or clear it. A chip never submits the request and never acts as a hidden mode.
16. Instructions are capped at a documented maximum length, validated at the HTTP boundary, and
    rejected with a field-level error that identifies the field.
17. Instructions reach the model as untrusted user intent that may shape framing, emphasis,
    ordering, and omission. They never grant authority to add claims absent from the sources, to
    drop preserved uncertainty, to change the output shape, or to override the system extraction
    rules.
18. Instructions asking for material that is not in the selected sources produce a proposal that
    stays grounded in those sources rather than inventing the requested content.
19. Instruction text never appears in the proposal as visible instruction, preamble, or metadata.

### Detail level

20. Step 3 offers exactly three single-select detail levels — tight, standard, detailed — with
    standard preselected, each showing its expected length, all keyboard-reachable.
21. Detail level changes the proposal's content only. Title and summary expectations are identical
    at every level.
22. The levels target roughly one to two sentences, a short paragraph, and two to three paragraphs
    respectively. `detailed` is the ceiling of that range, not an expansion of current behavior:
    every level, including `detailed`, produces materially shorter content than today's unguided
    prompt, and `standard` is the default because it is the length a bubble should usually be.
    These targets are prompt guidance, not a rejection rule.
23. Detail level is a required, validated enum at the HTTP boundary; an unknown value is rejected
    with a field-level error.

### Request identity and persistence

24. Instructions and detail level are part of the extraction request: persisted with the attempt,
    immutable afterward, and reused unchanged when a failed generation is retried.
25. Both participate in the request fingerprint after normalization, so reusing an idempotency key
    with different instructions or a different detail level is a conflict rather than a silent
    second generation. Whitespace-only differences do not create a false conflict.
26. Replaying an identical request returns the existing proposal without a second model call, as
    today.

### Downstream and cross-cutting

27. Proposal review, editing, the three resolutions, provenance, placement, and target-update
    concurrency are unchanged. Review offers no path back to change instructions and regenerate.
28. Instructions and detail level are request parameters only. They are not stored on the created or
    updated bubble and do not appear in provenance or in any bubble-facing surface.
29. The whole request step is operable by keyboard: step order, checkbox roles for messages, buttons
    for chips, radio-group semantics for detail, an announced selection count, errors associated
    with their controls, and focus returned on cancel.
30. Analytics record the chosen detail level, whether instructions were supplied and their length
    band, and whether `Select all` was used — never instruction text, message text, or proposal
    fields.

## Scope

### In scope

- **Request dialog:** One `Extract as bubble` surface replacing the current selection panel —
  header naming the source discussion, three numbered steps, and a summary footer with `Cancel` and
  `Generate bubble`. It obeys the single-visible-modal rule the discussions feature already owns.
- **Message list presentation:** Role, thread position, truncated preview, selected state, the
  extracting-from marker for the response-level entry point, a selected-of-total counter, and an
  internally scrollable list so steps 2 and 3 stay reachable in long discussions.
- **Select all:** A client-side control that ticks every eligible message and clears them when all
  are ticked. It always submits explicit identifiers.
- **Whole-discussion removal:** Drop the `whole_discussion` variant from the shared contract, the
  service validation, the source reader, the frontend state machine, and analytics. The persisted
  snapshot keeps its `message_selection_kind` field pinned to `selected` so the existing attempts
  table constraint needs no rebuild.
- **Instructions contract:** Optional `instructions` on the create input — trimmed, length-capped,
  empty normalized to absent — validated at the HTTP boundary alongside the existing unknown-field
  rejection.
- **Preset chips:** A small static set of instruction starters that fill the field.
- **Detail-level contract:** A required `detail_level` enum (`tight` | `standard` | `detailed`) on
  the create input, defaulted client-side to `standard`.
- **Attempt persistence:** Migration 011 adding both values to `knowledge_extraction_attempts` as
  columns, covered by the existing source-immutability trigger, so retries and replays reuse the
  original request exactly.
- **Fingerprint extension:** Normalized instructions and detail level folded into the request
  fingerprint, keeping the existing idempotency-conflict behavior.
- **Prompt shaping:** A detail-level guidance clause affecting content only, plus a clearly
  delimited untrusted-instructions section with explicit precedence — grounding, uncertainty
  preservation, and output rules outrank the instructions. The content field's schema description
  stops advertising the 50,000-character application limit, which currently anchors the model toward
  long answers; the limit remains as a validation rule. The structured-output shape and the title
  and summary descriptions are otherwise unchanged.
- **Model input budget:** The instructions block counts toward the existing structured-output budget
  check, so an oversized request is still rejected with the actionable error.
- **Analytics:** Detail level, instruction-supplied flag and length band, and select-all usage added
  to the existing extraction generation event under the identifier-only policy.

### Out of scope

- Regenerating a draft with modified instructions or a different detail level after review
- User-defined, saved, or per-project instruction presets
- Remembering the last used instructions or detail level across extractions
- A per-project or global default detail level
- Persisting instructions or detail level on the resulting bubble, or exposing them in provenance
- Content-shape hints on message previews (detecting tables, code blocks, or lists)
- Rich text, Markdown, or mentions inside the instructions field
- Selecting text spans inside a message, or passages inside a frozen snapshot
- Producing more than one bubble, or splitting a proposal, from one request
- Streaming or progressively revealing the draft as it generates
- Exposing model choice, temperature, or any other generation parameter
- Instruction-driven tool use, including web search, inside extraction
- Any change to review fields, the three resolutions, placement, provenance, target-update
  concurrency, frozen-context assembly, or discussion activity semantics

## Risks / Open Questions

- **Instructions as an injection surface:** A free-text field routed into the extraction prompt is
  the most direct path a user has to the model, and the same field could later carry text pasted
  from elsewhere. The current leaning is a delimited untrusted section, explicit precedence rules
  in the system instructions, an unchanged structured-output schema, and a length cap — plus the
  existing mandatory review as the last line of defense. Grounding is prompt-enforced, not
  mechanically provable.
- **Detail level is guidance, not a contract:** Length is the problem this control exists to solve,
  and the only mechanism proposed for it is the prompt. Rejecting an overlong draft would turn a
  soft preference into a failure state and throw away a good bubble over a paragraph, so validation
  is not the answer. The current leaning is prompt guidance plus removing the character-count anchor
  from the schema description, with the user free to trim in review. If drafts keep running long at
  `standard`, the next lever is a per-level soft target stated in the field description — not a
  rejection rule.
- **Acceptance needs a length check:** Criterion 22 asserts a reduction against current behavior,
  which no unit test can prove. Acceptance should include a small manual comparison — the same
  sources extracted before and after, at each level — rather than assuming the prompt worked.
- **Losing whole-discussion semantics:** `whole_discussion` guaranteed the snapshot covered every
  persisted message at submission time, including any that arrived while the dialog was open.
  Explicit identifiers give up that guarantee in exchange for a request that is exactly what the
  user saw and ticked. The dialog takes over the discussion surface and no composer is available
  while it is open, so the window for divergence is effectively closed. Existing persisted attempts
  carrying the old value are ephemeral and expire within a day.
- **Fingerprint sensitivity:** Folding free text into the fingerprint makes trivial edits — a
  trailing space, a re-typed character — look like a different request. The current leaning is to
  normalize whitespace before hashing and to keep the client's idempotency key stable only while the
  normalized request is stable.
- **Instructions versus review:** Once the request accepts intent, the natural next wish is to
  adjust that intent after seeing the draft. This iteration deliberately stops at review-and-edit;
  if users start cancelling and re-extracting to reword instructions, that is the signal that a
  regenerate path is worth its state-machine cost.
- **Chips reading as modes:** Suggestion chips that fill a text field can be mistaken for toggles,
  especially when one is clicked and the field visibly changes. The current leaning is plain buttons
  labelled as examples under a `TRY` prefix, with no selected state.
- **Step depth in long discussions:** With a long thread, steps 2 and 3 fall below the fold. The
  current leaning is an internally scrollable message list with a fade affordance, keeping the
  footer summary and both later steps visible.

## Commit Plan

Backend before frontend; each commit leaves build, lint, and the affected side's unit tests (plus
backend e2e where noted) green.

1. **`feat(shared): add extraction instructions and detail level contracts`**
   Add `KnowledgeExtractionDetailLevel`, add `instructions` and `detail_level` to
   `CreateKnowledgeExtractionInput`, and replace `KnowledgeExtractionMessageSelection` with an
   explicit `message_ids` list on the input and on `KnowledgeExtractionSourceReference`.
   *Verify: build.*

2. **`refactor(backend): submit extraction sources as explicit message identifiers`**
   Remove the whole-discussion branch from the service validation, the fingerprint, and the
   `DiscussionExtractionSourceReader`; pin the persisted snapshot's `message_selection_kind` to
   `selected`; keep the source-count limit and the missing/cross-scope error details unchanged.
   *Verify: backend build, lint, unit, extraction e2e.*

3. **`feat(backend): persist extraction instructions and detail level`**
   Migration 011 adding both columns to `knowledge_extraction_attempts` with an enum check and a
   `standard` default, extended immutability trigger, repository mapping, boundary validation
   (trim, length cap, enum, unknown-field rejection), fingerprint extension over the normalized
   values, and retry reuse of the persisted request. *Verify: backend build, lint, unit, e2e.*

4. **`feat(backend): shape the extraction prompt with intent and detail`**
   Detail-level guidance affecting content only, a delimited untrusted-instructions section with
   explicit precedence over user text, the character-count anchor removed from the content field's
   schema description while its validation limit stays, and the instructions block counted in the
   model input budget. Prompt tests cover each level, the empty-instructions path, and an
   instruction attempting to override grounding or output rules.
   *Verify: backend build, lint, unit.*

5. **`feat(frontend): carry extraction intent through the request layer`**
   `api/knowledgeExtractions.ts` sends the new fields and explicit identifiers; the state machine
   and `useKnowledgeExtraction` drop whole-discussion mode, hold instructions and detail level as
   part of the selection, and reset them on every terminal path; the selection fingerprint covers
   them so a changed request invalidates the pending attempt identifier.
   *Verify: frontend build, lint, unit.*

6. **`feat(frontend): rebuild the extraction request as a guided dialog`**
   The `Extract as bubble` surface — header naming the discussion, numbered steps, message list with
   role, position, preview, extracting-from marker and selected-of-total counter, `Select all`,
   frozen-context group below, instructions field with preset chips, three detail cards, and the
   summary footer with `Cancel` and `Generate bubble`. Keyboard operation, announced counts, and
   error association throughout. *Verify: frontend build, lint, unit.*

7. **`test(extraction): cover guided extraction end to end`**
   Extend analytics with detail level, instruction-supplied flag and length band, and select-all
   usage, with a payload test asserting no instruction text is emitted; backend e2e for an
   instructed detailed extraction and for the idempotency conflict on changed intent; a frontend
   keyboard journey from entry point through all three steps to an approved bubble.
   *Verify: build, lint, unit, e2e.*

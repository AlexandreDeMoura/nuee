# PRD 05 — Knowledge Extraction

## Problem

Useful project knowledge is often created inside AI discussions but remains buried in the conversation transcript. Saving the entire discussion would preserve too much noise, while automatically turning every exchange into durable knowledge would remove user control and create an unmanageable canvas.

Nuée needs a deliberate bridge between temporary reasoning and durable project memory. The user must be able to choose the relevant material from one focused discussion, ask the AI to synthesize it into one self-contained knowledge proposal, review and edit that proposal, and then decide whether it should become a new bubble, update an existing bubble, or be discarded.

The extraction flow must remain lightweight without becoming invisible. Nothing is saved until the user explicitly approves it. Rejected, abandoned, or unresolved proposals do not become project knowledge.

This PRD owns extraction entry points, source selection, extraction requests, proposal generation, proposal review, proposal editing, approval as a new bubble, update of an existing bubble, rejection, interruption behavior, and source provenance. The Focused Discussions PRD owns discussion messages and the discussion modal. The Discussion Context PRD owns frozen context and its inspection. The Bubble Canvas PRD owns bubble rendering, direct bubble editing, deletion, positioning, and general selection behavior.

## Target Users and Feature Impact

- **Primary user:** An individual using focused AI discussions to produce conclusions, explanations, decisions, or other reusable knowledge for a complex project.
- **User need:** Preserve one useful concept without saving an entire conversation, maintain control over what becomes durable project knowledge, and refine the synthesized result before it affects the canvas.
- **Feature impact:** Knowledge Extraction converts selected discussion material into a user-approved bubble. It reads persisted discussion messages and frozen context, calls an extraction model, creates a temporary proposal, and invokes Bubble Canvas operations only after explicit approval.

## Success criteria

1. An `Extract knowledge` action is available in the fixed header of every open discussion.
2. An `Extract knowledge` action is available below every completed AI response.
3. Triggering extraction below an AI response opens the source-selection flow with that AI response selected by default.
4. Triggering extraction from the discussion header opens the source-selection flow without silently selecting messages.
5. The user can select one AI message as the extraction source.
6. The user can select one user message as the extraction source.
7. The user can select several user and AI messages from the same discussion.
8. The user can select non-consecutive messages from the same discussion.
9. A selected message receives a visible extraction-selection state distinct from ordinary text selection.
10. The user can deselect a selected message before generating the proposal.
11. The user can select the complete discussion as the extraction source.
12. Selecting the complete discussion includes all persisted user and AI messages that exist when the extraction request is submitted.
13. The user can select one or more frozen context items attached to the current discussion as extraction sources.
14. Selecting frozen context uses the stored snapshot, not the current live bubble, document, or project-description content.
15. The extraction interface clearly distinguishes selected messages from selected frozen context.
16. Content from two different discussions cannot be included in one extraction request.
17. Live bubbles, live documents, and the current project description cannot be selected directly as extraction sources through this flow.
18. At least one eligible source must be selected before proposal generation can begin.
19. System instructions, hidden prompts, tool metadata, model diagnostics, and deleted messages are never exposed as selectable extraction sources.
20. The user can cancel source selection without creating a proposal or modifying project knowledge.
21. Submitting an extraction request captures an immutable source snapshot for that request.
22. Messages added to the discussion after submission do not change an extraction request already in progress.
23. If a selected message or context item becomes inaccessible before submission, extraction is blocked and the affected source is identified.
24. Each extraction request produces exactly one proposal.
25. The proposal contains an editable title, one-sentence summary, and full synthesized content.
26. The proposal is self-contained and understandable without opening the source discussion.
27. The proposal does not include unsupported information that is absent from the selected sources, except for minimal connective phrasing required for synthesis.
28. The proposal preserves material uncertainty, disagreement, and unresolved caveats present in the selected sources rather than rewriting them as established facts.
29. The proposal does not expose internal message identifiers, database identifiers, prompt instructions, or system metadata.
30. The proposal includes a source reference sufficient to identify the source discussion and selected source material later.
31. Proposal generation failure leaves the source selection intact so the user can retry or cancel.
32. Repeated submission or a network retry does not create multiple proposals for the same extraction attempt.
33. Once generated, the proposal opens in a review state before any bubble is created or updated.
34. The review state presents exactly three resolution paths: `Approve as new bubble`, `Update an existing bubble`, and `Reject`.
35. The user can edit the proposal title using a plain text field.
36. The user can edit the proposal summary using a plain text field.
37. The user can edit the proposal content using a plain text field.
38. Editing the proposal does not alter the source discussion, its messages, or its frozen context.
39. The title cannot be empty when approving a new bubble or updating an existing bubble.
40. The content cannot be empty when approving a new bubble or updating an existing bubble.
41. The summary may be empty only if the Bubble Canvas contract permits an empty summary; otherwise the user is prompted to provide one before approval.
42. Choosing `Approve as new bubble` creates one bubble containing the final reviewed title, summary, and content.
43. A newly approved bubble belongs to the same project as the source discussion.
44. A newly approved bubble stores `source_kind` as discussion extraction and stores the source discussion identifier.
45. A newly approved bubble stores references to all selected message identifiers used in the extraction where those messages remain valid provenance records.
46. When frozen context contributes to an extraction, the provenance record identifies the relevant frozen-context items without converting them into live-source references.
47. A newly approved bubble is automatically placed near the existing bubble cluster according to Bubble Canvas placement rules.
48. The extraction flow closes only after the new bubble and its provenance are persisted successfully.
49. If new-bubble persistence fails, no partial bubble appears on the canvas and the reviewed proposal remains available for retry.
50. Choosing `Update an existing bubble` requires the user to select exactly one bubble from the same project.
51. The target bubble can be selected from the canvas or another Bubble Canvas selection surface provided by the implementation.
52. A bubble from another project cannot be selected as the update target.
53. A deleted or inaccessible bubble cannot be used as the update target.
54. The target bubble remains unchanged until the user confirms the update.
55. Confirming an update atomically replaces the target bubble's title, summary, and content with the final reviewed proposal fields.
56. Updating an existing bubble changes its `updated_at` timestamp.
57. Updating an existing bubble does not change its canvas position or manual links.
58. Updating an existing bubble does not change frozen copies of that bubble already stored in existing discussions.
59. Updating an existing bubble records the current discussion and selected extraction sources as the latest update provenance where the data model supports one current source reference.
60. If update persistence fails, the target bubble remains unchanged and the reviewed proposal remains available for retry.
61. Repeated confirmation or a network retry does not create duplicate bubbles or apply the same update more than once.
62. Choosing `Reject` immediately closes the extraction flow without creating or updating a bubble.
63. A rejected proposal is not displayed in any project-facing history, inbox, canvas, or review queue.
64. Closing the extraction flow before approval, update, or rejection discards the proposal after any required unsaved-work confirmation.
65. An abandoned proposal is not restored when the discussion or project is reopened.
66. No draft extraction proposal is persisted for later user recovery in the MVP.
67. The user can perform another extraction from the same discussion after approving, updating, rejecting, or abandoning a prior extraction.
68. The user can select messages that were used in an earlier extraction again.
69. The product does not mark messages as already extracted.
70. The product does not warn about or prevent a potentially duplicate bubble during extraction.
71. Approving or rejecting a proposal does not change which discussion is marked Active.
72. Completing an extraction does not append an AI or user message to the source discussion.
73. Completing an extraction does not edit, delete, or reorder discussion messages.
74. Extraction remains available after a discussion is minimized and reopened, provided the discussion still exists.
75. Deleting the source discussion later does not delete bubbles previously created or updated through extraction.
76. When a source discussion has been deleted, an extracted bubble retains enough provenance metadata to indicate that its source discussion is no longer available.
77. Only users authorized to access the source project and discussion can initiate or resolve an extraction.
78. Extraction source payloads and generated proposal content are treated as project data and are not written to product analytics.
79. Analytics may record extraction entry point, source-kind counts, selected message count, frozen-context count, proposal-generation success or failure, resolution choice, latency, and retry count.
80. The end-to-end extraction flow is usable with keyboard navigation, has visible focus states, and exposes meaningful labels for source selection and resolution actions.

## Scope

### In scope

- **Extraction entry points:** Add `Extract knowledge` to the fixed discussion header and below each completed AI response. Hide or disable the action while no persisted source content is available.
- **Entry-point defaults:** When launched below an AI response, preselect that response while allowing the user to add or remove other eligible sources. When launched from the header, require explicit source selection.
- **Extraction source-selection mode:** Add a temporary selection state inside the current discussion for persisted user messages, persisted AI messages, the complete discussion, and the discussion's frozen-context items.
- **Message selection:** Support one message, several messages, mixed roles, and non-consecutive selection. Use message identifiers rather than copied client text as the authoritative source input.
- **Whole-discussion selection:** Resolve the whole-discussion option to the complete persisted message set at submission time and present its scope clearly to the user.
- **Frozen-context selection:** Allow the user to include stored project-description, bubble, or document snapshots attached to the current discussion. Read only `frozen_content` from Discussion Context records.
- **Source-boundary enforcement:** Validate that every selected item belongs to the same discussion and project and reject mixed-discussion or cross-project requests.
- **Eligibility filtering:** Exclude pending messages, failed assistant responses without usable content, deleted records, hidden system content, model metadata, tool traces, and other non-user-facing material.
- **Minimum-source validation:** Prevent submission until at least one eligible source is selected.
- **Transient selection state:** Keep source selection local to the current extraction flow. Cancelling or closing selection does not modify the discussion or create a persisted proposal.
- **Server-side source resolution:** Re-read authorized source records when the request is submitted rather than trusting source content sent by the client.
- **Extraction request snapshot:** Create a stable extraction payload containing source kind, source identifier, role where relevant, ordered content, discussion identifier, project identifier, and request timestamp.
- **Stable ordering:** Preserve discussion chronology for selected messages. Place explicitly selected frozen context in a distinguishable section after or before messages according to one deterministic serialization contract.
- **Extraction prompt:** Implement a dedicated model instruction that requests one reusable, self-contained knowledge unit with title, one-sentence summary, full content, preserved uncertainty, and no invented claims.
- **Structured model output:** Require and validate a typed response containing `title`, `summary`, and `content`. Treat malformed output as generation failure rather than partially creating a proposal.
- **One-proposal rule:** Generate one proposal for every request, including when several source messages are selected. Multi-bubble extraction is not part of the MVP.
- **Proposal quality constraints:** Prompt and validate for a specific title, concise summary, coherent standalone content, minimal repetition, and language understandable outside the source discussion.
- **Uncertainty preservation:** Instruct the model to retain caveats, alternatives, disagreements, and unresolved points from the source. The extraction model must synthesize rather than silently adjudicate.
- **Source-grounding safeguards:** Do not provide unrelated project content to the extraction model. The only project knowledge supplied for synthesis is the user-selected source snapshot plus system-level extraction instructions.
- **Proposal persistence strategy:** Treat the proposal as ephemeral user-session state by default. A short-lived server record may be used for reliability or idempotency, but it must not create a user-visible proposal history and must expire or be deleted after resolution or abandonment.
- **Extraction idempotency:** Assign a request identifier so retries do not produce parallel proposal records or multiple model calls where the original result can be safely recovered.
- **Generation lifecycle:** Expose generating, success, retryable failure, and non-retryable source-validation states. Preserve the current selection on generation failure.
- **Proposal review UI:** Display title, summary, and content in plain text inputs together with the three allowed resolution actions.
- **Review validation:** Enforce required bubble fields using Bubble Canvas rules before allowing approval or update confirmation.
- **Unsaved-work handling:** When the user closes a modified proposal, make the discard consequence clear. After confirmation, remove the ephemeral proposal and selection state.
- **New-bubble approval:** Invoke the Bubble Canvas bubble-creation contract with the final reviewed fields, current project identifier, placement intent, and extraction provenance.
- **New-bubble transaction:** Persist bubble data and provenance before reporting success. Avoid a canvas card backed by incomplete or missing data.
- **Automatic placement integration:** Request placement near the existing bubble cluster. Knowledge Extraction does not implement the placement algorithm itself.
- **Update-target selection:** Enter a constrained Bubble Canvas selection mode that permits exactly one accessible bubble from the current project and provides a cancel path back to proposal review.
- **Target preview:** Before confirmation, display the selected target bubble's title and enough identifying information to reduce accidental replacement.
- **Update semantics:** On confirmation, replace the target bubble's editable knowledge fields with the final reviewed title, summary, and content. Preserve position, links, identifier, creation timestamp, and unrelated bubble metadata.
- **Update transaction:** Apply field updates, `updated_at`, and update provenance atomically. On failure, leave the target unchanged.
- **Optimistic-concurrency protection:** Detect when the target bubble changed after target selection. Block silent overwrite and require the user to review the current target before retrying.
- **Provenance model:** For a newly created bubble, store `source_kind`, `source_discussion_id`, and selected `source_message_ids`. Add a representation for selected frozen-context item identifiers when they contributed.
- **Updated-bubble provenance:** Define how the latest extraction source is represented when updating an existing bubble. Preserve enough information to identify the update's discussion and selected sources without requiring full bubble version history.
- **Source display contract:** Expose a human-readable source indicator on extracted bubbles through Bubble Canvas or Inspector surfaces, including a graceful state when the source discussion has been deleted.
- **Resolution state machine:** Support `selecting`, `generating`, `reviewing`, `selecting_update_target`, `saving_new`, `saving_update`, `resolved`, and `discarded` states with explicit valid transitions.
- **Reject behavior:** Remove the ephemeral proposal and close the flow without touching bubbles, discussion state, or source records.
- **Interrupted-flow behavior:** Discard selection and proposal state when the extraction UI is closed, the project is left, or the session is irrecoverably interrupted. Do not restore it on later visits.
- **Repeated extraction:** Allow any source content to be selected repeatedly. Do not add extraction markers, locks, processed flags, or duplicate checks.
- **Discussion lifecycle integration:** Keep extracted bubbles independent of the source discussion's later deletion. Bubble provenance should degrade gracefully rather than cascade-delete.
- **Active-discussion integration:** Do not update the discussion's `updated_at` or Active status merely because extraction was opened, generated, approved, updated, rejected, or cancelled.
- **Model and size handling:** Estimate the selected source payload before generation. If it exceeds the extraction model's supported input, block the request with an actionable message rather than silently omitting sources.
- **Security:** Validate project ownership and discussion access for every source-resolution, generation, bubble-creation, and bubble-update action. Never accept arbitrary source text or target identifiers without authorization.
- **Content safety and rendering:** Render proposal fields as escaped plain text inputs. Do not execute HTML or embedded scripts returned by the model.
- **Accessibility:** Support keyboard source selection, clear focus order, screen-reader labels, selected-state announcements, error association, and keyboard-accessible resolution actions.
- **Analytics:** Instrument behavior using identifiers, source counts, source kinds, size bands, latency, result status, and resolution choice. Exclude raw message, context, proposal, and bubble text.

### Out of scope

- Automatic extraction after every message or discussion
- Creating durable knowledge without explicit user approval
- Generating more than one bubble proposal from one extraction request
- Suggesting that the user extract knowledge
- Detecting the ideal moment to extract knowledge
- Automatically choosing source messages
- Selecting content from several discussions in one extraction
- Selecting live bubbles, live documents, or the current project description directly
- Extracting bubbles directly from uploaded documents
- Extracting knowledge from external web pages, integrations, or clipboard content
- Selecting arbitrary text spans inside a message
- Selecting individual passages inside a frozen document snapshot
- Editing source discussion messages before extraction
- Editing or regenerating AI responses
- Saving extraction selections as reusable source sets
- Saving unresolved proposals as drafts
- A proposal inbox, history, trash, or recovery interface
- Restoring an abandoned or rejected proposal
- Tracking which messages have already been extracted
- Preventing repeated extraction from the same source
- Duplicate-bubble detection or warnings
- Similarity search before approval
- Automatic linking between the approved bubble and existing bubbles
- Automatic merging of the proposal with several existing bubbles
- Updating more than one existing bubble from one proposal
- AI-controlled selection of the update target
- Bubble version history, diffs, rollback, or conflict merging
- Preserving multiple historical extraction provenance entries as a user-facing timeline
- Bubble types, confidence levels, statuses, tags, or automatically inferred metadata
- Rich-text or Markdown editing in proposal fields
- Attachments, citations, or embedded media inside the generated bubble
- Permanent visible lines from a bubble to its source discussion
- Changing canvas layout beyond requesting standard new-bubble placement
- Manual bubble creation and ordinary direct bubble editing outside extraction
- Discussion creation, messaging, minimization, Active-state calculation, or deletion
- Editing frozen discussion context
- Legacy-context detection or comparison against current bubble versions
- Knowledge audits, contradiction detection, validation workflows, or experiment tracking
- Team review, approval workflows, comments, or permissions beyond project ownership
- Background extraction jobs that notify the user later
- Model comparison, user-selectable extraction prompts, or custom extraction templates

## Risks / Open Questions

- **One proposal versus source complexity:** One proposal keeps extraction lightweight and matches the intended narrow-discussion model, but selected messages may contain several unrelated conclusions. The current leaning is to preserve the one-proposal rule and let the user run extraction several times rather than add automatic splitting.
- **Source selection defaults:** Preselecting the AI response below which extraction was launched reduces friction, but the useful knowledge may depend on the preceding user question. The current leaning is to preselect only the clicked AI response and make nearby message selection obvious, avoiding silent source expansion.
- **Whole-discussion meaning:** A discussion may receive new messages while extraction is open. The current leaning is that `whole discussion` means every persisted user and AI message present when the request is submitted, then becomes an immutable request snapshot.
- **Frozen context as a source:** Allowing extraction from context helps users synthesize existing knowledge with a new discussion, but may create bubbles that mostly duplicate previous bubbles or documents. The MVP accepts this risk because duplicate detection is explicitly excluded and the user remains responsible for approval.
- **Selected frozen document size:** A complete frozen document may exceed the extraction model's limit. Silent truncation would make the proposal's provenance misleading. The current leaning is to reject oversized requests and require fewer sources; passage-level selection remains post-MVP.
- **Proposal summary requirement:** The source PRD allows a manually created bubble to omit a summary or derive one from content. Extracted proposals always generate a summary, but the user could erase it. Bubble Canvas should define whether empty summaries are valid; Knowledge Extraction should enforce that shared rule rather than invent a conflicting requirement.
- **Synthesis versus quotation:** A bubble should contain synthesized project knowledge, not copied transcript fragments, but aggressive rewriting can remove nuance. The current leaning is a self-contained synthesis that retains essential terminology, disagreement, and uncertainty without requiring verbatim conversation.
- **Model hallucination:** Even with selected-only context, the model may add plausible but unsupported conclusions. The prompt should forbid new claims, but this cannot be guaranteed mechanically. User review is therefore a required safety and product-control step, not optional polish.
- **Proposal quality validation:** Structural validation can confirm non-empty fields but cannot reliably determine whether a bubble is too vague or combines several concepts. The current leaning is prompt-based quality control plus user editing, with no second AI review in the MVP.
- **Update semantics:** “Update an existing bubble” could mean merge, append, rewrite, or replace. Hidden AI merging would make the final state difficult to predict. The current leaning is explicit full replacement of title, summary, and content with the reviewed proposal, while preserving position and links.
- **Concurrent target edits:** Another tab may change the target bubble between selection and confirmation. Silent overwrite could destroy work. The current leaning is optimistic concurrency using the target's version or `updated_at`, followed by a required review if it changed.
- **Provenance after updates:** The minimal Bubble data model has one source discussion and message list, but a bubble may be refined repeatedly. Replacing provenance loses its original origin; accumulating provenance begins to resemble version history. The current leaning is to record the latest extraction source for the visible current content and defer a complete revision timeline.
- **Frozen-context provenance:** A selected frozen bubble may itself have originated from another discussion. Following provenance recursively would add complexity and may expose deleted sources. The MVP should record the directly selected frozen-context item only, not expand its ancestry.
- **Deleted source discussions:** Extracted bubbles survive deletion, but the source link becomes unavailable. The current leaning is to retain frozen source metadata such as discussion title and selected source kinds and display `Source discussion deleted` rather than retain the full transcript solely for provenance.
- **Ephemeral proposal storage:** Keeping proposals only in client state simplifies the product promise but makes network recovery fragile. Temporary server persistence improves reliability but creates hidden retained content. The current leaning is short-lived server storage with automatic deletion after resolution, abandonment, or expiration and no user-facing history.
- **Close versus reject:** Both actions discard the proposal, but `Reject` is an explicit judgment while closing may be accidental. The interface should distinguish them and warn only when closing would lose a generated or edited proposal.
- **Retry behavior:** Regenerating after a failure may produce a different proposal. Recovering a completed response by idempotency key improves consistency, while retrying a failed model call may legitimately vary. The implementation should distinguish transport retry from an explicit user-requested new generation; only transport retry is in MVP.
- **Discussion Active timestamp:** Extraction is meaningful project activity, but marking its source discussion Active would conflict with the established rule that the most recently updated conversation is Active. The current leaning is that extraction does not update discussion activity because it does not add or edit conversation content.
- **Bubble placement race:** Two extraction approvals in different tabs could request the same placement area. Bubble Canvas must resolve collision safely; Knowledge Extraction should not implement separate layout behavior.
- **Sensitive data:** Extraction duplicates selected conversation and document content into a new durable bubble. The user controls approval, but the proposal itself may temporarily exist on the server and be sent to a model provider. Storage lifetime, encryption, access control, and provider data handling must be reviewed.
- **Analytics privacy:** Titles, summaries, message content, and proposal text may expose confidential project information. Analytics should contain counts, categories, identifiers, timings, and outcomes only.
- **Accessibility of message selection:** Non-consecutive selection inside a scrollable modal can be difficult without a mouse. The implementation needs keyboard toggles, clear selected-state announcements, and a persistent count or review list.

## Implementation Commit Plan

The recommended implementation is 13 incremental commits. It keeps Knowledge Extraction as its
own feature, reuses the existing discussion and canvas boundaries, and covers all 80 success
criteria without introducing new dependencies.

### Current-state findings

- Both extraction entry points exist but are inert:
  `frontend/src/discussions/DiscussionExperience.tsx`,
  `frontend/src/discussions/DiscussionMessages.tsx`, and
  `frontend/src/discussions/DiscussionKnowledgeAction.tsx`.
- Bubbles already store `source_kind`, `source_discussion_id`, and
  `source_message_ids` in `shared/src/index.ts` and migration 002.
- Frozen discussion context is already immutable, versioned, server-persisted, and
  runtime-validated.
- Cluster placement already exists in `BubblePlacementService`.
- Discussion messages are ordered, project-scoped, and eligible assistant messages are always
  completed records.
- The frontend already has controlled canvas multi-selection and established focus/modal
  patterns.
- The main frontend obstacle is split bubble ownership between `CanvasSurface` and
  `ProjectWorkspace`, already recorded as a weakness in `ARCHITECTURE_ANALYSIS.md`.

### Proposed API and persistence shape

Add nested extraction commands:

```text
POST   /projects/:projectId/discussions/:discussionId/knowledge-extractions
POST   /projects/:projectId/discussions/:discussionId/knowledge-extractions/:extractionId/resolution
DELETE /projects/:projectId/discussions/:discussionId/knowledge-extractions/:extractionId
```

Creation input should contain identifiers, never copied source text:

```ts
{
  idempotency_key: string;
  message_selection:
    | { kind: 'selected'; message_ids: string[] }
    | { kind: 'whole_discussion' };
  frozen_context_item_ids: string[];
}
```

The resolution command should be a discriminated union:

```ts
{ kind: 'new_bubble', proposal: ReviewedProposal }
{ kind: 'update_bubble', proposal: ReviewedProposal, target_bubble_id, expected_updated_at }
{ kind: 'reject' }
```

Create a hidden `knowledge_extraction_attempts` table containing:

- Project, discussion, attempt, and idempotency identity.
- Request fingerprint.
- Canonical immutable source-snapshot JSON.
- One nullable proposal JSON value.
- `generating`, `ready`, `failed`, `resolved`, or `discarded` status.
- Resolution fingerprint, kind, and resulting bubble identifier.
- Retry count and timestamps.
- `expires_at`.

There should be no list or history endpoint. Retain attempts briefly—24 hours is a reasonable
default—to recover network retries, purge expired attempts on startup and opportunistically
during extraction requests, and never restore them in the UI.

### Commit 1 — `refactor(frontend): centralize project bubble collection ownership`

Move bubble loading and canonical bubble state to a workspace-level hook. Make the canvas,
Inspector, update-target selection, and extraction results consume that one collection.

Remove the `updatedBubbles` / `deletedBubbleIds` echo protocol where practical. Preserve existing
canvas behavior and public test injection seams.

Tests:

- Existing canvas, Inspector, drag, link, delete, and compact-layout journeys remain unchanged.
- Stale and aborted load behavior remains covered.
- Update `ARCHITECTURE_ANALYSIS.md`.

This is a behavior-neutral prerequisite for safely inserting or replacing a persisted extraction
result.

### Commit 2 — `feat(bubbles): persist complete discussion extraction provenance`

Extend shared and persisted bubble provenance with:

- `source_context_item_ids`
- Frozen `source_discussion_title`
- `source_discussion_deleted_at` or an equivalent availability marker
- Internal `latest_extraction_id` for defensive resolution idempotency

Keep `source_kind: 'discussion'` for compatibility; treat it as “discussion extraction.”

Add migration 007 with JSON validity and provenance-consistency constraints. Manual bubble
creation must continue initializing empty or null provenance.

Add a narrow bubble integration port for extraction-driven create and update operations rather
than exposing repository SQL to the extraction feature.

Tests:

- Migration upgrade from the existing schema.
- JSON corruption and invalid provenance rejection.
- Existing manual create and update behavior.
- Shared response fixtures and runtime guards.

This commit provides the storage foundation for criteria 30, 44–46, 59, and 76.

### Commit 3 — `feat(extraction): persist authoritative discussion source snapshots`

Create `backend/src/knowledge-extraction/` with its controller-independent domain types,
repository port, SQLite implementation, and migration 008.

Expose a narrow `DiscussionExtractionSourceReader` from Discussions. It should:

- Resolve sources through project and discussion identifiers.
- Return only completed user and assistant messages.
- Resolve whole-discussion messages at submission time.
- Resolve frozen context from stored `discussion_context_items`.
- Preserve message chronology and context display order.
- Return affected identifiers for missing, cross-discussion, or inaccessible selections.
- Never expose pending, failed, hidden, diagnostic, or non-user-facing records.

The extraction service should validate unknown fields, duplicates, selection limits, source
ownership, and the minimum-source rule before persisting the snapshot.

Tests:

- Single, mixed-role, non-consecutive, and whole-discussion selection.
- Frozen snapshots remain independent from later live-source changes.
- Cross-project and cross-discussion rejection.
- Missing-source error details.
- Messages appended after submission do not alter the snapshot.
- No write to discussion activity or messages.

This commit covers criteria 5–23 and the source portion of criterion 30.

### Commit 4 — `feat(extraction): generate one grounded structured proposal`

Add a generic structured-output capability to the provider-neutral AI port. Keep the extraction
prompt, serialization contract, and proposal validation inside Knowledge Extraction rather than
`DiscussionsService`.

The model request should contain only:

1. Extraction system instructions.
2. Canonically ordered selected messages.
3. A clearly separated frozen-context section.

Require strict structured output:

```ts
{
  title: string;
  summary: string;
  content: string;
}
```

Validate non-empty normalized fields and configured maximum lengths. Malformed output becomes a
generation failure; it must never partially create a proposal.

Extend the existing model-input budget mechanism to extraction requests and return an actionable
`413` when oversized.

Implement:

- Durable request fingerprint and idempotency-conflict detection.
- One in-flight generation promise per attempt in the current process.
- Recovery of a completed proposal on transport retry.
- Retry of a failed model call against the original stored snapshot.
- Exactly one proposal field per attempt.

Tests:

- OpenAI request schema and instructions.
- Deterministic fake proposal.
- Malformed and empty output.
- Provider failure and retry.
- Oversized request rejection.
- Concurrent and repeated submissions.
- Reusing a key with a different selection returns `409`.
- Proposal fields contain no internal identifiers or prompt metadata.

This commit covers criteria 21–32.

### Commit 5 — `feat(extraction): resolve proposals as new bubbles or reject them`

Add resolution transactions using a small shared SQLite transaction boundary.

For `new_bubble`, one transaction should:

1. Claim the unresolved extraction attempt.
2. Validate the reviewed title and content and normalize an empty summary to `null`.
3. Compute standard cluster placement.
4. Insert the bubble with all provenance.
5. Mark the attempt resolved and retain its replay result.

Do not publish an optimistic canvas bubble. A failed transaction must leave both the canvas and
database without a partial bubble, while the attempt remains reviewable.

For `reject`, record a hidden rejected resolution or tombstone and return success without touching
bubbles or discussions.

Add the discard endpoint for abandoned review state. It should mark the hidden attempt discarded;
expiry remains the fallback for interrupted sessions.

Tests:

- Bubble and provenance are atomic.
- Project and source discussion match.
- Cluster placement is used.
- Persistence failure rolls back.
- The same resolution replay returns the same bubble.
- A conflicting second resolution returns `409`.
- Reject and discard create no bubble or discussion activity.

This commit covers the backend portions of criteria 39–49, 61–66, and 71–73.

### Commit 6 — `feat(extraction): update bubbles with optimistic concurrency`

Implement the update resolution through the bubble integration port.

Require exactly one target bubble from the source project and the `updated_at` observed during
target selection. In one transaction:

- Revalidate target availability and project membership.
- Compare `expected_updated_at`.
- Replace title, summary, content, `updated_at`, and latest extraction provenance.
- Preserve identifier, creation timestamp, position, links, and unrelated metadata.
- Mark the extraction attempt resolved.

Return a stable conflict containing a safe current-target preview when the bubble changed. The
client must require another explicit confirmation after refreshing that preview.

Tests:

- Cross-project, missing, and deleted target rejection.
- Position and manual links remain unchanged.
- Existing frozen discussion copies remain unchanged.
- Monotonic `updated_at`.
- Failed writes roll back content and provenance.
- Repeated confirmation does not reapply the update.
- A concurrent target edit produces a conflict.

This commit covers criteria 50–61.

### Commit 7 — `feat(bubbles): retain provenance after source discussion deletion`

Integrate discussion soft deletion with the narrow bubble provenance port.

When a discussion is deleted:

- Do not delete or unlink extracted bubbles.
- Mark matching current provenance as unavailable.
- Retain the frozen discussion title, message identifiers, context-item identifiers, and source
  kinds.
- Do not change bubble knowledge fields or positions.

Make deletion and provenance-availability marking transactional if both are performed in the same
command.

Tests:

- New and updated bubbles survive source deletion.
- Inspector-facing data reports `Source discussion deleted`.
- No discussion transcript is retained solely for provenance.
- Project deletion can still cascade all project-owned data.

This commit covers criteria 75–76.

### Commit 8 — `feat(frontend): add extraction API guards and lifecycle state machine`

Create `frontend/src/api/knowledgeExtractions.ts` and
`frontend/src/knowledge-extraction/`.

Implement a reducer or hook with the PRD states:

```text
selecting
generating
reviewing
selecting_update_target
saving_new
saving_update
resolved
discarded
```

Also model retryable generation failure and non-retryable source validation explicitly.

The hook should own:

- Current project and discussion binding.
- Local selected identifiers and whole-discussion mode.
- Stable attempt identifier and selection fingerprint.
- Abort and stale-response protection.
- Reviewed proposal edits.
- Selected target and version.
- Retry counts.
- Reset after every terminal path.
- Best-effort discard on project departure or unmount.

Tests should exhaust valid and invalid transitions, aborts, stale responses, retry-key reuse, and
reset behavior.

This commit supports criteria 20, 31–38, and 64–74.

### Commit 9 — `feat(frontend): implement extraction source selection`

Wire the existing entry points into the new feature owner.

In the discussion surface:

- Header entry starts empty.
- Assistant-response entry preselects only the clicked response.
- User and assistant messages become independently toggleable.
- Selected messages receive a dedicated visual state and `aria-pressed` or checkbox semantics.
- Whole-discussion selection is clearly described as submission-time scope.
- Frozen context is presented in a distinct source group.
- Only stored context items from the current discussion are offered.
- Generate remains disabled until at least one non-empty eligible source exists.
- Cancel clears local selection without a request.
- Source-validation errors identify and focus affected selections.
- Generation failure keeps the selection and provides Retry and Cancel.

The header action should be hidden or disabled when there is no completed message or non-empty
frozen item. Do not expose optimistic or pending messages as selectable.

Tests:

- Criteria 1–20 as component journeys.
- Mixed-role and non-consecutive selection.
- Default-selection behavior.
- Deselect and cancel.
- Whole-discussion semantics.
- Frozen versus live-source distinction.
- Keyboard toggling and focus restoration.
- Minimize and reopen availability.

### Commit 10 — `feat(frontend): review edit and discard extraction proposals`

Add a plain-text review interface with:

- Title input.
- One-sentence summary input.
- Multiline content input.
- Exactly three initial resolution actions.
- Inline title and content validation.
- Empty summary allowed and sent as `null`, matching the current Bubble contract.
- Escaped text rendering only.
- Generating, failure, and retry announcements.

Closing a generated or edited proposal should show an unsaved-work confirmation. Explicit Reject
closes immediately after issuing the reject resolution; interrupted or failed discard calls remain
protected by hidden expiry and the absence of restoration APIs.

Tests:

- Edits never alter discussion details or frozen context.
- Required-field errors are associated with their controls.
- Reject and confirmed close create no bubble.
- Reopening the project does not restore a proposal.
- Focus trap, Escape behavior, and focus return.
- Exactly three initial resolution buttons.

This commit covers criteria 24–41 and 62–66.

### Commit 11 — `feat(frontend): approve extraction proposals as new bubbles`

Connect `Approve as new bubble` to the transactional resolution endpoint.

While saving:

- Keep the review available.
- Disable duplicate confirmation.
- Show a retryable error on failure.
- Close only after a runtime-validated persisted Bubble response arrives.
- Add the returned bubble to the canonical workspace collection.
- Select or reveal it only after persistence, if desired by existing canvas behavior.

Update the Inspector source presentation to show the frozen discussion title, message and context
counts, and deleted-source state without displaying database identifiers.

Tests:

- No card during an unresolved request.
- Failure preserves the proposal.
- Retry uses the same extraction and resolution identity.
- One returned card at the server position.
- Correct source indicator.
- Discussion Active state and list ordering remain unchanged.

This commit covers criteria 42–49, 61, 67–73, and part of 76.

### Commit 12 — `feat(frontend): select and update an extraction target`

Add a controlled canvas single-selection mode, either as a specialized contract or a
`maximumSelectionCount: 1` extension of the existing selection contract.

Flow:

1. `Update an existing bubble` leaves proposal review temporarily.
2. Canvas permits one bubble from the current project.
3. Cancel returns to unchanged proposal review.
4. The selected target returns to review with title and identifying preview.
5. A separate confirmation submits the update with the observed `updated_at`.
6. A conflict refreshes the preview and requires explicit reconfirmation.
7. Success replaces the canonical workspace bubble and closes the flow.

Unavailable or deleted bubbles must disappear from or become invalid in the selection surface.

Tests:

- Exactly one target.
- Same-project enforcement.
- Cancel and preview behavior.
- Target unchanged before confirmation.
- Failed update preserves proposal and target.
- Conflict, review, and reconfirmation.
- Position, links, and Inspector selection remain stable after success.

This commit covers criteria 50–61 and 80.

### Commit 13 — `test(extraction): cover privacy accessibility and complete journeys`

Add typed, privacy-safe analytics alongside the implemented flow:

- Entry point.
- Message-selection mode and counts.
- Frozen-context kind counts.
- Payload size band.
- Generation latency, status, and retry count.
- Resolution choice and latency.

Never include message text, context text, proposal fields, or bubble fields. Add tests that inspect
every emitted payload for forbidden content.

Complete automated coverage with:

- Backend e2e: selected sources → proposal → new bubble.
- Backend e2e: whole-discussion snapshot with a later message.
- Backend e2e: frozen context and update resolution.
- Failure, retry, and idempotency journeys.
- Discussion deletion and degraded provenance.
- Frontend keyboard journey through selection, review, new bubble, update, reject, and close.
- Assertions that discussion activity and messages never change.

Update both architecture analyses and keep `AGENTS.md` and `CLAUDE.md` synchronized if their
architectural boundary text changes.

This commit covers criteria 77–80 and closes cross-cutting coverage for all earlier criteria.

### Success-criteria coverage audit

| Criteria | Primary commits |
| --- | --- |
| 1–4 entry points and defaults | 9 |
| 5–10 message selection | 3, 9 |
| 11–12 whole discussion | 3, 9 |
| 13–15 frozen context | 3, 9 |
| 16–23 boundaries and snapshot | 3, 4, 9 |
| 24–32 proposal generation and idempotency | 4, 8, 10 |
| 33–41 review, editing, and validation | 8, 10 |
| 42–49 new bubble | 2, 5, 11 |
| 50–61 existing-bubble update | 2, 6, 12 |
| 62–66 reject and abandonment | 5, 8, 10 |
| 67–70 repeated extraction and no duplicate warnings | 8–12 |
| 71–74 discussion isolation and lifecycle | 3, 5, 9–13 |
| 75–76 deleted-source provenance | 2, 7, 11 |
| 77 access control | 3, 5, 6, with the caveat below |
| 78–79 analytics privacy | 13 |
| 80 accessibility | 9, 10, 12, 13 |

### Acceptance caveats

1. Criteria 26–28 are model-quality requirements, not mechanically provable invariants. The
   implementation can enforce selected-only input, grounding instructions, structured output,
   uncertainty instructions, and mandatory review. Acceptance should also include a small
   evaluation set containing uncertainty, disagreement, and tempting unsupported conclusions.
2. Criterion 77 cannot literally provide per-user authorization because the repository has no
   identity, owner, membership, or authentication model. Under the documented trusted single-user
   deployment, project and discussion scoping is the available authorization boundary. If this
   PRD targets multi-user or untrusted exposure, authentication and project ownership must be a
   prerequisite epic rather than being hidden inside Knowledge Extraction.

### Verification cadence

After each affected-side commit, run the relevant build, lint, and unit tests. At backend API or
schema milestones and before completion, use:

```bash
npm run build
npm run lint
npm test
npm run test:e2e
```

No package installation should be necessary. Keep manual UI QA separate from the automated and
static verification above.

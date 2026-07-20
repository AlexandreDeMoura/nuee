# PRD 03 — Focused Discussions

## Problem

AI conversations are useful for exploring a question, but conventional chat interfaces encourage users to keep extending one vertical thread until the reasoning becomes difficult to scan, revisit, and separate from unrelated topics.

Nuée needs discussions that feel temporary and focused while still preserving the complete reasoning history. A discussion should open above the project canvas, answer one narrow line of inquiry, remain easy to minimize and reopen, and never become the project's primary durable knowledge structure. Durable conclusions are created separately through user-approved knowledge extraction.

This PRD owns the discussion modal, message lifecycle, AI response generation, AI-generated discussion titles, discussion-list behavior, Active discussion semantics, minimization, reopening, deletion, and persistence of conversation history. Selecting project context and creating frozen context snapshots are owned by the Discussion Context PRD. Extracting durable knowledge from messages is owned by the Knowledge Extraction PRD.

## Target Users and Feature Impact

- **Primary user:** An individual using AI repeatedly to examine focused questions inside a larger, complex project.
- **User need:** Ask a precise question, receive a useful answer without creating an unmanageable thread, preserve the reasoning for later reference, and move between separate lines of inquiry without leaving the project canvas.
- **Feature impact:** Discussions are the reasoning layer that produces candidate knowledge for bubbles. Discussion Context provides their immutable starting context, Knowledge Extraction consumes their messages, and the Project Workspace right panel provides persistent access to the discussion list.

## Success criteria

1. A user can start a new discussion from the project workspace without selecting any bubble or document context.
2. When a new discussion is started without an initial prompt, a centered discussion modal opens above the current canvas and provides a usable prompt input.
3. When the user starts through the write-first flow, the first prompt is submitted only after the Discussion Context feature confirms the discussion's frozen context.
4. The canvas remains visible but visually de-emphasized behind an open discussion modal, and the user cannot accidentally manipulate blurred canvas content through the modal overlay.
5. Only one discussion modal is visible at a time within a project.
6. Opening a second discussion hides or minimizes the currently visible discussion without deleting it or changing its messages.
7. A user can minimize or close the visible discussion modal and continue viewing the canvas while the discussion remains available in the Discussions panel.
8. Starting, minimizing, closing, or reopening a discussion does not modify any bubble, document, bubble link, or frozen context record.
9. A user can submit a non-empty text message and see that message added once to the current discussion.
10. Whitespace-only messages cannot be submitted.
11. While an AI response request is in progress, the interface prevents accidental duplicate submission of the same prompt and visibly communicates that the response is pending.
12. After a successful request, exactly one AI message is appended after the corresponding user message and both messages remain visible in chronological order.
13. If AI generation fails, the failed request is visibly distinguishable from a completed AI response and the user's submitted message remains preserved.
14. Retrying a failed AI generation does not create a duplicate user message and produces at most one successful AI message for that request attempt.
15. AI responses answer the current question directly and are configured to be readable in approximately one minute by default.
16. The response system may produce longer analysis, tables, numbered steps, or citations when the user's request requires them; the interface does not truncate valid longer responses to enforce the default length target.
17. The AI may structure a response using Answer, Caveat, Implications, or Open question when useful, but the UI does not require empty sections or force every response into a fixed card schema.
18. The response request includes the discussion's complete prior message history and the frozen context supplied by the Discussion Context feature, without silently substituting current bubble, document, or project-description content.
19. After the first completed user–AI exchange, the system generates and persists a concise discussion title.
20. The generated title is displayed in the discussion header and in the Discussions panel after generation completes.
21. If title generation fails, the discussion remains usable and receives a deterministic temporary title until title generation succeeds or the discussion is deleted.
22. The user cannot rename an AI-generated discussion title in the MVP.
23. User and AI messages cannot be edited after persistence.
24. An AI response cannot be regenerated merely to produce an alternative answer; only a failed response request may be retried.
25. Every non-deleted discussion appears in the Discussions panel for its project and discussions from another project never appear in that list.
26. The Discussions panel orders discussions by most recent discussion activity, with the most recently active discussion first.
27. Exactly one discussion is marked Active when the project contains at least one discussion, and the Active discussion is the one with the latest qualifying activity timestamp.
28. Creating a discussion, submitting or receiving a message, or explicitly opening an existing discussion moves that discussion to Active.
29. Minimizing the current discussion and completing a knowledge-extraction flow do not by themselves move Active status to another discussion.
30. Reopening a discussion restores its complete persisted message history, title, frozen context badges supplied by the Discussion Context feature, and any still-relevant modal presentation state that can be restored without persisting draft text.
31. Entering or reopening the project itself lands on the canvas without automatically displaying the previously Active discussion modal.
32. A page reload during a completed discussion preserves all successfully persisted messages and does not display an unpersisted AI response as completed.
33. A user can request deletion of a discussion from the discussion interface or Discussions panel and must confirm before deletion is applied.
34. After confirmed deletion, the discussion no longer appears in the Discussions panel or opens through its former project route.
35. Deleting a discussion removes or makes inaccessible its messages and frozen discussion context according to the application's deletion policy, but does not delete bubbles previously created or updated from that discussion.
36. If the deleted discussion was Active, the remaining discussion with the latest qualifying activity becomes Active; if none remain, no discussion is marked Active.
37. The MVP provides no discussion archive state: a discussion is either available or deleted.
38. The interface does not automatically detect topic drift, block broad prompts, split a discussion, or suggest creating another discussion.
39. The discussion service rejects cross-project access: a discussion cannot be opened, messaged, listed, or deleted through a project other than its own.
40. Analytics record discussion creation, first prompt submission, AI response completion or failure, title generation, open, minimize, deletion, and Active-state changes using project and discussion identifiers without logging full message content.

## Scope

### In scope

- **Discussion modal:** Build the centered modal or overlay rendered above the project canvas. It contains the discussion title, chronological messages, prompt composer, context-badge integration area, Extract knowledge integration points, and minimize or close controls.
- **Canvas-overlay behavior:** Visually blur or otherwise de-emphasize the canvas while a discussion is open, establish correct focus trapping and keyboard behavior, and prevent pointer interactions from leaking through to canvas controls.
- **Single-visible-discussion controller:** Maintain at most one visible discussion modal in a project. Opening or creating another discussion replaces the visible modal while preserving the previous discussion in persistent storage and the Discussions panel.
- **Discussion creation contract:** Accept a project identifier, frozen-context package, and optional first prompt from the Discussion Context feature. Create the discussion record before or atomically with the first message so failures cannot leave messages unattached to a discussion.
- **No-additional-context flow:** Allow creation when the frozen-context package contains only the project-description snapshot supplied by Discussion Context and no selected bubble or document snapshots.
- **Discussion persistence model:** Implement at minimum `id`, `project_id`, `title`, `created_at`, `updated_at` or equivalent activity timestamps, and deletion metadata where soft deletion is used. The stored title may begin as a deterministic placeholder and later be replaced by the generated title.
- **Discussion-message persistence model:** Implement at minimum `id`, `discussion_id`, `role`, `content`, `created_at`, and any generation-state or request-correlation fields needed to prevent duplicate messages and recover from failed model calls.
- **Immutable message contract:** Treat persisted user and AI message content as immutable. Corrections or refinements are new messages rather than edits to previous messages.
- **Chronological message rendering:** Load and render the full available history in stable chronological order, including appropriate loading, empty, pending-response, failed-response, and retry states.
- **Prompt composer:** Provide plain-text message composition and submission, whitespace validation, accessible keyboard submission, multiline input, pending-state behavior, and preservation of typed text when submission fails before the user message is accepted.
- **AI orchestration:** Send the frozen discussion context and complete prior message history to the selected model through the application's AI abstraction, append the new user prompt, and persist the resulting AI message only when a valid response is received.
- **Focused-response instruction:** Apply system guidance that prioritizes direct, narrow, approximately one-minute answers. Permit detail proportional to the request and avoid imposing an artificial hard character or token limit that would damage correctness.
- **Response formatting:** Support plain text and the product's approved rich-text subset, including paragraphs, headings, lists, tables, code blocks, and citations where the AI stack provides them. Rendering must sanitize unsupported or unsafe markup.
- **Response request identity:** Use an idempotency key, message-request record, or equivalent mechanism so retries, client reconnection, and repeated button events cannot append duplicate user or AI messages for one logical submission.
- **Generation failure and retry:** Preserve the user message, show that its response failed, and allow retry of that failed generation. Retrying is recovery of the same unanswered turn, not general answer regeneration.
- **Title-generation service:** After the first completed exchange, request a concise title from the model or a dedicated title generator, persist it, and update both the modal header and discussion list. Title generation must not block display of the first answer.
- **Temporary title:** Provide a deterministic placeholder based on a neutral label, creation time, or truncated first prompt when the generated title is not yet available. The temporary title must not be confused with user-editable content.
- **Discussion list integration:** Supply project-scoped discussion records to the Discussions panel owned by Project Workspace, including title, relevant activity timestamp, Active state, and enough status to open or delete the discussion.
- **Discussion ordering:** Order the panel by a single documented activity field. Qualifying activity includes creation, explicit open, and new message activity. Merely reading while already open, scrolling, minimizing, or running extraction must not repeatedly rewrite ordering.
- **Active-state calculation:** Mark the discussion with the latest qualifying activity as Active rather than maintaining several independent active flags. Provide deterministic tie-breaking, such as creation identifier or timestamp precision, if timestamps are equal.
- **Open-activity update:** Record an explicit open action only when the user opens a different discussion from the panel or another entry point. Initial project loading must not implicitly reopen or reactivate a discussion.
- **Minimize and close behavior:** Hide the modal while retaining all persisted history and Active status. The MVP may implement Close and Minimize as the same persisted outcome if the visual language is consistent and no separate minimized-window tray exists.
- **Reopening:** Reload the discussion record, messages, and frozen-context metadata and render them in the modal. Restore safe presentation state such as message scroll position only where practical; do not promise recovery of unsent draft text unless a separate draft mechanism is implemented.
- **Knowledge Extraction integration:** Render Extract knowledge entry points in the fixed discussion header and below each AI response. Pass the current discussion and source-message identifiers to the Knowledge Extraction feature without implementing synthesis or proposal review here.
- **Context integration:** Render context badges and inspector actions supplied by the Discussion Context feature. The discussion renderer treats them as immutable references to frozen snapshots and never resolves their displayed or model-provided content from current live sources.
- **Deletion flow:** Provide a confirmation step and project-scoped delete command. On success, close the modal if needed, remove the item from the discussion list, clear invalid UI state, and recalculate Active status.
- **Deletion data handling:** Cascade or otherwise make inaccessible the deleted discussion's messages and frozen context while preserving independent bubble records. The exact retention implementation must comply with the application's wider data-retention policy.
- **Discussion loading and recovery:** Handle missing, deleted, inaccessible, partially loaded, or failed discussion requests without navigating away from the project workspace or displaying messages from a different discussion.
- **Accessibility:** Support keyboard focus management, modal semantics, screen-reader labels for controls and message roles, visible focus states, and non-color-only Active or error indications.
- **Performance baseline:** Keep opening, switching, and scrolling discussions responsive for the expected MVP thread length. Establish an implementation benchmark for message count and rendered content rather than assuming unbounded conversation size.
- **Analytics:** Instrument discussion lifecycle and model-request outcomes. Analytics payloads may include identifiers, timestamps, model metadata, latency, and token counts where available, but must not include full prompts, answers, frozen context, or generated titles unless separately approved under the privacy policy.

### Out of scope

- Selecting bubbles or documents before discussion creation
- Creating, serializing, updating, or inspecting frozen context snapshots
- Adding, removing, ignoring, or refreshing context after a discussion starts
- Switching an existing discussion from frozen context to current source versions
- Bubble creation, editing, deletion, linking, positioning, selection, or Compact layout
- Knowledge-extraction source selection, AI synthesis, proposal editing, approval, update-existing choice, rejection, or proposal history
- Document upload, parsing, inspection, search, annotation, or passage-level selection
- User-controlled discussion-title editing or renaming
- Message editing, message deletion, answer regeneration, alternate-answer generation, or branching from an earlier message
- Discussion forking, duplication, merging, archiving, pinning, folders, tags, search, or filters
- Automatic topic-drift detection, forced topic limits, proactive prompts to create a new discussion, or automatic topic management
- Streaming token-by-token AI responses as a required MVP behavior; the implementation may use transport streaming internally, but the product contract is a coherent completed response state
- Multi-model comparison, simultaneous answers, model switching inside an existing discussion, or exposing advanced generation parameters
- Automatic conversion of messages into durable bubbles without explicit extraction and approval
- Knowledge audits, contradiction detection, duplicate detection, or validation workflows
- Editing or deleting bubbles when their source discussion is deleted
- Restoring unsent prompt drafts across project reloads or sessions
- Persisting modal window position, dimensions, or multiple floating discussion windows
- Automatically opening the Active discussion when the project loads
- Team comments, shared presence, concurrent collaborative messaging, roles, or permissions
- Full offline messaging, background AI execution after the user leaves, or push notifications when a response finishes
- Unlimited conversation-history guarantees or specialized virtualization for very large legacy threads unless required by measured MVP usage

## Risks / Open Questions

- **What counts as approximately one minute:** A strict word or token cap would make the criterion easy to measure but could reduce correctness for complex prompts. Pure prompt guidance is harder to test. The current leaning is a soft response budget in the system prompt, product analytics on response length, and no hard truncation.
- **Completed cards versus visible generation:** The foundation discourages default streaming, but implementation transport and perceived latency remain open. Waiting for a complete response supports the “finished thought” model; progressive display may feel faster. The current leaning is to present a coherent final message and a pending state, even if the backend uses streaming internally for reliability or latency.
- **Active semantics versus list stability:** Opening a discussion changes Active status and list ordering, meaning simple inspection can move old discussions to the top. This matches the agreed product behavior but may make the list feel unstable. The current leaning is to treat explicit open as qualifying activity and avoid updating activity for scrolling or repeated focus while already open.
- **`updated_at` versus separate activity timestamps:** Using one field for message changes and opening simplifies the model but obscures whether content changed. Separate `last_message_at` and `last_opened_at` fields preserve meaning but add complexity. The current leaning is a derived `last_activity_at` plus separate immutable message timestamps; project-level `updated_at` should not necessarily change merely because a discussion was opened.
- **Minimize versus close terminology:** The source requirements mention both controls but define one practical outcome: hide the modal and preserve the discussion in the right panel. Two controls with the same behavior would be confusing. The current leaning is one Minimize or Close control in the MVP, with one consistent label selected during interaction design.
- **First prompt timing:** A discussion could be persisted before context selection, after context confirmation, or only when the first prompt is submitted. Creating too early produces empty abandoned discussions; creating too late complicates write-first behavior. The current leaning is to create the durable discussion when context is confirmed and the user commits to opening it, but avoid adding an empty list item until the discussion modal is actually opened.
- **Empty discussions:** The requirements do not define whether a discussion with no submitted messages should remain after closing. Persisting it creates noise; deleting it automatically may surprise users if context selection was meaningful. The current leaning is not to retain empty discussions after they are closed, provided no messages or extraction records exist.
- **Title-generation latency and quality:** Title generation can fail, produce vague wording, or add a second model call after every first response. Blocking the answer is unacceptable, but poor placeholders may clutter the panel. The current leaning is asynchronous title generation immediately after the first completed exchange with a deterministic temporary title and no user rename capability.
- **Title length:** Without a limit, generated titles may break the modal header or discussion list. An overly short limit creates ambiguous titles. The implementation should define a character or line limit and instruct the model accordingly; the current leaning is a concise single-line title with UI truncation only for display, while preserving the generated full title within the accepted limit.
- **Response failure representation:** Appending an assistant “error message” as if it were conversational content would pollute the immutable transcript. Keeping failures only in client state makes reload recovery difficult. The current leaning is a generation-attempt record or message status that is not treated as an AI-authored message, allowing retry without corrupting the transcript.
- **Retry versus regeneration boundary:** Users may interpret Retry as a way to request a different answer after a successful response. That would violate the no-regeneration MVP scope. The current leaning is to expose Retry only while no successful AI message exists for the submitted user turn.
- **Message-send atomicity:** Persisting the user message before the AI call protects against loss but can leave unanswered turns; persisting both only after generation risks losing the user's input on a model failure. The current leaning is to persist the user message first, track the pending response attempt, and clearly support retry.
- **Discussion context size:** Full prior messages plus frozen documents and bubbles may exceed provider context limits. Silent truncation would violate reproducibility. The Discussion Context and model orchestration layers must define deterministic overflow behavior before launch. The current leaning is to reject submission with an actionable size error rather than silently drop frozen context, while considering transparent message-history compaction only after the MVP.
- **Long-discussion performance:** The intended narrow-discussion behavior should limit history, but the product does not enforce it. Rendering and resending an ever-growing transcript may become slow or expensive. The current leaning is to benchmark a realistic upper bound, instrument message counts and token usage, and defer branching or automatic summaries until observed behavior justifies them.
- **Markdown and rich-content safety:** Supporting tables, code, citations, and rich text increases usefulness but introduces sanitization and layout complexity. The current leaning is a controlled renderer with a limited safe syntax rather than unrestricted HTML.
- **Discussion deletion model:** Hard deletion is simple and matches the absence of archive, while soft deletion can support recovery, auditing, and referential integrity. The user-facing contract only requires disappearance after confirmation. The current leaning is soft deletion internally where inexpensive, with no trash or restoration UI in the MVP.
- **Bubbles sourced from deleted discussions:** Existing bubbles must survive, but their source reference may no longer open. Removing the reference loses provenance; retaining a dead link is confusing. The current leaning is to preserve source metadata and display that the source discussion was deleted, without retaining the full deleted transcript solely for bubble navigation unless data-retention policy requires it.
- **Reopening presentation state:** Restoring exact scroll position can help continuity but adds persistence writes and may open a thread away from its latest message. The current leaning is to open at the latest message by default and treat exact scroll restoration as optional, not a success criterion.
- **Concurrent tabs:** Two tabs can submit messages or change Active status in conflicting order. Full real-time synchronization is out of scope, but duplicate or reordered messages are unacceptable. The current leaning is server-authoritative chronological ordering, idempotent submissions, and last-qualifying-activity-wins Active calculation.
- **Model selection ownership:** The MVP source does not define whether users choose a model globally, per project, or per message. This PRD should consume the application's selected model through an external configuration contract rather than introduce a new model-selector feature.
- **Privacy and analytics:** Message content is highly sensitive project data. Product analytics need lifecycle and latency signals without collecting reasoning text. The current leaning is identifier- and metadata-only analytics, with content excluded by default.

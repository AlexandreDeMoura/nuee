# PRD 07 — Discussion Web Search

## Problem

Focused discussions answer questions using frozen project context and the model's training
knowledge. Neither can answer questions about current events, recent releases, prices, or any
fact that post-dates the model — and today the AI either declines or, worse, answers from stale
knowledge without signaling it.

Nuée needs an opt-in way for a discussion turn to consult the live web. The model provider
executes the search server-side (OpenAI's Responses API web search tool for the current
provider), the answer cites its web sources, and the sources are visible on the message. The
capability must be expressed provider-neutrally so a future provider (for example Anthropic's
server-side web search tool) is an adapter change inside `ai/`, not a discussions change.

This PRD owns the per-turn search opt-in, the provider-neutral search capability and citation
contracts in the `ModelClient` port, the OpenAI adapter mapping, citation persistence on
assistant messages, and source rendering. It does not change frozen-context semantics,
knowledge extraction, or title generation.

## Target Users and Feature Impact

- **Primary user:** An individual whose focused question depends on information newer or more
  specific than the model's training data.
- **User need:** Ask a question, explicitly allow the AI to search the web for that turn, and
  receive an answer whose external sources are visible and checkable.
- **Feature impact:** Extends discussions with a second, clearly-attributed information channel
  next to frozen context. Establishes the provider-neutral tool seam in `ai/` that future
  provider adapters and future server-side tools will reuse.

## Success criteria

1. The composer offers a web-search toggle for a turn only when the configured provider and
   application configuration support web search; otherwise the toggle is absent, not disabled.
2. Web search is off by default for every turn, including the first prompt of a new discussion.
3. When the toggle is on, the flag applies to that submitted turn; it is permission to search,
   not a command — the model may answer without searching when it does not need to.
4. When the toggle is off, the request grants the model no search tool, and no web content is
   fetched for that turn.
5. The search flag is part of the persisted user turn, so retrying a failed generation reuses
   the original turn's flag and the idempotency guarantees of PRD 03 are unchanged.
6. A completed assistant message produced with web search carries the web sources the provider
   attributed to it, persisted with the message and immutable afterward.
7. Sources are rendered with the assistant message as readable, clickable links (title or
   domain), opening in a new tab without exposing the app to the target page.
8. Only `http`/`https` URLs are rendered as links; any other scheme or malformed citation
   value is dropped or rendered as inert text, never as an active link.
9. An assistant message whose generation used web search is visibly distinguishable from one
   that did not.
10. Enabling search does not alter frozen context: the request still carries the persisted
    frozen context and full prior transcript unchanged, and search results are never written
    into the frozen-context record.
11. Web search never causes live re-reading of bubbles, documents, or project description.
12. Title generation, knowledge extraction, and structured-output calls never receive the
    search tool regardless of the turn flags in the discussion.
13. Provider search failures surface through the existing failed-turn state and are retryable;
    a partially-searched attempt never persists a completed assistant message.
14. A search-enabled request against a provider or configuration without search support is
    rejected at the HTTP boundary with a stable machine-readable error code.
15. Messages persisted before this feature load and render unchanged (no citations, no
    indicator).
16. The discussions feature and frontend reference only the neutral capability and citation
    contracts — no OpenAI type, tool name, or annotation shape outside the provider adapter.
17. The deterministic fake `ModelClient` can simulate search-attributed generations so
    service, e2e, and frontend tests cover the flow without network access.
18. Analytics record that a turn requested search, whether the provider searched, and the
    citation count — never search queries, result contents, or cited URLs.

## Scope

### In scope

- **Composer toggle:** A per-turn web-search toggle in the discussion composer (and the
  write-first draft composer), keyboard accessible, default off, hidden when unsupported.
- **Capability exposure:** A provider-neutral capability value (`webSearch: boolean`) derived
  in `ai/` from the configured provider and an `AI_WEB_SEARCH_ENABLED` kill-switch, exposed to
  the frontend through a small read-only endpoint following the upload-policy precedent.
- **Neutral port extension:** `GenerateAnswerInput` gains an optional web-search request flag;
  `ModelGeneration` gains an optional used-search indicator and a neutral citation list
  (URL, title, optional snippet). Only `generateAnswer` participates.
- **OpenAI adapter mapping:** Translate the neutral flag to the Responses API web search tool,
  and translate URL-citation annotations on the response into neutral citations. Unknown
  annotation types are ignored. Tool naming/versioning stays pinned inside the adapter.
- **Turn and message persistence:** Persist the search flag on the user turn and the citation
  list on the assistant message (guarded JSON, mirroring the frozen-context guard precedent);
  both immutable after persistence. Corrupt persisted citations are a controlled repository
  failure, not a rendering crash.
- **Boundary validation:** Validate the flag at the HTTP boundary, reject it when the
  capability is off, and cap the accepted citation payload size.
- **Source rendering:** A sources block under the assistant message with sanitized links,
  a search-used indicator, and screen-reader labels; graceful rendering when a search-enabled
  answer has zero citations.
- **Deterministic fake:** Extend the fake `ModelClient` to honor the flag and emit stable
  citations for tests, including the no-search and failure branches.
- **Analytics:** Per-turn search-requested, search-used, and citation-count metadata under the
  existing identifier-only policy.

### Out of scope

- Automatic search without the per-turn opt-in, or heuristic "should I search" UI
- A per-discussion or global default-on setting
- User-visible or user-editable search queries, search progress states, or streaming
- Search configuration surface (context size, user location, domain allow/deny lists) beyond
  internal adapter defaults
- Fetching, storing, snapshotting, or re-serving the content of cited pages
- Inline citation markers tied to text ranges (MVP renders a per-message source list)
- Citing frozen-context bubbles or documents through this mechanism
- Carrying web sources into knowledge-extraction proposals or bubble source metadata
- Client-orchestrated tool loops for providers without server-side search execution
- Any other tool (code execution, file search, computer use) behind the same seam
- Search inside uploaded documents (Document Library explicitly excludes retrieval)

## Risks / Open Questions

- **Reproducibility versus liveness:** Frozen context exists so a discussion's inputs are
  stable; web results are inherently unstable and a retried or similar question may cite
  different sources. The current leaning is to accept this openly: search is opt-in per turn,
  answers persist their citations, and the product never claims a searched answer is
  reproducible from frozen context alone.
- **Citation fidelity across providers:** Providers differ in whether they return text offsets,
  snippets, or only URLs. Anchoring the neutral contract to the richest shape would make the
  next adapter lossy or fragile. The current leaning is a per-message ordered source list
  (URL, title, optional snippet) and no offset-based inline anchors in the MVP.
- **Per-turn versus per-discussion toggle:** Per-turn is more deliberate but adds a decision to
  every send; users may expect stickiness. The current leaning is per-turn with the composer
  remembering the last choice within the open modal session only — nothing persisted.
- **Cost and latency:** Search tool calls add provider fees and seconds of latency, and
  searched turns can approach the request timeout. The current leaning is to keep the existing
  timeout, surface the ordinary pending state, and let usage metadata drive any later budget.
- **Token budgeting blind spot:** The input-budget estimator counts only the input Nuée sends;
  provider-side search results consume context invisibly. The current leaning is to leave the
  estimator unchanged, record reported token usage, and revisit reserved headroom if searched
  turns start failing on size.
- **Unsafe or misleading sources:** The model may cite low-quality pages, and URLs render as
  outbound links. The current leaning is scheme allow-listing, `rel="noopener noreferrer"`,
  no auto-fetch or preview of cited pages, and no source-quality scoring in the MVP.
- **Provider tool churn:** OpenAI has already renamed its search tool once
  (`web_search_preview` → `web_search`). Pinning the tool identity inside the adapter keeps
  churn out of the port; the adapter's translation is the only place that changes.

## Commit Plan

Backend before frontend; each commit leaves build, lint, and the affected side's unit tests
(plus backend e2e where noted) green.

1. **`feat(shared): add web-search capability and citation contracts`**
   `MessageCitation` (url, title, optional snippet), optional `citations` and search-used
   metadata on `DiscussionMessage`, optional `web_search` flag on `CreateDiscussionInput` and
   `SendMessageInput`, and an `AiCapabilities` response DTO. *Verify: build.*

2. **`feat(backend): neutral web-search seam in the ModelClient port`**
   Extend `GenerateAnswerInput`/`ModelGeneration` with the neutral flag, used-search indicator,
   and citations; extend the fake client deterministically; add `AI_WEB_SEARCH_ENABLED` to the
   typed config and a capabilities value exported from `ai/`. *Verify: backend build, lint, unit.*

3. **`feat(backend): OpenAI adapter web-search tool and citation mapping`**
   Extend the internal Responses request/response shapes with tools and output annotations,
   attach the web search tool only when the neutral flag is set on `generateAnswer`, map
   URL-citation annotations to neutral citations, ignore unknown annotations, and keep the
   existing `ModelProviderError` translation. *Verify: backend build, lint, unit.*

4. **`feat(backend): persist per-turn search flag and assistant citations`**
   Migration adding the user-turn flag and guarded assistant-citation JSON; service threads the
   flag through create, send, and retry (reusing the persisted turn's flag); HTTP boundary
   validation with a stable rejection code when the capability is off; `GET /ai-capabilities`.
   *Verify: backend build, lint, unit, discussions e2e.*

5. **`feat(frontend): composer search toggle and api plumbing`**
   Capability fetch in the api layer, `web_search` on create/send calls, accessible default-off
   toggle in the composer shown only when supported, choice preserved across retry.
   *Verify: frontend build, lint, unit.*

6. **`feat(frontend): render assistant message sources`**
   Sources block with sanitized `http(s)`-only links, search-used indicator, zero-citation and
   legacy-message handling, screen-reader labels; analytics for search-requested/used and
   citation count. *Verify: frontend build, lint, unit.*

7. **`docs: record the web-search seam`**
   Update `BACKEND_ARCHITECTURE_ANALYSIS.md` / `ARCHITECTURE_ANALYSIS.md`, and `CLAUDE.md` +
   `AGENTS.md` for the `ai/` capability boundary (neutral tool flags and citations in the port;
   provider tool mapping confined to adapters).

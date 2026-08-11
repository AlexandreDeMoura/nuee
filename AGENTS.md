# Nuée Technical Direction

Architectural boundaries for contributors and coding agents — not product requirements or task
instructions. Update it when a change deliberately moves a boundary. `AGENTS.md` is a copy of this
file; keep the two in sync.

## Layout and commands

npm-workspaces monorepo:

- `frontend/` — React 19 + Vite + TypeScript SPA: client-rendered, small first-party router, Tailwind.
- `backend/` — synchronous NestJS modular monolith on the Express adapter, direct `node:sqlite`.
- `shared/` — `@nuee/shared-types`, the serialized request/response contracts both sides import,
  plus the validation limits both sides must agree on (`src/validation-limits.ts`). It compiles to
  `shared/dist` for the backend runtime; frontend tooling and both Jest configs read `shared/src`
  directly, so no workflow depends on a prebuilt `dist`. Keep it dependency-free and side-effect
  free: contracts and constants only, never feature logic.

From the repo root: `npm run dev`, `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e`
(backend HTTP journeys in `backend/test/`). After a module, API, or persistence boundary change,
run build, lint, and unit tests for the affected side plus backend e2e. Keep manual UI QA separate
from static verification.

## Cross-cutting rules

- Prefer incremental refactors over framework, state-management, or domain-driven rewrites.
- Add no dependency the platform or existing code already expresses: no React Query, Redux, or
  Zustand over the current local state; no ORM over the small explicit SQL; no microservices,
  broker, Redis, CQRS, or event sourcing without demonstrated need.
- Organize by feature; keep tests beside the code they cover. Split a file when it holds
  independently nameable responsibilities, not to create layers preemptively. Preserve public
  import paths during mechanical reorganizations.
- Ownership follows the behavior's responsibility, not the domain type it touches. A flow crossing
  features keeps orchestration in the lowest common owner, behind a typed callback or port.
- When a change supersedes a weakness recorded in `FRONTEND_ARCHITECTURE_IMPROVEMENTS.md` or
  `BACKEND_ARCHITECTURE_IMPROVEMENTS.md`, update that file.

## Frontend (`frontend/src/`)

### Feature ownership

- `projects/` — project creation and metadata editing.
- `workspace/` — route-level project composition, panels, shared workspace state.
- `canvas/` — where territories appear in space: joint bubble/territory collection load, pan, zoom,
  territory drag, bubble-row selection, measured compact layout, overlays, and territory
  position/visible-count plus viewport persistence. `TerritoryCard` lives here.
- `bubbles/` — what a bubble contains: creation fields, content editing, source metadata, manual
  links, deletion, validation, save status. `BubbleInspector` lives here.
- `discussions/` — focused-discussion presentation and client lifecycle: write-first draft, single
  visible modal, composer and message states, failed-turn retry, generated titles, list and Active
  display, reopening, deletion, per-turn web-search opt-in, source attribution. It renders
  frozen-context and knowledge-extraction integration points but owns neither workflow.
- `documents/` — document-library client lifecycle: policy-backed preflight, transfers, processing
  polling and retry, list and inspection states, whole-document context selection. Displays only
  processed text for ready documents; owns no original-file rendering.
- `knowledge-extraction/` — extraction state machine, source and target selection, proposal review.
- `api/`, `analytics.ts`, `utils/` — cross-cutting. `ui/` — shared primitives, no feature behavior.
- Keep a component near its only consumer; promote when ownership becomes shared. Prefer
  feature-local hooks and model helpers over a global hooks folder.

### Components, hooks, and state

- Components compose hooks and render JSX. Extract a hook when a state-and-ref cluster has its own
  transitions and failure semantics. Lift state only to the lowest owner coordinating all consumers.
- Model server data as explicit load states, not unrelated loading and error booleans. Keep
  mutation failure visible and retryable; never silently discard optimistic user changes.
- Guard async results against aborts, unmounts, stale attempts, and invalid response shapes. Use
  refs deliberately for current async values, not as a shadow state tree.
- Keep request functions injectable so tests use fakes without module mocking; cover the failure,
  retry, abort, stale-response, and invalid-response branches.

### API boundary

- All HTTP lives under `frontend/src/api/`; never call `fetch` from feature code. `api/client.ts`
  owns base URL, JSON transport, and normalized `ApiError`; each REST resource owns a module
  (`api/projects.ts`); `api/index.ts` is the stable public barrel.
- Transport contracts come from `@nuee/shared-types`; UI may derive stricter local types.
  Compile-time contracts do not replace runtime response checks on mutation-critical paths.
- A validation limit the client and server must both honour is defined once in
  `@nuee/shared-types` and imported, never re-declared. The server still enforces it
  independently; the shared constant removes drift, it does not make the client trusted.

### Styling and accessibility

- Use Tailwind and the existing visual language, with shared tokens or UI primitives for repeated
  palette or chrome; no unrelated visual changes during refactors.
- Accessibility is behavior, not polish: preserve keyboard handling, focus management, live status,
  labels, and reduced-motion support.

## Backend (`backend/src/`)

One deployable application, one running instance, while SQLite is the write store. Keep request
workflows synchronous; durable job records only for genuinely slow, retryable, or restart-surviving
work — modeled in SQLite (state and idempotency) before any worker, and a broker only if that model
cannot meet concrete requirements.

### Feature ownership

- `projects/` — project lifecycle, metadata, viewport state, persistence.
- `bubbles/` — bubble lifecycle, content, territory assignment, links, persistence.
- `territories/` — project-scoped territory persistence, visible-count and spatial updates, the
  ungrouped lifecycle, and the synchronous AI recompose workflow.
- `discussions/` — project-scoped discussion and immutable-message lifecycle, title generation,
  frozen-context persistence and forwarding, generation-attempt status and idempotency, soft
  deletion, persistence. Owns the `last_activity_at` ordering/Active model: creation, explicit
  open, and new messages qualify; title generation, minimization, scrolling, extraction do not.
- `documents/` — upload validation, private original-file storage, persistence, malware scanning,
  text extraction, processing leases and retry, inspection reads, and the ready-document
  context-source capability. Owns live documents, not frozen copies or document-derived bubbles.
- `discussion-context/` — assembles the `FrozenContext` package from project sources.
- `knowledge-extraction/` — extraction workflow, prompts, resolution, and its own persistence.
- `ai/` — cross-cutting, provider-neutral model access: the `ModelClient` port, provider adapters,
  deterministic test implementation, capability discovery, neutral tool-request and citation
  contracts. No discussion validation, persistence, retry, activity, title-trigger, or
  context-selection policy. Provider tool names, versions, and response annotations stay inside
  their adapter; only answer generation may receive optional tools.
- `config/`, `database/` — cross-cutting infrastructure. Controllers, services, repository ports and
  implementations, migrations, types, and unit tests stay in the owning feature; no repository-wide
  `controllers/`, `services/`, or `interfaces/` folders, and feature SQL stays in feature repositories.
- Export the narrowest cross-feature capability; direct service reuse is fine while the module
  graph stays small.

### Discussion seams

- Routes stay nested under the project; service and repository operations scope reads and writes by
  both project and discussion ID.
- Creating a discussion atomically persists the discussion and first user turn. Later user turns use
  a per-discussion idempotency key; pending and failed state belongs to the persisted user turn,
  and only valid model output becomes an immutable assistant message.
- `FrozenContext` is opaque to discussions: enforce transport-size and JSON-object guards, then
  persist and forward it without interpreting source semantics or dereferencing live data.
- Web search is per-turn state, not frozen context. Discussions gates the opt-in against the neutral
  AI capability, persists it on the user turn for retry, and immutably persists the used-search
  indicator and citations on the completed assistant message. Search never triggers a live
  project-source read; title generation and structured output never inherit the search tool.
- Knowledge extraction consumes discussion and message identifiers through an integration boundary —
  not from `DiscussionsService` or `ModelClient`. Deleting a discussion must not delete bubbles
  independently persisted through extraction.

### Document seams

- Upload completion durably associates one SQLite record with one privately stored original under a
  server-generated opaque key before processing begins. Submitted filenames never become paths, and
  original-file download or rendering is out of MVP scope.
- Processing is the monolith's first durable in-process job boundary: SQLite owns status, attempt,
  generation, and lease state while the coordinator owns only bounded execution. Expired leases are
  recoverable after restart and generation-guarded writes prevent stale completions from overwriting
  a newer result. No broker unless measured work outgrows this single-instance model.
- Malware scanning precedes extraction in production. Ready requires non-empty normalized text whose
  processed-source hash matches the stored original; processing and failed records never expose
  partial context text.
- Discussion Context reads ready documents through a narrow project-scoped capability and copies
  title and complete processed text into its own immutable snapshot. It never accepts client-supplied
  document text or dereferences a live document after discussion creation.

### Services and persistence

- Controllers define HTTP concerns and delegate; never duplicate validation or workflows there.
- Services own workflow validation, normalization, IDs and timestamps, project scoping, and
  cross-repository coordination. Keep persistence behind injectable repository ports so services and
  tests never depend on SQL; tests use fakes or in-memory SQLite, not module mocks.
- Extract framework-independent rules into pure functions when they form a cohesive, testable
  algorithm; do not force everything into a formal domain model.
- Keep SQL explicit and parameterized; never interpolate request values into statements. Reinforce
  durable invariants with SQLite constraints even when services validate the same rule, and use
  explicit transactions for multi-write all-or-nothing operations.
- Translate expected conflicts, constraint failures, and contention into stable application errors
  without exposing SQL details; corrupt persisted values are controlled repository failures.
- Updates stay last-write-wins until concurrent editing is a real workflow; then prefer a version or
  `updated_at` precondition over distributed locking.

### HTTP API

- Synchronous JSON REST; nest resources under the project when membership is part of the operation.
- Validate at runtime at the HTTP boundary — TypeScript alone is not validation. Reject unknown or
  malformed input; enforce text lengths, numeric ranges, body limits, and batch-size limits.
- Preserve stable machine-readable error codes, field-level validation details, and existing 4xx
  shapes; log unexpected failures with enough context to diagnose.
- Return persistence-shaped objects while API and storage contracts intentionally match; add DTOs
  only where they must diverge. Add pagination before a collection can grow unbounded. No version
  prefix or generated contract until a breaking change or external consumer justifies it.

### Configuration and operations

- SQLite stays until measured load, horizontal writes, multi-region, or hosting constraints require
  a server database. Private document originals share its durability boundary: both configured paths
  go on persistent encrypted local storage and are backed up and restored as one consistent set. See
  `backend/DOCUMENT_OPERATIONS.md` for the runbook and retention rules.
- `DatabaseProvider` runs registered migrations once, in order, before repositories are constructed.
  `schema_migrations` is authoritative, `PRAGMA user_version` mirrors it, and the pending set is
  atomic; repositories never execute schema DDL.
- One application-scoped `DatabaseProvider` owns the shared `DatabaseSync`, enables foreign keys,
  sets `busy_timeout` to 5000 ms, and closes on shutdown. Keep readiness lightweight (`SELECT 1`).
- Request services stay stateless; durable state belongs in persistence. No cache without a measured
  problem — prefer query changes and targeted indexes first.
- One typed, validated configuration path (port, frontend origin, database path, environment mode),
  validated at startup along with allowed origins. Pin one Node major supporting `node:sqlite` across
  dev, CI, and production. Handle bootstrap failures explicitly and shut down gracefully.
- Log requests lightly (method, route, status, duration, request ID); never log bodies or sensitive
  values by default.

### Security

- The unauthenticated API is for trusted single-user access only. Before untrusted or multi-user
  exposure, add one global authentication boundary plus project ownership/membership authorization
  enforced in service or repository queries. CORS, UUIDs, and nested paths are not authorization.
- Apply rate limits, body-size limits, secure headers, and HTTPS at the reverse proxy or application
  boundary per the chosen deployment.

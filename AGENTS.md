# Nuée Technical Direction

Guidance for contributors and coding agents: architectural boundaries, not product requirements
or task instructions. Update it when a change deliberately moves a boundary. `AGENTS.md` is a
copy of this file; keep the two in sync.

## Repository layout and commands

npm-workspaces monorepo: `frontend/` (React 19 + Vite + TypeScript single-page app —
client-rendered, small first-party router, Tailwind), `backend/` (synchronous NestJS modular
monolith on the Express adapter, direct `node:sqlite`), and `shared/` (`@nuee/shared-types`, the
serialized request/response contracts both sides import).

From the repo root: `npm run dev` (frontend + backend watch), `npm run build`, `npm run lint`,
`npm test`, `npm run test:e2e` (backend HTTP journeys in `backend/test/`).

## Cross-cutting rules

- Prefer incremental refactors over framework, state-management, or domain-driven rewrites.
- Do not add a dependency the platform or existing code already expresses: no React Query,
  Redux, or Zustand for the current local-state architecture; no ORM around the small explicit
  SQL; no microservices, message broker, Redis, CQRS, or event sourcing without demonstrated need.
- Organize product code by feature; keep tests beside the code they cover. Split a file when it
  contains independently nameable responsibilities, not to create layers preemptively. Preserve
  public import paths during mechanical reorganizations when practical.
- After module-, API-, or persistence-boundary changes, run build, lint, and unit tests for the
  affected side (plus backend e2e). Keep manual UI QA separate from static verification.
- Update `ARCHITECTURE_ANALYSIS.md` (frontend) or `BACKEND_ARCHITECTURE_ANALYSIS.md` when an
  implemented change supersedes a recorded weakness.

## Frontend (`frontend/src/`)

### Feature ownership

- `projects/` — project creation and project metadata editing.
- `workspace/` — route-level project composition, panels, shared workspace state.
- `canvas/` — where and how bubbles appear in space: loading the spatial collection, pan, zoom,
  drag, selection, compact layout, card placement, overlays, position/viewport persistence.
  `BubbleCard` lives here as the canvas rendering and interaction unit.
- `bubbles/` — what a bubble contains and its lifecycle: creation fields, content editing,
  source metadata, manual links, deletion, validation, content-save status. `BubbleInspector`
  lives here because it edits bubble content and relationships.
- `discussions/` — focused-discussion presentation and client lifecycle: the write-first draft,
  single-visible modal, composer and message states, failed-turn retry, generated-title display,
  discussion list, Active display, reopening, and deletion. It renders frozen-context and
  knowledge-extraction integration points but does not own either upstream workflow.
- `api/`, `analytics.ts`, `utils/` — cross-cutting. `ui/` — shared primitives, no feature behavior.
- Ownership follows the behavior's responsibility, not the bubble domain type; flows crossing
  both keep orchestration in the lowest common owner behind a typed callback or hook result.
- Keep a component near its only consumer; promote only when ownership becomes shared. Prefer
  feature-local hooks and model helpers over a global hooks folder.

### Components, hooks, and state

- Components primarily compose hooks and render JSX. Extract a hook when a state-and-ref
  cluster has its own transitions and failure semantics.
- Keep server data in explicit load states, not unrelated loading and error booleans. Lift
  state only to the lowest owner that must coordinate all consumers.
- Keep mutation failure visible and retryable; never silently discard optimistic user changes.
- Protect async results against aborts, unmounts, stale attempts, and invalid response shapes.
  Use refs deliberately for current async values, not as a shadow state tree.
- Keep request functions injectable so tests use fakes without module mocking; exercise the
  failure, retry, abort, stale-response, and invalid-response branches in tests.

### API boundary

- All HTTP calls live under `frontend/src/api/`; never call `fetch` from feature code.
  `api/client.ts` owns the base URL, JSON transport, and normalized `ApiError`; each REST
  resource owns a module (`api/projects.ts`), created when the resource is new; `api/index.ts`
  is the stable public barrel.
- Transport contracts come from `@nuee/shared-types`; UI may derive stricter local types.
  Compile-time contracts do not replace runtime response checks on mutation-critical paths.

### Styling and accessibility

- Use Tailwind utilities and the existing visual language, with shared tokens or UI primitives
  for repeated palette or chrome; no unrelated visual changes during refactors. Accessibility
  semantics are behavior, not polish: preserve keyboard behavior, focus management, live
  status, labels, and reduced-motion support.

## Backend (`backend/src/`)

One deployable application, one running instance, while SQLite is the write store. Keep request
workflows synchronous; durable job records only for genuinely slow, retryable, or
restart-surviving work — modeled in SQLite (state and idempotency) before any worker, with a
broker only if that model cannot meet concrete requirements.

### Feature ownership

- `projects/` — project lifecycle, metadata, viewport state, project persistence.
- `bubbles/` — bubble lifecycle, content, placement, links, bubble persistence.
- `discussions/` — project-scoped discussion and immutable-message lifecycle, title generation,
  frozen-context persistence/forwarding, generation-attempt status and idempotency, soft deletion,
  and discussion persistence. It owns the `last_activity_at` ordering/Active model: creation,
  explicit open, and new-message activity qualify; title generation, minimization, scrolling, and
  extraction do not.
- `ai/` — cross-cutting, provider-neutral model access. It owns the `ModelClient` port, provider
  adapter, and deterministic test implementation, but no discussion validation, persistence,
  retry, activity, title-trigger, or context-selection policy.
- Controllers, services, repository ports/implementations, migrations, types, and unit tests
  stay in the owning feature; no repository-wide `controllers/`, `services/`, or `interfaces/`
  folders.
- Database construction, configuration, and migration execution are cross-cutting
  infrastructure; feature-specific SQL stays in feature repositories.
- Export the narrowest cross-feature capability; direct service reuse is fine while the module graph stays small.

### Discussion seams

- Discussion routes remain nested under their project, and service and repository operations
  scope reads and writes by both project and discussion ID.
- Creating a discussion atomically persists the discussion and first user turn. Later user turns
  use a per-discussion idempotency key; pending/failed state belongs to the persisted user turn,
  while only valid model output becomes an immutable assistant message.
- `FrozenContext` is an opaque serialized contract assembled by Discussion Context. The
  discussions feature may enforce transport-size and JSON-object guards, but must persist and
  forward the accepted package without interpreting source semantics or dereferencing live data.
- Knowledge Extraction consumes discussion and message identifiers through an integration
  boundary. It does not belong in `DiscussionsService` or `ModelClient`, and deleting a discussion
  must not delete independently persisted bubbles created through extraction.

### Controllers, services, and persistence behavior

- Controllers define HTTP concerns and delegate; never duplicate validation or workflows there.
- Services own workflow validation, normalization, IDs and timestamps, project scoping, and
  coordination across repositories. Keep persistence behind injectable repository ports so
  services and tests never depend on SQL; tests use fakes or in-memory SQLite, not module mocks.
- Extract framework-independent rules into pure functions when they form a cohesive, testable
  algorithm; do not force everything into a formal domain model.
- Keep SQL explicit and parameterized; never interpolate request values into statements.
- Reinforce durable relational invariants with SQLite constraints even when services validate
  the same rule. Use explicit transactions for multi-write all-or-nothing operations.
- Translate expected conflicts, constraint failures, and contention into stable application
  errors without exposing SQL details; corrupt persisted values are controlled repository failures.
- Updates stay last-write-wins until concurrent editing is a real workflow; then prefer a
  simple version or `updated_at` precondition over distributed locking.

### HTTP API

- Synchronous JSON REST; nest resources under the project when membership is part of the operation.
- Validate at runtime at the HTTP boundary — TypeScript alone is not validation. Reject unknown
  or malformed input; enforce text lengths, numeric ranges, body limits, and batch-size limits.
- Preserve stable machine-readable error codes, field-level validation details, and existing
  4xx response shapes; log unexpected failures with enough context to diagnose.
- Return persistence-shaped objects while API and storage contracts intentionally match; add
  DTOs only where they must diverge. Add pagination before a collection can grow unbounded. No
  version prefix or generated contract until a breaking change or external consumer justifies it.

### Persistence, configuration, and operations

- SQLite stays until measured load, horizontal writes, multi-region, or hosting constraints
  require a server database. Production puts the file on persistent local storage with backup
  and restore procedures; add only the deployment artifact the selected host requires.
- `DatabaseProvider` runs registered migrations once, in order, before repositories are
  constructed. `schema_migrations` is authoritative, `PRAGMA user_version` mirrors it, and the
  pending migration set is atomic; repositories do not execute schema DDL.
- One application-scoped `DatabaseProvider` owns the shared `DatabaseSync`, enables foreign
  keys, sets `busy_timeout` to 5000 ms, and closes the connection on shutdown. Evaluate WAL
  against the actual storage environment; keep readiness lightweight (`SELECT 1`).
- Request services stay stateless; durable state belongs in persistence. No cache without a
  measured problem — prefer query changes and targeted indexes first.
- One typed, validated configuration path (port, frontend origin, database path, environment
  mode); validate required production config and allowed origins at startup. Pin one Node major
  supporting `node:sqlite` across dev, CI, and production. Handle bootstrap failures explicitly
  and shut down gracefully so connections close.
- Log requests lightly (method, route, status, duration, request ID); never log bodies or
  sensitive values by default.

### Security

- The unauthenticated API is for trusted single-user access only. Before untrusted or
  multi-user exposure, add one global authentication boundary plus project ownership/membership
  authorization enforced in service or repository queries; CORS, UUIDs, and nested resource
  paths are not authorization controls.
- Apply rate limits, body-size limits, and secure headers at the reverse proxy or application
  boundary per the chosen deployment.

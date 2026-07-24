# Nuée Technical Direction

This document records the intended technical direction for contributors and coding agents.
It describes architectural boundaries, not product requirements or temporary task instructions.
Keep it current when a change deliberately moves one of these boundaries.

## Frontend

### Runtime and application shape

- The frontend is a React 19 single-page application built with Vite and TypeScript.
- Keep the application client-rendered unless a concrete deployment need justifies otherwise.
- The small first-party router remains appropriate while routes stay shallow.
- Prefer incremental refactors over framework or state-management rewrites.
- Do not add a dependency when the existing platform and React APIs express the behavior clearly.

### Source organization

- Organize product code by feature under `frontend/src/`.
- `projects/` owns project creation and project metadata editing.
- `workspace/` owns route-level project composition, panels, and shared workspace state.
- `canvas/` owns spatial presentation and interaction.
- `bubbles/` owns bubble content and lifecycle.
- `api/`, `analytics.ts`, and `utils/` are current cross-cutting boundaries.
- Use `ui/` when shared visual primitives are introduced; do not put feature behavior there.
- Keep a component near its only consumer; promote it only when ownership becomes shared.
- Split a file when state, persistence, and presentation can be named as separate concerns.
- Prefer focused hooks and model helpers inside the owning feature over a global hooks folder.

### Canvas and bubble ownership

- Put code in `canvas/` when its main responsibility is where or how bubbles appear in space.
- Canvas responsibilities include loading the spatial collection, pan, zoom, drag, selection,
  compact layout, card placement, canvas overlays, and position or viewport persistence.
- Put code in `bubbles/` when its main responsibility is what a bubble contains or its lifecycle.
- Bubble responsibilities include creation fields, content editing, source metadata, manual
  links, deletion, validation, and content-save status.
- `BubbleCard` belongs to `canvas/` because it is the canvas rendering and interaction unit.
- `BubbleInspector` belongs to `bubbles/` because it edits bubble content and relationships.
- A bubble domain type does not determine folder ownership; the behavior's responsibility does.
- When a flow crosses both areas, keep orchestration in the lowest common owner and expose a
  typed callback or hook result across the boundary.

### Components, hooks, and state

- Components should primarily compose hooks and render JSX.
- Extract a hook when a state-and-ref cluster has its own transitions and failure semantics.
- Keep server data in explicit load states rather than unrelated loading and error booleans.
- Lift state only to the lowest owner that must coordinate all of its consumers.
- Keep mutation failure visible and retryable; do not silently discard optimistic user changes.
- Protect async results against aborts, unmounts, stale attempts, and invalid response shapes.
- Use refs deliberately for current async values, not as an alternative shadow state tree.
- Keep request functions injectable so tests can use fakes without module mocking.
- Do not introduce React Query, Redux, or Zustand for the current local-state architecture.

### API boundary

- All HTTP calls belong under `frontend/src/api/`; do not call `fetch` from feature code.
- `api/client.ts` owns the base URL, JSON transport, and normalized `ApiError`.
- Each REST resource owns a module such as `api/projects.ts` or `api/bubbles.ts`.
- Add a future feature endpoint to its resource module, creating one when the resource is new.
- `api/index.ts` is the stable public barrel for existing frontend consumers.
- Serialized request and response contracts come from `@nuee/shared-types`.
- UI-only constraints may derive stricter local types from shared transport contracts.
- Compile-time contracts do not replace runtime response checks on mutation-critical paths.

### Styling and accessibility

- Continue using Tailwind utilities and the existing visual language.
- Use shared tokens or UI primitives when touching repeated palette or chrome.
- Preserve keyboard behavior, focus management, live status, labels, and reduced-motion support.
- Treat accessibility semantics as behavior, not optional presentation polish.
- Avoid unrelated visual changes during structural refactors.

### Verification and evolution

- Preserve public import paths during mechanical reorganizations when practical.
- Run TypeScript/build and lint after module-boundary changes.
- Exercise request failure, retry, abort, stale-response, and invalid-response branches in tests.
- Keep manual UI QA separate from static and behavioral verification.
- Update `ARCHITECTURE_ANALYSIS.md` when an implemented change supersedes a recorded weakness.

## Backend

### Runtime and application shape

- The backend is a synchronous NestJS modular monolith using the Express adapter and TypeScript.
- Keep it as one deployable application while the product and operational load fit this model.
- Keep current request workflows synchronous; introduce durable job records only for work that is
  genuinely slow, retryable, or required to survive a process restart.
- Do not introduce microservices, a message broker, Redis, CQRS, event sourcing, or a broad
  domain-driven rewrite without a demonstrated product or operational need.
- Continue using direct `node:sqlite` access rather than adding an ORM solely to wrap the current
  small amount of explicit SQL.

### Source organization and module boundaries

- Organize backend product code by feature under `backend/src/`.
- `projects/` owns project lifecycle, metadata, viewport state, and project persistence.
- `bubbles/` owns bubble lifecycle, content, placement, links, and bubble persistence.
- Keep controllers, services, repository ports and implementations, migrations, types, and unit
  tests close to the feature that owns them.
- Do not reorganize the backend into repository-wide `controllers/`, `services/`, or `interfaces/`
  folders.
- Keep application-scoped database construction, configuration, and migration execution as
  cross-cutting infrastructure while feature-specific SQL remains in feature repositories.
- Export the narrowest cross-feature capability that consumers need. Direct service reuse is
  acceptable while the module graph remains small and clear.
- Split a feature type or service file when it contains multiple independently named
  responsibilities, not to create layers preemptively.

### Controllers, services, and domain behavior

- Controllers should define HTTP concerns and delegate; do not duplicate validation or business
  workflows in controllers.
- Application services own workflow validation, normalization, IDs and timestamps, project
  scoping, and coordination across repositories or feature services.
- Keep persistence behind injectable repository ports so services and tests do not depend on SQL.
- Extract framework-independent business rules into pure functions when they form a cohesive,
  testable algorithm; do not force all service behavior into a formal domain model.
- Reinforce durable relational invariants with SQLite constraints even when services validate the
  same rule.
- Use explicit transactions for multi-write operations that must succeed or fail as a unit.
- Translate expected conflicts, constraint failures, and temporary database contention into
  stable application errors without exposing SQL details.
- Keep updates last-write-wins until concurrent editing becomes a real workflow; then prefer a
  simple version or `updated_at` precondition over distributed locking.

### API boundary

- Expose synchronous JSON REST endpoints with project-scoped nested resources where ownership or
  membership in a project is part of the operation.
- Apply runtime validation consistently at the HTTP boundary; TypeScript interfaces alone are not
  validation.
- Reject unknown or malformed input and enforce explicit text lengths, numeric ranges, request
  body limits, and batch-size limits.
- Preserve stable, machine-readable error codes and field-level validation details for expected
  client errors.
- Return persistence-shaped objects while the API and storage contracts intentionally match.
  Introduce response DTOs only where the public contract must diverge from persistence.
- Add pagination before a collection can grow without a known bound.
- Add an API version prefix or generated contract only when a breaking change, external consumer,
  or multiple maintained clients justify the compatibility machinery.

### Persistence and schema evolution

- SQLite remains the default write store while Nuée runs as a small, single-instance application.
- Keep SQL explicit and parameterized; never interpolate request values into SQL statements.
- Run schema changes once, in order, from one startup path and record them in a
  `schema_migrations` ledger.
- Add the migration ledger before the next schema change. `CREATE TABLE IF NOT EXISTS` scripts may
  bootstrap an empty database but must not be treated as upgrades for an existing schema.
- Prefer one application-scoped database provider shared by repositories. If more than one
  connection is retained, configure every connection deliberately and enable foreign keys on each.
- Use a bounded SQLite busy timeout. Evaluate WAL only against the actual local-storage and
  concurrency environment; do not assume it is safe on a network filesystem.
- Keep database readiness checks lightweight, such as `SELECT 1`.
- Treat corrupt or invalid persisted values as controlled repository failures rather than allowing
  parsing errors or raw database errors to escape.
- Retain SQLite until measured load, horizontal writes, multi-region operation, or hosting
  constraints require a server database.

### State and asynchronous work

- Keep request services stateless; durable application state belongs in persistence.
- Do not add a cache without a measured query or throughput problem. Prefer query changes and
  targeted indexes first.
- When slow or retryable work appears, model its state and idempotency explicitly in SQLite before
  introducing a worker.
- Add a broker only when a SQLite-backed job model cannot meet concrete scaling or delivery
  requirements.
- Choose token or session state as part of an authentication design; do not add Redis solely to
  create sessions.

### Security and access control

- Treat the current unauthenticated API as suitable only for trusted, single-user access.
- Before untrusted or multi-user exposure, add authentication, project ownership or membership,
  and authorization enforced in service or repository queries.
- Use one global authentication boundary plus focused project-access checks unless real role
  requirements justify something more elaborate.
- CORS, UUIDs, and nested resource paths are not authorization controls.
- Apply request-rate and body-size limits at the reverse proxy or application boundary.
- Validate allowed origins and all required production configuration at startup.
- Add secure HTTP headers at the reverse proxy or application layer according to the chosen
  deployment boundary.
- Avoid logging request bodies or sensitive values by default.

### Configuration, observability, and deployment

- Use one typed, validated configuration path for the port, frontend origin, database path,
  environment mode, and future required settings.
- Pin a Node version that supports the project's `node:sqlite` usage and keep the same major
  version in development, CI, and production.
- Keep liveness independent of dependencies and provide a separate database-aware readiness check.
- Add lightweight request logging with method, route, status, duration, and a generated or
  forwarded request ID.
- Preserve the existing expected 4xx response shapes while logging unexpected failures with enough
  context to diagnose them.
- Handle bootstrap failures explicitly and enable graceful shutdown so database connections close
  on deployment signals.
- Run one application instance while SQLite is the write store.
- Production deployments must place the SQLite file on persistent local storage and define backup
  and restore procedures.
- Add only the deployment artifact required by the selected host; do not maintain speculative
  platform configurations.

### Verification and evolution

- Keep unit tests beside feature code and end-to-end HTTP journeys under `backend/test/`.
- Exercise validation boundaries, project scoping, stable error bodies, constraint translation,
  transaction rollback, restart persistence, migrations, and database contention where relevant.
- Keep repository dependencies injectable so tests can use fakes or in-memory SQLite without
  module mocking.
- Run backend build, lint, unit tests, and end-to-end tests after module, API, or persistence
  boundary changes.
- Replace generic starter documentation with application-specific setup, environment, migration,
  health, backup, and deployment guidance as those operational paths are implemented.
- Update `BACKEND_ARCHITECTURE_ANALYSIS.md` when an implemented change supersedes a recorded
  weakness or architectural finding.

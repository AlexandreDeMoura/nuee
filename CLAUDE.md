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

The backend technical direction will be added in a later pass.

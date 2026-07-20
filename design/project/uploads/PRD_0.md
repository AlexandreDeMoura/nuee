# PRD 0 — Nuée MVP Foundation

## Problem

People using AI to explore a new, complex project lose control of what they have learned as conversations accumulate. Useful conclusions remain buried in message history, individual ideas are difficult to revisit without reopening entire conversations, and external notes remain disconnected from the reasoning process that produced them.

Nuée must validate a different project-memory model: focused AI discussions produce user-approved, titled knowledge bubbles that remain visible on a canvas and can be reused as explicit context in later discussions.

This document defines the shared product contract for the MVP. Feature PRDs may add implementation detail, but they must not weaken or redefine the principles, concepts, and scope established here.

## Target Users and Feature Impact

- **Primary user:** An individual working primarily alone while exploring a new and complex project through repeated AI conversations.
- **Typical situation:** The project is still forming, contains several intertwined questions, and does not yet have a large legacy knowledge base.
- **Typical use cases:** Product discovery, investment analysis, early strategy, technical exploration, research in an unfamiliar domain, or analysis involving business, legal, fiscal, and technical constraints.
- **Current tools:** ChatGPT, Claude, documents, and general-purpose knowledge tools such as Notion.
- **Feature impact:** This PRD governs every MVP capability: project workspace, bubble canvas, focused discussions, explicit discussion context, knowledge extraction, and document support.

The MVP is not designed for teams, large established knowledge bases, advanced project management, or users expecting the system to organize all project knowledge automatically.

## Success criteria

1. A user can complete the core loop in one project: start a focused discussion, approve or manually create a bubble, use that bubble as context in a later discussion, and either update the original bubble or create another bubble from the later discussion.
2. The user can complete the core loop at least twice without being required to organize conversations into folders, manually maintain a knowledge graph, or complete a guided project questionnaire.
3. No AI-generated content becomes durable project knowledge unless the user explicitly requests extraction and approves the proposal, or manually creates the bubble.
4. A discussion created with selected bubble or document context continues to use the exact captured content even after the source bubble, document, or project description changes.
5. The project opens on its visual canvas, where all approved bubbles remain accessible independently of the discussions that produced them.
6. The complete history of each non-deleted discussion remains available, while the bubble itself displays synthesized knowledge rather than the original source messages.
7. A user can leave and reopen the same project and recover its persisted project description, documents, bubbles, bubble positions, bubble links, canvas viewport, discussions, discussion messages, AI-generated titles, and frozen context.
8. A user can start a discussion without selecting bubbles or documents; the current project description is still included in the new discussion context.
9. AI responses answer the current question directly and use focused, approximately one-minute responses by default, while still allowing longer formats, tables, steps, or citations when the request justifies them.
10. Product analytics can determine whether a user created a project, started discussions, created or approved bubbles, reused a bubble as context, updated a bubble from a later discussion, completed the core loop, and returned to the same project within seven days.

## Scope

### In scope

- **Shared product model:** Define the MVP semantics of projects, bubbles, discussions, documents, source references, frozen context, and canvas state. Feature PRDs own their implementation but must conform to these definitions.
- **Core habit:** Support and instrument the sequence `discussion → knowledge extraction or manual creation → bubble reuse → refinement or challenge`.
- **User-controlled memory:** Enforce that AI-generated bubble proposals require explicit user approval before becoming durable knowledge. Rejected or abandoned proposals do not appear elsewhere in the MVP.
- **Visual project memory:** Treat the canvas and its bubbles as the primary durable knowledge surface. Discussions are preserved as reasoning history but are not the final organizational structure.
- **Focused-discussion behavior:** Configure the main AI interaction to prioritize direct, narrow answers that can normally be read in approximately one minute. `Answer`, `Caveat`, `Implications`, and `Open question` may be used when helpful but are not mandatory UI sections.
- **Explicit context contract:** Require the user to choose bubble and document context before a discussion starts. The current project description is always included automatically.
- **Frozen reasoning state:** Store snapshots of selected context when a discussion is created rather than relying only on live references. Later source edits must not silently alter existing discussions.
- **Minimal metadata contract:** Keep bubbles limited to the information required to understand, reuse, position, edit, and trace them. The MVP does not introduce taxonomies such as type, confidence, or workflow status.
- **Persistence contract:** Persist all durable project knowledge and discussion state needed to reopen the project consistently across sessions.
- **Shared analytics:** Define consistent events and identifiers across feature PRDs for project creation, discussion activity, context selection, extraction, bubble creation, bubble update, bubble reuse, and project return.
- **Cross-feature integration:** Establish interfaces between the project shell, canvas, discussion modal, context snapshot service, extraction flow, and document storage without prescribing a broad frontend or backend rewrite.

The MVP uses the following shared definitions:

- **Project:** A workspace containing a title, editable description, uploaded documents, bubbles, discussions, and persisted canvas state.
- **Bubble:** A user-approved or manually created unit of durable project knowledge containing a title, summary, synthesized content, source metadata, update timestamp, optional manual links, and canvas position.
- **Discussion:** A focused AI conversation containing an AI-generated title, immutable messages, timestamps, and frozen project context. Messages cannot be edited and AI answers cannot be regenerated in the MVP.
- **Document:** An uploaded source that can be inspected and selected only in full as context for a discussion. Documents do not directly produce bubbles in the MVP.
- **Project description:** Editable project-level context whose current value is automatically captured in every new discussion.

### Out of scope

- Automatic bubble creation without user approval
- Bubble types, confidence levels, statuses, or automatically inferred relationships
- Automatic or AI-suggested context selection
- Knowledge audits, contradiction detection, duplicate detection, or mislabel detection
- Hypothesis-validation workflows or experiment tracking
- Search, filtering, minimaps, bubble groups, or advanced large-canvas navigation
- Team collaboration, permissions, comments, or real-time multiplayer
- Project management, tasks, roadmaps, or workflow automation
- Discussion forking, message editing, answer regeneration, or automatic topic-drift management
- Bubble version-history UI or automatic stale-context detection
- Passage-level document context, document annotations, or direct document-to-bubble extraction
- Automatic knowledge graphs or complex graph visualization
- Import and management of large legacy knowledge bases
- Personal productivity analytics

## Risks / Open Questions

- **Explicit control versus repeated friction:** Requiring approval protects user trust but may make extraction feel like administrative work. If users avoid extraction, the core loop fails. The MVP leans toward preserving explicit approval while minimizing the flow to one proposal, simple fields, and automatic placement.
- **Broad persona versus a coherent validation sample:** “Individuals exploring complex projects” spans founders, researchers, investors, consultants, and technical builders. Different groups may value different parts of the workflow. The initial validation should recruit users with the same behavioral problem—repeated AI-assisted exploration—rather than optimize for a professional title.
- **Visual working memory versus canvas degradation:** An infinite canvas may feel useful with tens of bubbles and unusable with hundreds. The MVP assumes new, relatively small projects and deliberately excludes search and grouping. Usage should be monitored to identify when that assumption breaks.
- **Focused discussions versus habitual chatbot behavior:** Users may continue one broad conversation instead of creating narrow discussions. Enforcing topic boundaries too early could create friction. The MVP leans toward prompt guidance and observation rather than blocking, forking, or proactive drift warnings.
- **Frozen reproducibility versus stale understanding:** Frozen context makes discussions reproducible but may cause users to rely on old knowledge without realizing it. The MVP exposes the captured content and accepts the risk; stale-context detection is a high-priority follow-up.
- **Structured appearance versus false progress:** A canvas of polished bubbles may feel like progress even when conclusions are weak. The MVP does not add confidence labels or validation workflows, so qualitative research must determine whether bubble reuse improves reasoning rather than merely presentation.
- **Approximately one-minute answers versus complex questions:** A strict length limit would damage legitimate analysis. The product should treat one minute as the default response target, not a hard character or token limit, and measure whether users still perceive responses as focused.
- **Core-loop analytics versus user value:** Completion events prove usage, not clearer thinking. Quantitative behavior must be paired with interviews testing whether users retrieve knowledge more easily, understand the project state, and can challenge one idea without creating uncontrollable conversation growth.

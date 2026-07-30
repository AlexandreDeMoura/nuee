# PRD 06 — Document Library

## Problem

People exploring a complex project often begin with useful source material: reports, specifications, notes, interview transcripts, legal documents, or other files. Without document support, users must repeatedly copy information into discussions or rely on memory, and the project workspace cannot serve as a practical home for the material that informs their reasoning.

Nuée needs a lightweight document library that lets users add source files to a project, see whether those files are ready for use, inspect their contents, and make each complete document available for explicit selection as discussion context.

The MVP must keep this capability narrow. Documents are project sources, not durable knowledge bubbles and not a full document-management system. Nuée does not search inside them, annotate them, extract bubbles directly from them, or automatically decide when they should influence a discussion.

This PRD owns document upload, validation, secure file storage, text extraction required for model use, processing states, project-scoped listing, inspection, persistence, and the integration contract that exposes complete ready documents to Discussion Context. The Project Workspace PRD owns the shared right-panel shell and project-creation flow. The Discussion Context PRD owns selecting documents, validating the combined context size, and creating immutable discussion snapshots. The Knowledge Extraction PRD does not extract bubbles directly from live documents.

## Target Users and Feature Impact

- **Primary user:** An individual beginning or exploring a complex project who already has a limited set of source documents relevant to their thinking.
- **User need:** Keep important source material inside the project, verify that Nuée can use it, inspect it without leaving the workspace, and explicitly include the entire document in a focused discussion.
- **Feature impact:** The Document Library supplies project-scoped source material to the workspace and to Discussion Context. It must provide reliable text, clear readiness states, stable document identity, and strong isolation so the model never receives the wrong, incomplete, or unauthorized file.

## Success criteria

1. A user can upload one or more supported documents while creating a project.
2. A user can upload additional supported documents after project creation from the Documents view in the right panel.
3. Uploading a document does not create a bubble, discussion, or AI-generated project knowledge.
4. Every accepted document belongs to exactly one project.
5. A document uploaded to one project does not appear in another project's Documents view.
6. The upload control identifies the file types accepted by the current MVP configuration.
7. Selecting an unsupported file type is rejected before processing begins and produces an actionable error.
8. Selecting a file larger than the configured upload limit is rejected before processing begins and displays the applicable limit.
9. A zero-byte or unreadable file is rejected and is not presented as a ready document.
10. The server validates file type and size independently of client-side validation.
11. The server does not trust the file extension alone when determining whether a file is supported.
12. An uploaded file is stored under a server-generated reference rather than a user-controlled filesystem path.
13. User-supplied filenames are escaped when displayed and cannot execute markup or script.
14. Uploading two different files with the same filename creates two distinct document records rather than overwriting one silently.
15. Retrying the same upload request after a transport failure does not create duplicate records when the original request succeeded.
16. The upload interface displays a visible state for transferring, processing, ready, and failed documents.
17. A successfully transferred document is not marked ready until the text required for model context has been extracted and persisted.
18. A document that is still transferring or processing appears in the Documents view with its current state.
19. A document with failed processing appears with a failed state and an explanation that is useful without exposing internal stack traces.
20. A failed document is not selectable as discussion context.
21. A processing document is not selectable as discussion context.
22. A ready document is exposed to Discussion Context as selectable full-document context.
23. Cancelling or leaving the interface during an active upload does not produce a document marked ready without complete storage and processing.
24. When practical, a recoverable upload failure can be retried without requiring the user to recreate the project.
25. Every persisted document record contains at minimum a stable identifier, project identifier, display title, file reference, extracted text or an equivalent text reference, creation time, update time, and processing state.
26. The document's default display title is derived deterministically from its original filename without exposing a local device path.
27. A document remains listed after the user reloads or later reopens the project.
28. The Documents view lists every non-deleted document belonging to the current project.
29. The Documents view does not list document records belonging to another project even if an identifier is guessed or supplied manually.
30. Each document-list item displays enough information to distinguish it, including at minimum its title and processing state.
31. When two documents have the same title, the interface provides additional distinguishing information such as upload date or filename metadata.
32. The document list uses a deterministic ordering that remains stable across reloads until a defined document event changes that order.
33. The empty Documents view explains that no documents have been uploaded and provides an upload action.
34. A list-loading failure displays a retryable error without replacing the canvas or navigating away from the project.
35. Selecting a ready document from the Documents view opens an inspection state within the existing project workspace.
36. Inspection displays the document title and human-readable document content or a faithful preview sufficient to verify the uploaded source.
37. Inspection clearly identifies whether the displayed content is the ready processed representation used by Nuée, an original-file preview, or both.
38. Inspection does not modify the document, create a context snapshot, or send its content to the model.
39. The user can return from document inspection to the document list without losing the current project or canvas state.
40. Reloading while inspecting a document either restores that document inspection or returns to the Documents list without displaying stale content from a different document.
41. Attempting to inspect a missing, deleted, inaccessible, or cross-project document produces a not-found or access-denied state rather than another document's content.
42. A processing or failed document can expose status details but is not presented as having complete model-ready content.
43. The extracted text preserves the document's readable textual order closely enough that the resulting full-document context remains understandable.
44. Text extraction does not silently replace an unsuccessful result with an empty string while marking the document ready.
45. If the source contains no usable text and the MVP has no supported extraction path for it, processing fails visibly rather than producing a misleading ready document.
46. The extraction pipeline normalizes text encoding so ready document content can be serialized consistently for supported model providers.
47. The extraction pipeline preserves meaningful paragraph or section boundaries where the source format provides them.
48. The extraction pipeline does not need to preserve exact page layout, typography, images, charts, or visual positioning unless required for a configured supported format.
49. Password-protected, encrypted, corrupted, or otherwise inaccessible files fail processing with a clear user-facing state.
50. Processing is idempotent: retrying a processing job does not create another user-visible document record.
51. A stale or duplicate processing job cannot overwrite a newer successful processing result with an older failure.
52. The ready-state transition occurs only after the file reference and processed text are durably associated with the same authorized document record.
53. Discussion Context can retrieve the complete current processed text and frozen display title for a ready document by project-scoped document identifier.
54. The context integration returns the current authorized document record at discussion-confirmation time rather than trusting text copied by the client.
55. The integration never returns partial text for a processing or failed document.
56. The integration exposes the complete processed document as one selectable unit.
57. The integration does not expose pages, paragraphs, passages, highlights, or excerpts as independent selection units.
58. Selecting a document for context does not alter its title, processing state, extracted text, or `updated_at`.
59. Creating a frozen context snapshot does not modify the live document record.
60. Replacing or reprocessing a document after a discussion begins does not change that discussion's frozen document content.
61. Deleting or making a live document inaccessible after a discussion begins does not alter an already persisted frozen snapshot.
62. Document content is never added to a discussion unless the user explicitly selects the ready document through Discussion Context.
63. The application does not automatically summarize a document into durable project knowledge after upload.
64. The application does not automatically create bubbles from document contents.
65. The application does not automatically link a document to bubbles.
66. The application does not automatically include a newly uploaded document in an existing or new discussion.
67. The document library enforces project authorization for upload, list, metadata read, content inspection, processing-status access, and context retrieval.
68. File download or original-file access, when exposed for inspection, uses authorization checks and time-limited or equivalently protected access rather than a permanently public URL.
69. Stored files and extracted text are not exposed through predictable public paths.
70. Processing services receive only the file and metadata required to process the authorized document.
71. Temporary processing files are removed according to a defined cleanup policy after success or failure.
72. Malware or unsafe-file handling follows the application's security policy before a file is made available for inspection or processing.
73. The application does not render active content from uploaded files in a way that can execute macros, scripts, embedded HTML, or external resources.
74. Full document text, filenames, and document titles are not written to product analytics.
75. Analytics may record project identifier, document identifier, configured file-type category, size band, upload outcome, processing outcome, processing duration, inspection action, and context-readiness state.
76. Upload, list, retry, and inspection controls are keyboard accessible and expose meaningful labels and status changes to assistive technologies.
77. A failed upload or processing state does not cause already ready documents in the same project to become unavailable.
78. Multiple documents can process independently, and the state of each list item reflects its own upload and processing result.
79. Project creation can complete even when an optional document upload fails, provided the user is clearly informed that the project exists and the document was not made ready.
80. A document is never reported to the user or to Discussion Context as ready if its stored file and processed text do not correspond to the same uploaded source.

## Scope

### In scope

- **Document upload entry points:** Provide an upload action in the Documents panel and an integration point during project creation. Both entry points use the same validation, persistence, and processing pipeline.
- **Configured format allowlist:** Define a backend-authoritative list of supported document formats for MVP. The UI reflects that list but does not become the source of truth.
- **Upload constraints:** Define and enforce per-file maximum size, any per-request file-count limit, and any project-level guardrail required to protect storage and model-context workflows.
- **Client-side preflight:** Check visible file type, file size, and empty-file conditions early to provide immediate feedback, while repeating all security-relevant validation on the server.
- **Server-side file validation:** Inspect declared MIME type, file signature where practical, size, readability, and supported-format rules. Reject malformed or mismatched files safely.
- **Secure upload transport:** Upload files over authenticated project-scoped requests. Support direct-to-object-storage upload or application-server upload, provided authorization and completion are verified before processing.
- **Idempotent upload creation:** Associate upload attempts with an idempotency key or equivalent stable request identifier so retries do not create accidental duplicate document records.
- **Document persistence model:** Implement the recommended fields `id`, `project_id`, `title`, `file_reference`, `extracted_text`, `created_at`, and `updated_at`, plus the operational metadata required for a reliable pipeline, such as `original_filename`, `mime_type`, `size_bytes`, `processing_status`, `processing_error_code`, and processing timestamps.
- **Processing-status model:** Support at minimum `uploading` or pre-persistence transfer state, `processing`, `ready`, and `failed`. If upload failures occur before record creation, the UI may represent them locally rather than persist an invalid document.
- **Display-title derivation:** Derive an initial title from the sanitized original filename. Preserve duplicate titles without overwriting records. Renaming behavior is excluded unless separately approved.
- **File storage:** Store the original authorized file in private durable storage under a server-generated key. Persist only an opaque reference in the document record.
- **Processing orchestration:** Trigger text extraction only after the complete file is stored and associated with the authorized project document.
- **Text extraction adapters:** Implement a bounded adapter per configured supported format. Convert the source into readable Unicode text while preserving useful ordering and structural separators.
- **No-false-ready validation:** Reject or fail processing when extracted content is absent, corrupt, clearly incomplete because of an unsupported condition, or cannot be associated with the uploaded source.
- **Text normalization:** Normalize encoding, newline representation, invalid characters, and other provider-sensitive formatting without rewriting the source's substantive content.
- **Structured boundary preservation:** Retain paragraph, heading, page-marker, or section boundaries when available and useful. Exact visual reconstruction is not required.
- **Processing idempotency:** Make each processing job safe to retry and protect the document from out-of-order job completion. Use a job generation, version, or equivalent concurrency guard.
- **Failure classification:** Map internal processing errors to stable user-facing categories such as unsupported, corrupted, encrypted, empty, processing unavailable, or unknown failure. Do not expose stack traces or storage details.
- **Retry workflow:** Allow retry for failures classified as recoverable. A retry reuses the same document record and file where safe; it does not create another list item.
- **Cleanup workflow:** Remove incomplete multipart uploads, abandoned temporary files, processing scratch data, and expired access links according to an explicit retention policy.
- **Documents panel content:** Populate the stable right-panel shell from Project Workspace with project-scoped document list, empty state, upload controls, item status, retry controls where applicable, and inspection navigation.
- **List query:** Fetch all authorized document records for the current project using deterministic ordering and explicit loading, empty, ready, processing, and error states.
- **List-item component:** Display title, state, and sufficient distinguishing metadata. Provide visual and accessible status indicators without relying on color alone.
- **Independent-item state:** Update processing results at the item level through polling, subscription, or refresh without blocking inspection or use of other ready documents.
- **Inspection state:** Provide a document detail or preview state within the existing Documents panel area or another explicitly approved workspace surface. Preserve the surrounding canvas and project route.
- **Ready-content inspection:** Display human-readable content from the original file renderer, processed text, or both. Clearly label which representation is used by Nuée for model context.
- **Non-ready inspection:** For processing and failed documents, display status and error information without implying complete content is available.
- **Safe rendering:** Sanitize displayed filenames and text, sandbox any original-file preview, disable active content, prevent macro or script execution, and avoid loading untrusted external resources.
- **Private original-file access:** When the original file is rendered or opened, generate authorized short-lived access or proxy it through an authenticated endpoint.
- **Context-readiness contract:** Expose only ready documents to the Discussion Context selection interface. Provide stable identifiers, frozen display title candidates, full current processed text, and readiness metadata.
- **Confirmation-time retrieval:** Provide a project-scoped backend operation that revalidates ownership and readiness and returns the complete current processed content when Discussion Context confirms creation.
- **Whole-document contract:** Treat each document as one indivisible context source. Do not expose internal chunks as user-selectable items even if chunks are used internally for processing or storage.
- **Context immutability compatibility:** Ensure live-document processing and storage are independent of frozen discussion-context records. Existing snapshots are never dereferenced back to current text.
- **Project-creation integration:** Allow optional uploads during setup without making document success a prerequisite for project creation. Report each upload result separately.
- **Project-workspace integration:** Supply document-list content to the Documents panel view and reuse the shell's stable width, view switching, loading conventions, and project identity.
- **Authorization:** Enforce project ownership or access on every file, record, preview, status, retry, and context-content operation. Do not rely on obscurity of document identifiers.
- **Storage security:** Use private storage, encrypted transport, appropriate encryption at rest, non-predictable keys, and least-privilege service access according to the application's infrastructure standards.
- **Malware and unsafe-content control:** Integrate the minimum file-safety check required by the deployment environment before rendering or further processing. Quarantine or fail suspicious files without exposing them to other users or active renderers.
- **Resource protection:** Add timeouts, memory limits, page or complexity limits where needed, job concurrency controls, and abuse-resistant upload quotas so malformed files cannot exhaust processing services.
- **Observability:** Record upload, processing, queue, retry, extraction, storage, and preview errors with correlation identifiers and non-sensitive metadata sufficient for debugging.
- **Analytics:** Instrument upload source, file category, size band, processing state changes, retry, inspection, and readiness for context without storing raw filenames, titles, extracted content, or original files.
- **Accessibility:** Provide keyboard-operable upload and inspection flows, live announcements for upload and processing changes, textual status labels, focus management, and accessible error association.

### Out of scope

- Document search across titles or contents
- Full-text indexing for user-facing retrieval
- Filtering, tagging, sorting controls, folders, collections, or document groups
- Selecting individual pages, passages, paragraphs, highlights, sections, or search results as discussion context
- Asking questions directly against a document outside a focused discussion
- Automatically selecting documents as context
- Recommending relevant documents
- Automatically including recently uploaded or recently inspected documents in a discussion
- Automatically summarizing documents into durable project knowledge
- Creating bubbles directly from live documents
- Knowledge extraction initiated from a document
- Automatically linking documents to bubbles, discussions, or other documents
- Manual document annotations, comments, highlights, bookmarks, or notes
- Document collaboration, shared editing, review workflows, or access permissions beyond project authorization
- Editing the original document inside Nuée
- Rich document authoring or replacement for Google Docs, Notion, or a file-management product
- Version history, visual diffs, source-control behavior, or rollback for documents
- Detecting that a frozen discussion context contains an older document version
- Comparing live document content with a frozen discussion snapshot
- Refreshing or replacing a document inside an existing discussion
- Automatic OCR unless a configured MVP file format explicitly requires and supports it
- Image, chart, diagram, handwriting, or table understanding beyond text yielded by the supported extraction adapter
- Semantic interpretation of document layout
- Preserving pixel-perfect formatting, fonts, pagination, headers, footers, or visual design in processed text
- Extracting structured entities, claims, citations, references, tables, or metadata beyond what is necessary for readable full-document context
- Web-page import, URL ingestion, browser extension capture, cloud-drive synchronization, email attachments, or third-party storage integrations
- Bulk import of a large existing knowledge base
- Cross-project document reuse or a global personal document library
- Moving or copying documents between projects
- Download, export, or sharing features unless an original-file preview implementation requires a protected open action
- Document renaming unless explicitly added to the MVP contract
- Document replacement while preserving identity unless explicitly added to the MVP contract
- Document deletion until retention, frozen-context, and confirmation semantics are explicitly approved
- User-visible processing chunks or chunk-level context selection
- Vector embeddings, semantic retrieval, RAG ranking, or standalone document question answering
- Background research, citation verification, or source-quality scoring
- Storage billing, user-facing quota management, or administrative analytics dashboards
- Supporting arbitrary file types through best-effort conversion
- Streaming partial extracted text into the inspection view before processing is complete
- Rendering active macros, embedded scripts, remote frames, or external resources from uploaded files

## Implementation Commit Plan

### Agreed MVP implementation baseline

This plan adopts the following defaults for the first implementation:

- Support UTF-8 `.txt`, `.md`, and text-extractable `.pdf` files.
- Reject scanned, encrypted, corrupted, empty, binary-disguised-as-text, or otherwise
  inaccessible documents rather than applying OCR or returning incomplete text.
- Limit uploads to 10 MiB per file, one file per HTTP request, 25 documents per project, and
  100 MiB of original files per project.
- Limit PDF processing to 200 pages, bound processing time and memory, and fail rather than
  truncate a document that exceeds an extraction-complexity limit.
- Inspect the processed-text representation used for discussion context. Do not expose or
  render original files in the MVP.
- Retain originals in private persistent storage under opaque server-generated keys.
- Order document lists by `created_at DESC, id ASC`.
- Use durable SQLite-backed processing leases, at most two concurrent jobs, and at most three
  automatic attempts for transient failures.
- Require malware scanning in production before extraction; make scanner unavailability a
  recoverable processing failure.
- Retry failed processing against the same document record and original file. Keep ready-document
  replacement, renaming, deletion, and version history out of scope.

### Security prerequisite

The current application is an unauthenticated trusted single-user system with no project owner
or membership model. Project-scoped repository queries can enforce document isolation, but nested
URLs alone cannot prevent access when another project identifier is known.

Before claiming success criterion 67 for untrusted or multi-user deployment, implement and test
one global authentication boundary plus project ownership or membership authorization. The
document implementation must consume that project-access capability for upload, list, metadata
read, inspection, status, retry, and context retrieval. If the MVP remains a trusted single-user
deployment, record that boundary explicitly and do not describe project scoping as user
authorization.

### Ordered commits

1. `feat(shared): define document library contracts`
   - Add shared document summary/detail contracts, processing states, upload policy, format
     categories, stable processing-error codes, and upload/retry responses.
   - Replace the scaffolded `pending` document state with persisted `processing`; keep
     `transferring` as a frontend-only state.
   - Preserve the existing frozen whole-document context contract and public import paths.

2. `feat(backend): persist documents and processing leases`
   - Add the document migration, repository port, and SQLite implementation.
   - Persist stable and project identifiers, title, original filename, opaque file reference,
     detected format and MIME type, byte size, source hash, extracted text, processed-source
     hash, timestamps, state, failure code, idempotency metadata, retry generation, attempt count,
     and lease data.
   - Reinforce project ownership, deterministic ordering, idempotency uniqueness, and the
     no-false-ready invariant with SQLite constraints and repository tests.

3. `feat(backend): validate and store document uploads privately`
   - Add typed document configuration, title derivation, filename normalization, content-aware
     file validation, project quotas, source hashing, and private atomic file storage.
   - Validate declared MIME type, extension, size, readability, and bytes independently.
     Validate the PDF signature and parser result; validate text and Markdown as non-binary
     decodable UTF-8.
   - Use a server-generated storage key, never the submitted filename or path.
   - Make upload creation idempotent by project, request key, and request fingerprint; allow
     intentional duplicate files through distinct request keys.
   - Remove an orphaned file if record creation fails and leave no document record for rejected
     or incomplete multipart requests.

4. `feat(backend): process documents with safe extraction adapters`
   - Add the production malware-scanner adapter and deterministic test implementation.
   - Add TXT, Markdown, and PDF extraction adapters plus deterministic Unicode, newline, and
     paragraph-boundary normalization.
   - Run bounded extraction work with memory, time, page, and output-complexity limits.
   - Add durable job claiming, expired-lease recovery, bounded transient retries, and
     generation-guarded completion so stale work cannot overwrite a newer result.
   - Persist extracted text and the matching processed-source hash before the conditional
     ready transition.
   - Classify unsafe, encrypted, corrupted, no-text, too-complex, storage-unavailable,
     scanner-unavailable, processing-unavailable, and unknown failures without exposing internal
     errors.
   - Remove all temporary or scratch data in both success and failure paths.

5. `feat(backend): expose document APIs and discussion context`
   - Add `GET /document-upload-policy`.
   - Add upload, list, detail, and retry routes under
     `/projects/:projectId/documents`.
   - Return metadata-only list records and expose extracted text only from the authorized detail
     operation for ready documents.
   - Return not-found or access-denied results for cross-project identifiers without leaking the
     other record.
   - Register `DocumentsModule` and make its project-scoped, readiness-checking service the
     required `DocumentContextSourceReader`.
   - At discussion confirmation, retrieve current title and complete processed text from the
     server, verify readiness and source integrity, and copy them into the immutable frozen
     context without mutating the live document.
   - Do not add an original-file download or preview route.

6. `feat(frontend): add document API and library state`
   - Add `api/documents.ts` and preserve the public API barrel.
   - Runtime-validate the upload policy, list, detail, upload, and retry responses.
   - Add reusable client preflight for configured extension, visible MIME, size, empty-file, and
     readability checks while treating the server as authoritative.
   - Add a document-library hook with explicit loading, error, and ready states; local transfer
     rows; stable idempotency keys across retries; abort and stale-response protection; and
     polling only while processing documents exist.
   - Merge per-item results without making ready documents unavailable because another upload or
     processing attempt fails.

7. `feat(frontend): build document upload and inspection panel`
   - Replace the Documents placeholder with upload, loading, empty, list-error/retry, transfer,
     processing, ready, failed, and recoverable-retry states.
   - Allow multiple files to be chosen and upload each through an independent single-file
     request.
   - Display the server-configured formats and maximum size.
   - Display title, textual status, original filename, size, and precise upload date so duplicate
     titles remain distinguishable.
   - Inspect ready processed text inside the Documents panel and label it as the representation
     Nuée uses for discussion context.
   - Keep processing and failed detail states from implying that complete content is available.
   - Render filenames, titles, and extracted text only as escaped React text; do not use active
     HTML, an iframe, an original-file renderer, or external resources.
   - Add keyboard-operable actions, focus restoration, associated errors, textual status
     indicators, and live status announcements.

8. `feat(frontend): connect documents to workspace context selection`
   - Let the workspace compose the document-library hook, Documents panel, and the existing
     whole-document selection controller.
   - Make the empty-canvas upload action open the Documents panel and file picker.
   - Supply only current same-project metadata to the selection UI and permit selection only
     while a document is ready.
   - Send identifiers rather than text when starting a discussion so confirmation-time server
     retrieval remains authoritative.
   - Preserve the current project, canvas state, and tentative mixed bubble/document selections
     while switching panels or inspecting a document.

9. `feat(frontend): upload optional documents after project creation`
   - Add the same policy-backed multi-file selector to project creation.
   - Create the project before starting optional uploads.
   - Hand selected files to the created project's document library, navigate to the project, open
     the Documents panel, and process each upload independently.
   - Keep the created project usable when one or every optional upload fails, and show the
     affected file's failure and retry state.

10. `feat(documents): add privacy-safe telemetry`
    - Add typed analytics for upload source, format category, size band, upload outcome,
      processing state and duration, retry, inspection, and context readiness.
    - Restrict backend document logs to project, document, correlation, format, size-band,
      duration, retry-count, and stable outcome/error identifiers.
    - Add tests that reject analytics and ordinary log payloads containing filenames, titles,
      extracted text, or original file contents.

11. `test(documents): cover upload, processing, isolation, and snapshots`
    - Add fixture-based unit, repository, frontend integration, and backend HTTP journeys for
      valid TXT, Markdown, and PDF files; scanned/no-text, encrypted, corrupted, unsafe, binary,
      empty, oversized, and type-mismatched files; duplicate filenames; idempotent transport
      retries; processing retry and stale completion; cancellation/cleanup; independent
      processing results; reload persistence; deterministic ordering; and project isolation.
    - Exercise actual ready-document discussion creation and verify that later live-record
      changes or inaccessibility cannot alter the persisted frozen title or content.
    - Cover optional project-creation upload failure, safe rendering of malicious filenames,
      accessibility semantics, and analytics privacy.

12. `docs(documents): record storage and processing operations`
    - Update `ARCHITECTURE_ANALYSIS.md` and `BACKEND_ARCHITECTURE_ANALYSIS.md`.
    - Keep `AGENTS.md` and `CLAUDE.md` synchronized when adding document feature ownership and
      the durable in-process job boundary.
    - Document persistent private storage, encrypted-volume and HTTPS expectations, malware
      scanner provisioning, backups covering SQLite and original files, lease recovery, cleanup
      policy, supported formats, limits, and the chosen authentication boundary.

### Success-criteria traceability

| Success criteria | Primary commits |
| --- | --- |
| 1 | 9, 11 |
| 2 | 7–8 |
| 3–15 | 2–5, 7, 11 |
| 16–24 | 4, 6–7, 11 |
| 25–34 | 2, 5–7, 11 |
| 35–42 | 5, 7–8, 11 |
| 43–52 | 2, 4, 11 |
| 53–62 | 1, 5, 8, 11 |
| 63–66 | 5, 8, 11 |
| 67 | Security prerequisite, then 5 and 11 |
| 68 | Satisfied by not exposing original-file access |
| 69–73 | 3–5, 7, 12 |
| 74–76 | 7, 9–10 |
| 77–80 | 2, 4, 6–7, 9, 11 |

### Dependency commands

Do not install dependencies automatically. Before implementing PDF extraction and typed
multipart handling, the contributor should run:

```bash
npm install pdfjs-dist --workspace backend
npm install --save-dev @types/multer --workspace backend
```

### Verification

Each backend boundary commit must run backend build, lint, unit tests, and the relevant backend
HTTP journeys. Each frontend commit must run frontend build, lint, and unit tests. Before the
series is handed off:

```bash
npm run build
npm run lint
npm test
npm run test:e2e
```

Manual UI QA remains separate and covers multiple-file selection, project-creation handoff,
status transitions, duplicate filenames, failure and retry, reload, inspection and back
navigation, and whole-document discussion-context selection.

The risk discussion below is retained as design rationale and future scope. Where it conflicts
with the agreed MVP implementation baseline above, the baseline governs the first implementation.

## Risks / Open Questions

- **Supported formats:** The source MVP requires uploaded documents but does not specify an exact format list. A broad list increases user value but multiplies parsing, rendering, and security paths. The current leaning is to launch with a small explicit allowlist of reliably extractable text-based formats and add formats only when both inspection and model-ready extraction can be tested end to end.
- **PDF support and OCR:** PDFs are a likely user expectation, but text PDFs, scanned PDFs, mixed-layout reports, and password-protected files behave differently. OCR adds cost, latency, language limitations, and accuracy risk. The current leaning is to support text-extractable PDFs first and fail scanned or inaccessible PDFs clearly rather than silently return poor text.
- **Inspection representation:** Showing the original document is faithful but requires format-specific rendering and secure file access; showing processed text is simpler and reveals exactly what the model will receive but may lose visual context. The current leaning is to prioritize processed-text inspection for trust and optionally add a sandboxed original preview where the format renderer is safe and inexpensive.
- **Right-panel width:** The stable panel defined by Project Workspace may be too narrow for long-form document inspection. Expanding it would violate the current shell contract, while forcing all reading into a narrow panel may be unusable. The team should decide whether document inspection uses an internal full-height detail state, an approved larger overlay, or a separate safe viewer without changing the canvas-first navigation model.
- **Document deletion:** The source MVP does not explicitly require deleting documents. Adding deletion improves control and privacy but introduces confirmation, storage cleanup, in-flight processing, and frozen-context semantics. The current leaning is to keep deletion out of scope until a shared retention policy is defined; frozen discussion snapshots must remain unaffected whenever deletion is later added.
- **Document renaming:** The data model includes a title, but the source requirements do not say that users can rename it. Filename-derived titles are simple but may be poor labels. The current leaning is deterministic filename-derived titles for MVP and to defer renaming unless usability testing shows inspection and selection become confusing.
- **Document replacement:** Users may upload a corrected version under the same name. Treating it as a new record is transparent but creates duplicates; replacing the existing record raises versioning and stale-context questions. The current leaning is always create a new document record in MVP and let frozen discussions retain the older selected source.
- **Duplicate detection:** Two uploads may be byte-identical or text-identical. Preventing duplicates can save storage but risks blocking intentional copies and requires hashing and UX. The current leaning is to allow duplicates, distinguish them by metadata, and defer warnings or deduplication.
- **Default list ordering:** Ordering by upload time is predictable; ordering by most recent use may surface relevant sources but creates hidden movement. The current leaning is newest upload first, with deterministic tie-breaking, until search or sorting exists.
- **Upload during project creation:** Processing may outlast the setup flow. Blocking project creation would make optional documents feel mandatory; navigating immediately may make status easy to miss. The current leaning is to create the project independently, show each upload in the Documents panel, and continue processing there.
- **Processing architecture:** Synchronous processing simplifies state but risks request timeouts for larger files. Asynchronous jobs are more reliable but require queues, status refresh, idempotency, and cleanup. The current leaning is asynchronous processing behind a simple four-state UI.
- **Ready-state definition:** A parser may return some text from a partially corrupted file. Marking it ready risks silently incomplete context, while rejecting any anomaly may block usable documents. Each format adapter needs a conservative completeness policy and should fail when it cannot establish that the output is meaningfully usable.
- **Context size versus upload success:** A document can be successfully processed yet be too large for the selected discussion model. Marking it failed would conflate storage readiness with context compatibility. The current leaning is for Document Library to mark processing readiness independently; Discussion Context performs model-specific size validation at confirmation time.
- **Text normalization versus source fidelity:** Removing repeated headers, page numbers, or broken line wraps can improve model comprehension but changes the literal source. Aggressive cleanup may remove meaningful content. The current leaning is minimal deterministic normalization, with any format-specific cleanup covered by fixtures and regression tests.
- **Tables and multi-column layouts:** Plain extraction may scramble reading order in reports and specifications. Full layout-aware parsing adds considerable complexity. The MVP must either constrain supported documents or communicate that processed text is the authoritative model representation; unsupported layouts should not be marked confidently ready.
- **Images and charts:** Important information may exist only in diagrams or charts. Ignoring it can make a document appear fully usable when it is not. The current leaning is to define readiness as text readiness, label the processed representation clearly, and avoid claiming that non-text content has been understood.
- **Original-file retention:** Keeping originals enables later reprocessing and faithful inspection but increases storage and privacy exposure. Discarding originals after text extraction reduces exposure but makes auditing and future parser improvements difficult. The current leaning is to retain originals privately for the life of the document, subject to the future deletion and retention policy.
- **Processing-provider privacy:** External parsing, OCR, malware scanning, or storage services may receive sensitive files. The product must document and technically restrict provider access, retention, and regional handling before supporting confidential use cases.
- **Unsafe files:** Even formats considered documents may contain macros, scripts, embedded files, malicious compression, or parser exploits. The implementation needs sandboxing, dependency patching, resource limits, and a clear quarantine path; MIME validation alone is insufficient.
- **Filename privacy:** Filenames can contain client names, medical details, or other sensitive information. They are useful in the UI but should never be included in analytics or logs beyond sanitized operational contexts.
- **Extracted-text privacy:** Processed text is a second durable copy of the document. Encryption, project authorization, backups, deletion propagation, and support tooling must cover both the original file and extracted representation.
- **Error recovery:** A parser outage may fail many otherwise valid files. Permanent failure messaging would make retry burdensome; automatic retry could consume resources indefinitely. The current leaning is bounded automatic retries for transient failures plus an explicit user retry for exhausted jobs.
- **Processing cancellation:** Users may want to cancel a large upload or parser job. Cancellation is useful but complicates multipart uploads and job orchestration. The MVP can omit explicit cancellation if limits keep jobs bounded, but abandoned resources still need cleanup.
- **Project-level limits:** The target is a small new project, but without file-count or storage guardrails one project could become a large legacy repository. The current leaning is to enforce conservative backend limits even if the MVP does not expose a detailed quota-management interface.
- **Accessibility of file upload:** Drag-and-drop alone is insufficient. The implementation must include a standard file-picker action, keyboard operation, textual progress, and status announcements.
- **Observability versus confidentiality:** Parsing failures require enough metadata to debug, but raw extracted text and filenames should not enter ordinary logs. Correlation identifiers, parser version, format category, size, and error codes should be sufficient for most operations.

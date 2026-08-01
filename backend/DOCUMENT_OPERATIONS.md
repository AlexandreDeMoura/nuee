# Document storage and processing operations

This runbook defines the production boundary for Nuée's MVP Document Library. It covers the
SQLite-backed document records, private original files, and the in-process processing coordinator.
It does not turn the current API into a multi-user service or add original-file download, document
replacement, or document deletion.

## Supported deployment boundary

Nuée currently has no application authentication, user identity, project owner, or membership
model. Project-scoped routes and repository queries prevent accidental cross-project document
mixing, but they are not authorization.

The supported MVP deployment is therefore trusted single-user access. Keep the backend on a
private network or behind trusted platform access control, expose it only through an HTTPS ingress,
and restrict CORS to the exact frontend origin with `FRONTEND_URL`. Do not expose it to untrusted
or multi-user traffic. That requires a global authentication boundary, project ownership or
membership persistence, and authorization on upload, list, detail, status, retry, and context reads.

## Storage topology

Configure both paths explicitly in production and place them on persistent encrypted local storage:

- `PROJECT_DATABASE_PATH` is the SQLite database containing document metadata, extracted text,
  source hashes, idempotency keys, processing generations, attempts, and leases.
- `DOCUMENT_PRIVATE_STORAGE_PATH` is the private root containing original files. Originals are
  stored as `originals/<two-character bucket>/<server UUID>` with file mode `0600`; directories use
  mode `0700`. Submitted filenames never form a filesystem path.

The defaults under `backend/data/` are for local development. They are Git-ignored and are unsafe
on an ephemeral production filesystem. The SQLite database and private-document root are one
durability unit: losing either makes a ready record incomplete.

Do not serve the private root from a static server or mount it into the frontend. The MVP exposes
processed text for ready document inspection and does not expose original-file URLs or download
routes.

## Formats and limits

The backend-authoritative allowlist is:

| Format     | Extensions | Accepted declared MIME types                     | Processing rule                                      |
| ---------- | ---------- | ------------------------------------------------ | ---------------------------------------------------- |
| Plain text | `.txt`     | `text/plain`                                     | Strictly decodable UTF-8, non-binary, non-empty text |
| Markdown   | `.md`      | `text/markdown`, `text/x-markdown`, `text/plain` | Strictly decodable UTF-8, non-binary, non-empty text |
| PDF        | `.pdf`     | `application/pdf`                                | Valid, unencrypted, text-extractable PDF; no OCR     |

Defaults and configurable bounds are:

| Setting                         |    Default | Environment variable                 |
| ------------------------------- | ---------: | ------------------------------------ |
| Maximum original size           |     10 MiB | `DOCUMENT_MAX_FILE_SIZE_BYTES`       |
| Files per HTTP request          |          1 | Fixed for the MVP                    |
| Documents per project           |         25 | `DOCUMENT_MAX_DOCUMENTS_PER_PROJECT` |
| Original storage per project    |    100 MiB | `DOCUMENT_MAX_PROJECT_STORAGE_BYTES` |
| PDF pages                       |        200 | `DOCUMENT_MAX_PDF_PAGES`             |
| Normalized extracted-text bytes |     16 MiB | `DOCUMENT_MAX_EXTRACTED_TEXT_BYTES`  |
| Processing deadline             | 30 seconds | `DOCUMENT_PROCESSING_TIMEOUT_MS`     |
| Processing lease                | 45 seconds | `DOCUMENT_PROCESSING_LEASE_MS`       |
| Concurrent in-process workers   |          2 | `DOCUMENT_PROCESSING_CONCURRENCY`    |
| Automatic attempts              |          3 | `DOCUMENT_PROCESSING_MAX_ATTEMPTS`   |

Configuration validation requires the project storage limit to be at least the per-file limit,
the processing lease to exceed the processing deadline, and the scanner timeout to be shorter than
the processing deadline. A document that exceeds a page, time, or extracted-output bound fails; the
processor does not truncate it or silently produce partial ready content.

## Malware scanner provisioning

Production uses ClamAV's `INSTREAM` protocol over TCP. Provision a reachable ClamAV daemon and set:

- `DOCUMENT_MALWARE_SCANNER_HOST` (default `127.0.0.1`)
- `DOCUMENT_MALWARE_SCANNER_PORT` (default `3310`)
- `DOCUMENT_MALWARE_SCANNER_TIMEOUT_MS` (default `10000`)

Keep signature updates enabled, restrict the scanner port to the application network, and include
scanner health in deployment readiness. Non-production environments intentionally use a
deterministic scanner for repeatable development and tests; that adapter is not a production
security control.

Scanning happens after the stored source hash is verified and before extraction. A detected unsafe
file fails permanently and is never ready. Scanner unavailability is a recoverable failure: the
coordinator retries within the configured automatic-attempt bound, then exposes a retryable failed
state for an explicit retry. Do not bypass the scanner to clear a queue.

## Processing and lease recovery

An accepted upload is atomically published to private storage and then recorded in SQLite as
`processing`. The coordinator starts with the application, polls recoverable work at least every
five seconds, and claims it with a SQLite lease. It runs at most the configured concurrency inside
the single application process.

Each attempt verifies the original SHA-256 hash, scans the bytes, extracts and normalizes text, and
conditionally completes the same record. `ready` is allowed only when non-empty extracted text and
the processed-source hash match the original source hash. A processing generation plus lease owner
guards completion, so stale or duplicate work cannot overwrite a newer ready or failed result.

When Nest's module-shutdown lifecycle runs, active work is aborted and its lease is released. The
current bootstrap does not enable operating-system signal hooks, so a deployment stop or crash may
instead leave the lease durable until expiration; the next application process reclaims it
automatically. Keep one application instance while SQLite is the write store. If repeated expired
leases accumulate, check storage latency, scanner reachability, extraction limits, and process
termination before manually retrying records. Do not edit processing columns directly.

## Cleanup and retention

Multipart uploads are held in memory and create no durable record before transfer and validation
complete. Private storage writes a `0600` staging file, flushes it, atomically hard-links it into
`originals/`, and removes the staging name. Failed writes remove their staging file best-effort. If
SQLite record creation fails after storage succeeds, the service removes the published original;
a cleanup failure is surfaced instead of being hidden.

Extraction uses memory and parser-owned resources; it does not persist page images, chunks, access
links, or processing scratch files. Source buffers are cleared after an attempt. A hard process or
host failure can still leave a staging file. During a stopped maintenance window, files under
`.staging/` may be removed; never use that cleanup rule under `originals/`.

The MVP has no document-delete, replacement, or automatic retention workflow. Retain each original
and its live record together for the life of the project. Do not manually remove an original whose
record remains in SQLite. Define product deletion and retention semantics before adding automated
purges; immutable frozen discussion snapshots are separate records and must not be altered by a
future live-document deletion.

## Backup and restore

Backups must contain a mutually consistent pair:

1. the SQLite database at `PROJECT_DATABASE_PATH`; and
2. the complete `originals/` tree under `DOCUMENT_PRIVATE_STORAGE_PATH`.

Use an encrypted backup destination with access no broader than the application volume. Because the
application writes the database and filesystem as one logical unit, take backups with the single
application process stopped, or use a storage snapshot mechanism that guarantees both paths are
captured at the same point. Do not include `.staging/` as authoritative data. Retain and rotate
backups according to the deployment's data-retention policy.

Restore both members from the same backup while the application is stopped, preserve private file
permissions, and start only one application instance. Migrations run on startup. Validate the
restored project/document counts, inspect a sample of ready processed-text records, and confirm new
upload processing through ClamAV before returning traffic. A database-only or originals-only
restore is incomplete and must not be presented as healthy.

## Release checklist

- Both data paths resolve to the same persistent, encrypted backup domain and are not web-served.
- HTTPS terminates at the trusted ingress; backend reachability is limited to the trusted
  single-user boundary.
- `FRONTEND_URL` is the exact deployed frontend origin.
- ClamAV is reachable only from trusted infrastructure, has current signatures, and passes a clean
  and known-test detection check.
- One application instance is configured while SQLite owns writes.
- Backup and paired restore have been exercised in an isolated environment.
- Document logs and analytics contain identifiers, categories, size bands, timings, attempts, and
  stable outcomes only—not filenames, titles, original bytes, or extracted text.

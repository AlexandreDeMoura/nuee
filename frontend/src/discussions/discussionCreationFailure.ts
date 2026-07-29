import { ApiError } from '../api';

export type DiscussionCreationSourceKind = 'bubble' | 'document';

export type DiscussionCreationSourceIssueReason =
  | 'missing'
  | 'inaccessible'
  | 'cross_project'
  | 'pending'
  | 'failed';

export interface DiscussionCreationSourceIssue {
  reason: DiscussionCreationSourceIssueReason;
  sourceId: string;
  sourceKind: DiscussionCreationSourceKind;
}

export interface DiscussionCreationFailure {
  code: string | null;
  message: string;
  sourceIssues: readonly DiscussionCreationSourceIssue[];
}

const sourceIssueReasons = new Set<DiscussionCreationSourceIssueReason>([
  'missing',
  'inaccessible',
  'cross_project',
  'pending',
  'failed',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSourceIssues(
  value: unknown,
): DiscussionCreationSourceIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const issues: DiscussionCreationSourceIssue[] = [];
  const seenSources = new Set<string>();

  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      (candidate.source_kind !== 'bubble' &&
        candidate.source_kind !== 'document') ||
      typeof candidate.source_id !== 'string' ||
      candidate.source_id.trim().length === 0 ||
      typeof candidate.reason !== 'string' ||
      !sourceIssueReasons.has(
        candidate.reason as DiscussionCreationSourceIssueReason,
      )
    ) {
      continue;
    }

    const sourceId = candidate.source_id.trim();
    const sourceKey = `${candidate.source_kind}:${sourceId}`;

    if (seenSources.has(sourceKey)) {
      continue;
    }

    seenSources.add(sourceKey);
    issues.push({
      reason: candidate.reason as DiscussionCreationSourceIssueReason,
      sourceId,
      sourceKind: candidate.source_kind,
    });
  }

  return issues;
}

export function normalizeDiscussionCreationFailure(
  error: unknown,
): DiscussionCreationFailure {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : 'The discussion could not be started.';
  const code = error instanceof ApiError ? (error.code ?? null) : null;
  const sourceIssues =
    error instanceof ApiError &&
    error.code === 'DISCUSSION_CONTEXT_SOURCE_INVALID'
      ? normalizeSourceIssues(error.body.source_errors)
      : [];

  return {
    code,
    message,
    sourceIssues,
  };
}

export function discussionCreationSourceIssueMessage(
  issue: DiscussionCreationSourceIssue,
): string {
  switch (issue.reason) {
    case 'missing':
      return 'This source was deleted or is no longer available.';
    case 'inaccessible':
      return 'This source is no longer accessible.';
    case 'cross_project':
      return 'This source does not belong to this project.';
    case 'pending':
      return 'This document is still processing.';
    case 'failed':
      return 'This document could not be processed.';
  }
}

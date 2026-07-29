import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api';
import {
  discussionCreationSourceIssueMessage,
  normalizeDiscussionCreationFailure,
} from '../src/discussions';

describe('discussion creation failures', () => {
  it('normalizes valid source issues without trusting malformed server data', () => {
    const failure = normalizeDiscussionCreationFailure(
      new ApiError(422, {
        code: 'DISCUSSION_CONTEXT_SOURCE_INVALID',
        message: 'Review the affected sources.',
        source_errors: [
          {
            source_kind: 'bubble',
            source_id: ' bubble-1 ',
            reason: 'missing',
          },
          {
            source_kind: 'bubble',
            source_id: 'bubble-1',
            reason: 'failed',
          },
          {
            source_kind: 'document',
            source_id: 'document-1',
            reason: 'pending',
          },
          {
            source_kind: 'project_description',
            source_id: 'project-1',
            reason: 'missing',
          },
          {
            source_kind: 'document',
            source_id: '',
            reason: 'failed',
          },
        ],
      }),
    );

    expect(failure).toEqual({
      code: 'DISCUSSION_CONTEXT_SOURCE_INVALID',
      message: 'Review the affected sources.',
      sourceIssues: [
        {
          reason: 'missing',
          sourceId: 'bubble-1',
          sourceKind: 'bubble',
        },
        {
          reason: 'pending',
          sourceId: 'document-1',
          sourceKind: 'document',
        },
      ],
    });
    expect(
      discussionCreationSourceIssueMessage(failure.sourceIssues[0]),
    ).toBe('This source was deleted or is no longer available.');
    expect(
      discussionCreationSourceIssueMessage(failure.sourceIssues[1]),
    ).toBe('This document is still processing.');
  });

  it('keeps size and snapshot failures actionable without inventing source issues', () => {
    expect(
      normalizeDiscussionCreationFailure(
        new ApiError(413, {
          code: 'DISCUSSION_CONTEXT_TOO_LARGE',
          message: 'Remove selected context or start a new discussion.',
          estimated_input_tokens: 120_000,
        }),
      ),
    ).toEqual({
      code: 'DISCUSSION_CONTEXT_TOO_LARGE',
      message: 'Remove selected context or start a new discussion.',
      sourceIssues: [],
    });

    expect(
      normalizeDiscussionCreationFailure(
        new ApiError(503, {
          code: 'DISCUSSION_SNAPSHOT_PERSISTENCE_FAILED',
          message: 'Retry creation with the same idempotency key.',
        }),
      ),
    ).toEqual({
      code: 'DISCUSSION_SNAPSHOT_PERSISTENCE_FAILED',
      message: 'Retry creation with the same idempotency key.',
      sourceIssues: [],
    });
  });
});

export {
  assertDiscussionDetails,
  isDiscussionDetails,
  isFrozenContextV1,
} from '../api/discussionResponse';

export const TEMPORARY_DISCUSSION_TITLE = 'New discussion';

export type DiscussionGenerationFailureCode =
  | 'AI_GENERATION_FAILED'
  | 'AI_GENERATION_TIMEOUT';

export interface RecoveredDiscussionTurn {
  failureCode: DiscussionGenerationFailureCode;
  requestId: string;
  webSearch: boolean;
}

export function isDiscussionGenerationFailureCode(
  value: unknown,
): value is DiscussionGenerationFailureCode {
  return (
    value === 'AI_GENERATION_FAILED' || value === 'AI_GENERATION_TIMEOUT'
  );
}

export function isTemporaryDiscussionTitle(title: string): boolean {
  return title === TEMPORARY_DISCUSSION_TITLE;
}

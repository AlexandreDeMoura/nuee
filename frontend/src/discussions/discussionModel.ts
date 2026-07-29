export {
  assertDiscussionDetails,
  isDiscussionDetails,
  isFrozenContextV1,
} from '../api/discussionResponse';

export const TEMPORARY_DISCUSSION_TITLE = 'New discussion';

export function isTemporaryDiscussionTitle(title: string): boolean {
  return title === TEMPORARY_DISCUSSION_TITLE;
}

/**
 * Transitional helper retained for compatibility with the historical opaque
 * request contract. New discussion creation submits source identifiers and
 * lets the server build the frozen package.
 */
export function buildDefaultFrozenContext(
  projectDescription: string,
): Record<string, unknown> {
  return {
    project_description: {
      content: projectDescription,
    },
  };
}

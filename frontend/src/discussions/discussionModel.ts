export {
  assertDiscussionDetails,
  isDiscussionDetails,
  isFrozenContextV1,
} from '../api/discussionResponse';

export const TEMPORARY_DISCUSSION_TITLE = 'New discussion';

export function isTemporaryDiscussionTitle(title: string): boolean {
  return title === TEMPORARY_DISCUSSION_TITLE;
}

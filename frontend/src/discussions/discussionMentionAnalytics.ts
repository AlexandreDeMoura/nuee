import {
  trackAnalytics,
  type AnalyticsClient,
  type AnalyticsEventProperties,
} from '../analytics';

export type DiscussionMentionAnalyticsEventName =
  | Extract<
      keyof AnalyticsEventProperties,
      `discussion_mention_${string}`
    >
  | 'discussion_context_sources_frozen';

const allowedKeys = {
  discussion_mention_list_opened: [
    'project_id',
    'result_count',
    'bubble_count',
    'document_count',
  ],
  discussion_mention_source_attached: [
    'project_id',
    'source_id',
    'source_kind',
    'input_method',
  ],
  discussion_mention_source_removed: [
    'project_id',
    'source_id',
    'source_kind',
    'removal_method',
  ],
  discussion_mention_empty_state_displayed: ['project_id'],
  discussion_mention_empty_state_cta_activated: [
    'project_id',
    'action',
  ],
  discussion_mention_not_ready_attach_attempted: [
    'project_id',
    'source_id',
    'source_kind',
    'input_method',
    'readiness_reason',
  ],
  discussion_context_sources_frozen: [
    'project_id',
    'discussion_id',
    'bubble_count',
    'document_count',
    'attached_source_count',
    'frozen_source_count',
  ],
} as const satisfies Record<
  DiscussionMentionAnalyticsEventName,
  readonly string[]
>;

/**
 * Runtime allowlist for the mention-flow telemetry boundary. Source titles,
 * draft text, and frozen content are deliberately not accepted here.
 */
export function assertPrivacySafeDiscussionMentionAnalytics(
  event: DiscussionMentionAnalyticsEventName,
  properties: unknown,
): void {
  if (
    !properties ||
    typeof properties !== 'object' ||
    Array.isArray(properties)
  ) {
    throw new TypeError('Discussion mention analytics properties must be an object.');
  }

  const actual = Object.keys(properties).sort();
  const expected = [...allowedKeys[event]].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(
      `Discussion mention analytics event ${event} has unsafe properties.`,
    );
  }

  for (const value of Object.values(properties)) {
    const safeValue =
      typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value) && value >= 0);

    if (!safeValue) {
      throw new TypeError(
        `Discussion mention analytics event ${event} has unsafe values.`,
      );
    }
  }
}

export function trackDiscussionMentionAnalytics<
  EventName extends DiscussionMentionAnalyticsEventName,
>(
  analyticsClient: AnalyticsClient,
  event: EventName,
  properties: AnalyticsEventProperties[EventName],
): void {
  assertPrivacySafeDiscussionMentionAnalytics(event, properties);
  trackAnalytics(analyticsClient, event, properties);
}

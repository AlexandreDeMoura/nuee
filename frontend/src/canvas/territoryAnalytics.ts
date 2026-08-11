import { ApiError } from '../api';
import {
  trackAnalytics,
  type AnalyticsClient,
  type AnalyticsEventProperties,
} from '../analytics';

export type TerritoryAnalyticsEventName =
  | Extract<keyof AnalyticsEventProperties, `territory_${string}`>
  | 'bubble_reader_opened_from_canvas';

export type TerritoryRecomposeFailureReason =
  AnalyticsEventProperties['territory_recompose_failed']['reason'];

const recomposeFailureReasons = new Set<TerritoryRecomposeFailureReason>([
  'provider',
  'timeout',
  'invalid_request',
  'invalid_response',
  'invalid_output',
  'persistence',
]);

const allowedKeys = {
  territory_recompose_requested: [
    'project_id',
    'bubble_count',
    'territory_count',
  ],
  territory_recompose_completed: [
    'project_id',
    'bubble_count',
    'territory_count',
  ],
  territory_recompose_failed: [
    'project_id',
    'bubble_count',
    'territory_count',
    'reason',
  ],
  territory_visible_count_changed: [
    'project_id',
    'territory_id',
    'bubble_count',
    'previous_visible_count',
    'visible_count',
  ],
  territory_scroll_unlocked: [
    'project_id',
    'territory_id',
    'bubble_count',
    'hidden_bubble_count',
  ],
  bubble_reader_opened_from_canvas: [
    'project_id',
    'bubble_id',
    'territory_id',
  ],
  territory_moved: ['project_id', 'territory_id'],
  territory_compact_layout_applied: [
    'project_id',
    'moved_territory_count',
  ],
} as const satisfies Record<TerritoryAnalyticsEventName, readonly string[]>;

/**
 * Runtime allowlist for territory telemetry. Canvas copy and spatial
 * coordinates are deliberately excluded even if a caller bypasses TypeScript.
 */
export function assertPrivacySafeTerritoryAnalytics(
  event: TerritoryAnalyticsEventName,
  properties: unknown,
): void {
  if (
    !properties ||
    typeof properties !== 'object' ||
    Array.isArray(properties)
  ) {
    throw new TypeError('Territory analytics properties must be an object.');
  }

  const actual = Object.keys(properties).sort();
  const expected = [...allowedKeys[event]].sort();

  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(
      `Territory analytics event ${event} has unsafe properties.`,
    );
  }

  for (const value of Object.values(properties)) {
    const safeValue =
      typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value) && value >= 0);

    if (!safeValue) {
      throw new TypeError(
        `Territory analytics event ${event} has unsafe values.`,
      );
    }
  }
}

export function trackTerritoryAnalytics<
  EventName extends TerritoryAnalyticsEventName,
>(
  analyticsClient: AnalyticsClient,
  event: EventName,
  properties: AnalyticsEventProperties[EventName],
): void {
  assertPrivacySafeTerritoryAnalytics(event, properties);
  trackAnalytics(analyticsClient, event, properties);
}

export function territoryRecomposeFailureReason(
  error: unknown,
): TerritoryRecomposeFailureReason {
  if (!(error instanceof ApiError)) {
    return 'request_failed';
  }

  if (error.code === 'TERRITORY_RECOMPOSE_SOURCE_TOO_LARGE') {
    return 'source_too_large';
  }

  const reason = error.body.reason;

  return typeof reason === 'string' &&
    recomposeFailureReasons.has(reason as TerritoryRecomposeFailureReason)
    ? (reason as TerritoryRecomposeFailureReason)
    : 'request_failed';
}

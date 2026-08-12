import {
  trackAnalytics,
  type AnalyticsClient,
  type AnalyticsEventProperties,
} from '../analytics';

export type TerritoryAnalyticsEventName =
  | Extract<keyof AnalyticsEventProperties, `territory_${string}`>
  | 'bubble_reader_opened_from_canvas';

const allowedKeys = {
  territory_created: ['project_id', 'territory_id', 'source'],
  territory_renamed: ['project_id', 'territory_id'],
  territory_deleted: [
    'project_id',
    'territory_id',
    'moved_bubble_count',
  ],
  territory_destination_selected: [
    'project_id',
    'source',
    'destination_kind',
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

const allowedStableValues = {
  source: new Set(['action_bar', 'bubble_creation', 'extraction']),
  destination_kind: new Set(['ungrouped', 'existing', 'new']),
} as const;

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

  for (const [key, value] of Object.entries(properties)) {
    const safeValue =
      (typeof value === 'string' && value.length > 0) ||
      (typeof value === 'number' && Number.isFinite(value) && value >= 0);

    if (!safeValue) {
      throw new TypeError(
        `Territory analytics event ${event} has unsafe values.`,
      );
    }

    if (
      key in allowedStableValues &&
      !allowedStableValues[key as keyof typeof allowedStableValues].has(
        value as never,
      )
    ) {
      throw new TypeError(
        `Territory analytics event ${event} has an unstable categorical value.`,
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

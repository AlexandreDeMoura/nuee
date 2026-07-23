export interface AnalyticsEventProperties {
  project_created: {
    project_id: string;
  };
  project_opened: {
    project_id: string;
  };
  project_description_updated: {
    project_id: string;
  };
  project_panel_viewed: {
    project_id: string;
    view: 'discussions' | 'documents' | 'project' | 'inspector';
  };
  project_empty_action_selected: {
    project_id: string;
    action: 'start_discussion' | 'create_bubble' | 'upload_document';
  };
  bubble_created: {
    project_id: string;
    bubble_id: string;
    source_kind: 'manual' | 'discussion';
  };
  bubble_moved: {
    project_id: string;
    bubble_id: string;
  };
  bubble_inspected: {
    project_id: string;
    bubble_id: string;
  };
  bubble_content_updated: {
    project_id: string;
    bubble_id: string;
  };
  bubble_deleted: {
    project_id: string;
    bubble_id: string;
  };
  bubble_link_created: {
    project_id: string;
    bubble_a_id: string;
    bubble_b_id: string;
  };
  bubble_link_removed: {
    project_id: string;
    bubble_a_id: string;
    bubble_b_id: string;
  };
  bubble_multi_selection_started: {
    project_id: string;
  };
  bubble_multi_selection_cancelled: {
    project_id: string;
    bubble_ids: string[];
  };
  bubble_multi_selection_confirmed: {
    project_id: string;
    bubble_ids: string[];
  };
  bubble_compact_layout_applied: {
    project_id: string;
    bubble_ids: string[];
  };
  canvas_viewport_restored: {
    project_id: string;
  };
}

export type AnalyticsEventName = keyof AnalyticsEventProperties;

export interface AnalyticsClient {
  track<EventName extends AnalyticsEventName>(
    event: EventName,
    properties: AnalyticsEventProperties[EventName],
  ): void;
}

export type AnalyticsEvent<EventName extends AnalyticsEventName = AnalyticsEventName> = {
  [Name in EventName]: {
    event: Name;
    properties: AnalyticsEventProperties[Name];
  };
}[EventName];

export const browserAnalyticsEventName = 'nuee:analytics';

/**
 * Vendor-neutral browser boundary. An analytics adapter can subscribe to this
 * event without product components depending on a vendor SDK.
 */
export const analytics: AnalyticsClient = {
  track(event, properties) {
    const detail: AnalyticsEvent<typeof event> = { event, properties };

    window.dispatchEvent(
      new CustomEvent<AnalyticsEvent<typeof event>>(browserAnalyticsEventName, { detail }),
    );
  },
};

export function trackAnalytics<EventName extends AnalyticsEventName>(
  analyticsClient: AnalyticsClient,
  event: EventName,
  properties: AnalyticsEventProperties[EventName],
) {
  try {
    analyticsClient.track(event, properties);
  } catch {
    // Analytics must never interrupt the product action being measured.
  }
}

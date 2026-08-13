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
  project_deleted: {
    project_id: string;
  };
  project_panel_viewed: {
    project_id: string;
    view: 'discussions' | 'documents' | 'project' | 'inspector';
  };
  project_panel_collapsed: {
    project_id: string;
    collapsed: boolean;
    source: 'rail_toggle' | 'panel_tab' | 'shortcut';
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
  territory_created: {
    project_id: string;
    territory_id: string;
    source: 'action_bar' | 'bubble_creation' | 'extraction';
  };
  territory_renamed: {
    project_id: string;
    territory_id: string;
  };
  territory_deleted: {
    project_id: string;
    territory_id: string;
    moved_bubble_count: number;
  };
  territory_destination_selected: {
    project_id: string;
    source: 'bubble_creation' | 'extraction';
    destination_kind: 'ungrouped' | 'existing' | 'new';
  };
  territory_visible_count_changed: {
    project_id: string;
    territory_id: string;
    bubble_count: number;
    previous_visible_count: number;
    visible_count: number;
  };
  territory_scroll_unlocked: {
    project_id: string;
    territory_id: string;
    bubble_count: number;
    hidden_bubble_count: number;
  };
  bubble_reader_opened_from_canvas: {
    project_id: string;
    bubble_id: string;
    territory_id: string;
  };
  territory_moved: {
    project_id: string;
    territory_id: string;
  };
  territory_compact_layout_applied: {
    project_id: string;
    moved_territory_count: number;
  };
  canvas_viewport_restored: {
    project_id: string;
  };
  discussion_created: {
    project_id: string;
    discussion_id: string;
    occurred_at: string;
  };
  discussion_first_prompt_submitted: {
    project_id: string;
    discussion_id: string;
    request_id: string;
    occurred_at: string;
  };
  discussion_response_completed: {
    project_id: string;
    discussion_id: string;
    request_id: string;
    occurred_at: string;
    latency_ms: number;
    web_search_requested: boolean;
    web_search_used: boolean;
    citation_count: number;
  };
  discussion_response_failed: {
    project_id: string;
    discussion_id: string;
    request_id: string;
    occurred_at: string;
    latency_ms: number;
    web_search_requested: boolean;
    web_search_used: false;
    citation_count: 0;
  };
  discussion_title_generated: {
    project_id: string;
    discussion_id: string;
    occurred_at: string;
    latency_ms: number;
  };
  discussion_title_generation_failed: {
    project_id: string;
    discussion_id: string;
    occurred_at: string;
    latency_ms: number;
  };
  discussion_opened: {
    project_id: string;
    discussion_id: string;
    occurred_at: string;
  };
  discussion_minimized: {
    project_id: string;
    discussion_id: string;
    occurred_at: string;
  };
  discussion_context_inspected: {
    project_id: string;
    discussion_id: string;
    context_id: string;
    source_kind: 'project_description' | 'bubble' | 'document';
    occurred_at: string;
  };
  discussion_deleted: {
    project_id: string;
    discussion_id: string;
    occurred_at: string;
  };
  discussion_active_changed: {
    project_id: string;
    previous_discussion_id: string | null;
    discussion_id: string | null;
    occurred_at: string;
  };
  discussion_mention_list_opened: {
    project_id: string;
    result_count: number;
    bubble_count: number;
    document_count: number;
  };
  discussion_mention_source_attached: {
    project_id: string;
    source_id: string;
    source_kind: 'bubble' | 'document';
    input_method: 'keyboard' | 'pointer';
  };
  discussion_mention_source_removed: {
    project_id: string;
    source_id: string;
    source_kind: 'bubble' | 'document';
    removal_method: 'remove_control' | 'token_deletion';
  };
  discussion_mention_empty_state_displayed: {
    project_id: string;
  };
  discussion_mention_empty_state_cta_activated: {
    project_id: string;
    action: 'upload_document' | 'create_bubble';
  };
  discussion_mention_not_ready_attach_attempted: {
    project_id: string;
    source_id: string;
    source_kind: 'document';
    input_method: 'keyboard' | 'pointer';
    readiness_reason: 'processing' | 'failed';
  };
  discussion_context_sources_frozen: {
    project_id: string;
    discussion_id: string;
    bubble_count: number;
    document_count: number;
    attached_source_count: number;
    frozen_source_count: number;
  };
  knowledge_extraction_started: {
    project_id: string;
    discussion_id: string;
    entry_point: 'discussion_header' | 'assistant_response';
    occurred_at: string;
  };
  knowledge_extraction_generation_finished: {
    project_id: string;
    discussion_id: string;
    detail_level: 'tight' | 'standard' | 'detailed';
    instructions_supplied: boolean;
    instructions_length_band:
      | 'none'
      | '1_to_100_chars'
      | '101_to_500_chars'
      | '501_to_2000_chars';
    message_selection_mode: 'selected';
    select_all_used: boolean;
    selected_message_count: number;
    frozen_project_description_count: number;
    frozen_bubble_count: number;
    frozen_document_count: number;
    payload_size_band:
      | 'under_4_kib'
      | '4_to_16_kib'
      | '16_to_64_kib'
      | 'over_64_kib';
    status: 'succeeded' | 'failed' | 'source_invalid';
    latency_ms: number;
    retry_count: number;
    occurred_at: string;
  };
  knowledge_extraction_resolution_finished: {
    project_id: string;
    discussion_id: string;
    resolution: 'new_bubble' | 'update_bubble' | 'reject';
    status: 'succeeded' | 'failed' | 'target_changed';
    latency_ms: number;
    occurred_at: string;
  };
  document_upload_finished: {
    project_id: string;
    document_id: string | null;
    upload_source: 'documents_panel' | 'project_creation';
    format_category: 'plain_text' | 'markdown' | 'pdf' | 'unknown';
    size_band: 'under_100_kib' | '100_kib_to_1_mib' | '1_to_10_mib' | 'over_10_mib';
    outcome: 'accepted' | 'client_rejected' | 'failed';
    processing_state: 'not_started' | 'processing' | 'ready' | 'failed';
  };
  document_upload_retry_requested: {
    project_id: string;
    upload_source: 'documents_panel' | 'project_creation';
    format_category: 'plain_text' | 'markdown' | 'pdf' | 'unknown';
    size_band: 'under_100_kib' | '100_kib_to_1_mib' | '1_to_10_mib' | 'over_10_mib';
  };
  document_processing_observed: {
    project_id: string;
    document_id: string;
    format_category: 'plain_text' | 'markdown' | 'pdf';
    size_band: 'under_100_kib' | '100_kib_to_1_mib' | '1_to_10_mib' | 'over_10_mib';
    processing_state: 'processing' | 'ready' | 'failed';
    processing_duration_ms: number | null;
    error_code: string | null;
  };
  document_processing_retry_finished: {
    project_id: string;
    document_id: string;
    format_category: 'plain_text' | 'markdown' | 'pdf';
    size_band: 'under_100_kib' | '100_kib_to_1_mib' | '1_to_10_mib' | 'over_10_mib';
    outcome: 'accepted' | 'failed';
    processing_state: 'processing' | 'failed';
  };
  document_inspected: {
    project_id: string;
    document_id: string;
    format_category: 'plain_text' | 'markdown' | 'pdf';
    size_band: 'under_100_kib' | '100_kib_to_1_mib' | '1_to_10_mib' | 'over_10_mib';
    context_readiness: 'ready' | 'not_ready';
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

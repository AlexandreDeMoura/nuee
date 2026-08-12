import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsClient } from '../analytics';
import {
  assertPrivacySafeTerritoryAnalytics,
  trackTerritoryAnalytics,
} from './territoryAnalytics';

describe('territory analytics', () => {
  it('allows identifiers and counts while rejecting canvas copy and coordinates', () => {
    expect(() =>
      assertPrivacySafeTerritoryAnalytics('territory_scroll_unlocked', {
        project_id: 'project-one',
        territory_id: 'territory-one',
        bubble_count: 6,
        hidden_bubble_count: 2,
      }),
    ).not.toThrow();

    expect(() =>
      assertPrivacySafeTerritoryAnalytics('territory_scroll_unlocked', {
        project_id: 'project-one',
        territory_id: 'territory-one',
        bubble_count: 6,
        hidden_bubble_count: 2,
        title: 'Private territory title',
      }),
    ).toThrow('unsafe properties');

    expect(() =>
      assertPrivacySafeTerritoryAnalytics('territory_moved', {
        project_id: 'project-one',
        territory_id: 'territory-one',
        position_x: 240,
      }),
    ).toThrow('unsafe properties');

    expect(() =>
      assertPrivacySafeTerritoryAnalytics(
        'territory_destination_selected',
        {
          project_id: 'project-one',
          source: 'Private territory title',
          destination_kind: 'existing',
        },
      ),
    ).toThrow('unstable categorical value');
  });

  it('forwards an allowlisted event to the injected analytics client', () => {
    const track = vi.fn<AnalyticsClient['track']>();

    trackTerritoryAnalytics(
      { track },
      'bubble_reader_opened_from_canvas',
      {
        project_id: 'project-one',
        bubble_id: 'bubble-one',
        territory_id: 'territory-one',
      },
    );

    expect(track).toHaveBeenCalledWith(
      'bubble_reader_opened_from_canvas',
      {
        project_id: 'project-one',
        bubble_id: 'bubble-one',
        territory_id: 'territory-one',
      },
    );
  });

  it('allows only stable creation sources and destination kinds', () => {
    expect(() =>
      assertPrivacySafeTerritoryAnalytics('territory_created', {
        project_id: 'project-one',
        territory_id: 'territory-one',
        source: 'action_bar',
      }),
    ).not.toThrow();
    expect(() =>
      assertPrivacySafeTerritoryAnalytics(
        'territory_destination_selected',
        {
          project_id: 'project-one',
          source: 'extraction',
          destination_kind: 'new',
        },
      ),
    ).not.toThrow();
  });
});

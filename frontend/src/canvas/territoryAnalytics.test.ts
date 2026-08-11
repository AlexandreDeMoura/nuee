import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import type { AnalyticsClient } from '../analytics';
import {
  assertPrivacySafeTerritoryAnalytics,
  territoryRecomposeFailureReason,
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

  it('normalizes backend and transport failures to stable reasons', () => {
    expect(
      territoryRecomposeFailureReason(
        new ApiError(503, {
          code: 'TERRITORY_RECOMPOSE_FAILED',
          reason: 'invalid_output',
        }),
      ),
    ).toBe('invalid_output');
    expect(
      territoryRecomposeFailureReason(
        new ApiError(413, {
          code: 'TERRITORY_RECOMPOSE_SOURCE_TOO_LARGE',
        }),
      ),
    ).toBe('source_too_large');
    expect(territoryRecomposeFailureReason(new Error('private details'))).toBe(
      'request_failed',
    );
  });
});

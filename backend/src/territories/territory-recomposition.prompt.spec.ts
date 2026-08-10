import type { Bubble } from '@nuee/shared-types';
import {
  buildTerritoryRecompositionModelInput,
  RECOMPOSE_CONTENT_EXCERPT_LENGTH,
  RECOMPOSE_SUMMARY_EXCERPT_LENGTH,
  TERRITORY_RECOMPOSITION_FORMAT,
} from './territory-recomposition.prompt';

describe('territory recomposition prompt', () => {
  it('serializes every bubble with bounded summary and content excerpts', () => {
    const bubble: Bubble = {
      id: 'bubble-a',
      project_id: 'project-a',
      territory_id: 'ungrouped-a',
      title: 'Product constraints',
      summary: `S${'u'.repeat(RECOMPOSE_SUMMARY_EXCERPT_LENGTH + 20)}`,
      content: `C${'o'.repeat(RECOMPOSE_CONTENT_EXCERPT_LENGTH + 20)}`,
      created_at: '2026-08-10T09:00:00.000Z',
      updated_at: '2026-08-10T09:00:00.000Z',
      source_kind: 'manual',
      source_discussion_id: null,
      source_discussion_title: null,
      source_discussion_deleted_at: null,
      source_message_ids: [],
      source_context_item_ids: [],
    };

    const input = buildTerritoryRecompositionModelInput([
      bubble,
      { ...bubble, id: 'bubble-b', summary: null },
    ]);
    const serialized = input.messages[0].content.match(
      /UNTRUSTED_BUBBLES_JSON_BEGIN\n([^\n]+)\nUNTRUSTED_BUBBLES_JSON_END/,
    )?.[1];
    const source = JSON.parse(serialized ?? '{}') as {
      bubbles: Array<{
        id: string;
        summary: string | null;
        content_opening: string;
      }>;
    };

    expect(source.bubbles.map(({ id }) => id)).toEqual([
      'bubble-a',
      'bubble-b',
    ]);
    expect(source.bubbles[0].summary).toHaveLength(
      RECOMPOSE_SUMMARY_EXCERPT_LENGTH,
    );
    expect(source.bubbles[0].content_opening).toHaveLength(
      RECOMPOSE_CONTENT_EXCERPT_LENGTH,
    );
    expect(source.bubbles[1].summary).toBeNull();
    expect(input.format).toBe(TERRITORY_RECOMPOSITION_FORMAT);
    expect(input.instructions).toContain('every supplied bubble identifier');
    expect(input.instructions).toContain('untrusted source text');
  });
});

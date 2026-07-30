import {
  buildKnowledgeExtractionModelInput,
  KNOWLEDGE_EXTRACTION_INSTRUCTIONS,
  KNOWLEDGE_EXTRACTION_PROPOSAL_FORMAT,
} from './knowledge-extraction.prompt';
import type { KnowledgeExtractionSourceSnapshotV1 } from './knowledge-extraction.types';

describe('knowledge extraction model input', () => {
  it('serializes only canonically ordered selected content in separated sections', () => {
    const snapshot: KnowledgeExtractionSourceSnapshotV1 = {
      version: 1,
      project_id: 'project-internal-id',
      discussion_id: 'discussion-internal-id',
      discussion_title: 'Internal discussion title',
      requested_at: '2026-07-30T12:00:00.000Z',
      message_selection_kind: 'selected',
      messages: [
        {
          source_kind: 'message',
          source_id: 'message-internal-user-id',
          role: 'user',
          content: 'What remains uncertain?',
          created_at: '2026-07-30T10:00:00.000Z',
          discussion_order: 0,
        },
        {
          source_kind: 'message',
          source_id: 'message-internal-assistant-id',
          role: 'assistant',
          content: 'The launch date remains uncertain.',
          created_at: '2026-07-30T10:00:01.000Z',
          discussion_order: 1,
        },
      ],
      frozen_context_items: [
        {
          source_kind: 'frozen_context',
          source_id: 'context-internal-id',
          context_source_kind: 'bubble',
          source_title: 'Launch constraint',
          content: 'Legal approval is required before launch.',
          created_at: '2026-07-30T09:00:00.000Z',
          display_order: 1,
        },
      ],
    };

    const input = buildKnowledgeExtractionModelInput(snapshot);

    expect(input).toEqual({
      instructions: KNOWLEDGE_EXTRACTION_INSTRUCTIONS,
      messages: [
        {
          role: 'user',
          content: [
            'KNOWLEDGE_EXTRACTION_SOURCE_V1',
            'SELECTED_MESSAGES_JSON',
            '[{"role":"user","content":"What remains uncertain?"},{"role":"assistant","content":"The launch date remains uncertain."}]',
            'FROZEN_CONTEXT_JSON',
            '[{"source_kind":"bubble","source_title":"Launch constraint","content":"Legal approval is required before launch."}]',
          ].join('\n'),
        },
      ],
      format: KNOWLEDGE_EXTRACTION_PROPOSAL_FORMAT,
    });
    expect(JSON.stringify(input)).not.toContain('project-internal-id');
    expect(JSON.stringify(input)).not.toContain('discussion-internal-id');
    expect(JSON.stringify(input)).not.toContain('message-internal');
    expect(JSON.stringify(input)).not.toContain('context-internal-id');
    expect(JSON.stringify(input)).not.toContain('requested_at');
    expect(input.instructions).toContain('Preserve material uncertainty');
    expect(input.instructions).toContain('Use only claims present');
  });
});

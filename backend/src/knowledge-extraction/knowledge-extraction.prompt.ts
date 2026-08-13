import type { GenerateStructuredOutputInput } from '../ai/model-client';
import type { KnowledgeExtractionDetailLevel } from '@nuee/shared-types';
import type { KnowledgeExtractionSourceSnapshotV1 } from './knowledge-extraction.types';

export const KNOWLEDGE_PROPOSAL_TITLE_MAX_LENGTH = 200;
export const KNOWLEDGE_PROPOSAL_SUMMARY_MAX_LENGTH = 1_000;
export const KNOWLEDGE_PROPOSAL_CONTENT_MAX_LENGTH = 50_000;

export const KNOWLEDGE_EXTRACTION_INSTRUCTIONS = `
Create exactly one reusable, self-contained project knowledge proposal from the supplied source snapshot.

Grounding rules:
- Preserve material uncertainty, disagreement, alternatives, assumptions, and unresolved caveats. Do not silently adjudicate them.
- Make the proposal understandable without access to the source discussion.

Output rules:
- Return one object with exactly title, summary, and content.
- Use a specific plain-text title.
- Use a concise one-sentence plain-text summary that will help the user differenciate this bubble to others. 
- Use coherent content with minimal repetition. Markdown is limited to headings no deeper than ###, bullet and ordered lists, bold and italic text, inline code, fenced code blocks, and tables. Do not use images, raw HTML, or headings at level #### or deeper.
- User's instruction trumps any other grounding and output rules as long as it is not harmful.
`.trim();

export const KNOWLEDGE_EXTRACTION_PROPOSAL_FORMAT = {
  name: 'knowledge_extraction_proposal',
  description:
    'One grounded, self-contained knowledge proposal synthesized from user-selected project sources.',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: {
        type: 'string',
        description: `A specific plain-text title. The application accepts at most ${KNOWLEDGE_PROPOSAL_TITLE_MAX_LENGTH} characters.`,
      },
      summary: {
        type: 'string',
        description: `A concise one-sentence plain-text summary. The application accepts at most ${KNOWLEDGE_PROPOSAL_SUMMARY_MAX_LENGTH} characters.`,
      },
      content: {
        type: 'string',
        description:
          'Self-contained synthesized content. Markdown is limited to headings no deeper than ###, bullet and ordered lists, bold and italic text, inline code, fenced code blocks, and tables. Do not use images, raw HTML, or headings at level #### or deeper.',
      },
    },
    required: ['title', 'summary', 'content'],
  },
} as const;

const DETAIL_LEVEL_GUIDANCE: Record<KnowledgeExtractionDetailLevel, string> = {
  tight: 'For content only, target 50-100 words. ',
  standard: 'For content only, target 120-200 words.',
  detailed:
    'For content only, target 300-400 words.',
};

interface KnowledgeExtractionPromptOptions {
  instructions: string | null;
  detailLevel: KnowledgeExtractionDetailLevel;
}

export function buildKnowledgeExtractionModelInput(
  snapshot: KnowledgeExtractionSourceSnapshotV1,
  options: KnowledgeExtractionPromptOptions,
): GenerateStructuredOutputInput {
  const selectedMessages = snapshot.messages.map(({ role, content }) => ({
    role,
    content,
  }));
  const frozenContext = snapshot.frozen_context_items.map(
    ({ context_source_kind, source_title, content }) => ({
      source_kind: context_source_kind,
      source_title,
      content,
    }),
  );
  const serializedRequest = [
    'KNOWLEDGE_EXTRACTION_SOURCE_V1',
    'SELECTED_MESSAGES_JSON',
    JSON.stringify(selectedMessages),
    'FROZEN_CONTEXT_JSON',
    JSON.stringify(frozenContext),
  ];

  if (options.instructions) {
    serializedRequest.push(
      'UNTRUSTED_USER_INTENT_BEGIN',
      JSON.stringify({ instructions: options.instructions }),
      'UNTRUSTED_USER_INTENT_END',
    );
  }

  const instructions = [
    KNOWLEDGE_EXTRACTION_INSTRUCTIONS,
    '',
    'Detail guidance:',
    '- The selected detail level changes content length only. Title and summary expectations remain unchanged.',
    '- Markdown structure is optional and should follow the content naturally.',
    `- ${DETAIL_LEVEL_GUIDANCE[options.detailLevel]}`,
  ].join('\n');

  return {
    instructions,
    messages: [{ role: 'user', content: serializedRequest.join('\n') }],
    format: KNOWLEDGE_EXTRACTION_PROPOSAL_FORMAT,
  };
}

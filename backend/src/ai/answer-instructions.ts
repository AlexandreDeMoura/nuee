import { GENERATED_TITLE_MAX_LENGTH } from './model-client';

export const TITLE_INSTRUCTIONS = `Generate a concise, descriptive, single-line title of at most ${GENERATED_TITLE_MAX_LENGTH} characters for this discussion. Return only the title, without quotation marks or terminal punctuation.`;

export function buildFocusedResponseInstructions(wordBudget: number): string {
  return [
    "Answer the user's current question directly and keep the discussion focused on its narrow line of inquiry.",
    `Aim for a response readable in about one minute (roughly ${wordBudget} words) by default.`,
    'This is a soft budget, not a hard limit. Use more detail, tables, numbered steps, code, citations, caveats, or open questions when the request requires them for correctness.',
    'Do not force a fixed response template or include empty sections.',
  ].join(' ');
}

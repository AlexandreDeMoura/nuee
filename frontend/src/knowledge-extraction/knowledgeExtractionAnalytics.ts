import type { DiscussionDetails } from '../api';
import type { AnalyticsEventProperties } from '../analytics';
import {
  eligibleKnowledgeExtractionContextItems,
  eligibleKnowledgeExtractionMessages,
} from './knowledgeExtractionSources';
import type { KnowledgeExtractionSelection } from './knowledgeExtractionStateMachine';

type GenerationAnalyticsProperties =
  AnalyticsEventProperties['knowledge_extraction_generation_finished'];

export type KnowledgeExtractionGenerationMetrics = Pick<
  GenerationAnalyticsProperties,
  | 'detail_level'
  | 'instructions_supplied'
  | 'instructions_length_band'
  | 'message_selection_mode'
  | 'select_all_used'
  | 'selected_message_count'
  | 'frozen_project_description_count'
  | 'frozen_bubble_count'
  | 'frozen_document_count'
  | 'payload_size_band'
>;

function instructionsLengthBand(
  instructions: string,
): GenerationAnalyticsProperties['instructions_length_band'] {
  const length = instructions.trim().length;

  if (length === 0) {
    return 'none';
  }

  if (length <= 100) {
    return '1_to_100_chars';
  }

  if (length <= 500) {
    return '101_to_500_chars';
  }

  return '501_to_2000_chars';
}

function payloadSizeBand(
  byteLength: number,
): GenerationAnalyticsProperties['payload_size_band'] {
  if (byteLength < 4 * 1024) {
    return 'under_4_kib';
  }

  if (byteLength < 16 * 1024) {
    return '4_to_16_kib';
  }

  if (byteLength < 64 * 1024) {
    return '16_to_64_kib';
  }

  return 'over_64_kib';
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function knowledgeExtractionGenerationMetrics(
  discussion: DiscussionDetails | null | undefined,
  selection: KnowledgeExtractionSelection,
  selectAllUsed = false,
): KnowledgeExtractionGenerationMetrics {
  const eligibleMessages = discussion
    ? eligibleKnowledgeExtractionMessages(discussion)
    : [];
  const selectedMessageIds = new Set(selection.messageIds);
  const selectedMessages = eligibleMessages.filter(
    (message) => selectedMessageIds.has(message.id),
  );
  const selectedContextIds = new Set(
    selection.frozenContextItemIds,
  );
  const selectedContextItems = discussion
    ? eligibleKnowledgeExtractionContextItems(discussion).filter(
        (item) => selectedContextIds.has(item.id),
      )
    : [];
  const frozenContextCounts = {
    bubble: 0,
    document: 0,
    project_description: 0,
  };

  for (const item of selectedContextItems) {
    frozenContextCounts[item.source_kind] += 1;
  }

  // This local serialization estimates the source material sent for
  // generation. Only the resulting size band leaves this feature boundary.
  const selectedSourcePayload = JSON.stringify({
    frozen_context_items: selectedContextItems.map((item) => ({
      content: item.frozen_content,
      source_kind: item.source_kind,
      source_title: item.source_title,
    })),
    messages: selectedMessages.map((message) => ({
      content: message.content,
      role: message.role,
    })),
  });

  return {
    detail_level: selection.detailLevel,
    instructions_supplied: selection.instructions.trim().length > 0,
    instructions_length_band: instructionsLengthBand(
      selection.instructions,
    ),
    message_selection_mode: 'selected',
    select_all_used: selectAllUsed,
    selected_message_count:
      discussion === undefined || discussion === null
        ? selectedMessageIds.size
        : selectedMessages.length,
    frozen_project_description_count:
      frozenContextCounts.project_description,
    frozen_bubble_count: frozenContextCounts.bubble,
    frozen_document_count: frozenContextCounts.document,
    payload_size_band: payloadSizeBand(
      utf8ByteLength(selectedSourcePayload),
    ),
  };
}

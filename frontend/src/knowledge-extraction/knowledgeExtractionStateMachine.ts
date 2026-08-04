import type {
  KnowledgeExtractionDetailLevel,
  KnowledgeExtractionProposal,
  KnowledgeExtractionResolutionResponse,
  KnowledgeExtractionTargetPreview,
} from '../api';

export type KnowledgeExtractionStatus =
  | 'idle'
  | 'selecting'
  | 'generating'
  | 'generation_failed'
  | 'source_invalid'
  | 'reviewing'
  | 'selecting_update_target'
  | 'saving_new'
  | 'saving_update'
  | 'resolved'
  | 'discarded';

export interface KnowledgeExtractionBinding {
  discussionId: string;
  projectId: string;
}

export interface KnowledgeExtractionSelection {
  detailLevel: KnowledgeExtractionDetailLevel;
  frozenContextItemIds: string[];
  instructions: string;
  messageIds: string[];
}

export type KnowledgeExtractionSourceIssueReason =
  | 'missing'
  | 'cross_project'
  | 'cross_discussion'
  | 'inaccessible';

export interface KnowledgeExtractionSourceIssue {
  reason: KnowledgeExtractionSourceIssueReason;
  sourceId: string;
  sourceKind: 'message' | 'frozen_context';
}

export type KnowledgeExtractionRequestField =
  | 'detail_level'
  | 'frozen_context_item_ids'
  | 'instructions'
  | 'message_ids';

export type KnowledgeExtractionFieldErrors = Partial<
  Record<KnowledgeExtractionRequestField, string>
>;

export type KnowledgeExtractionFailure =
  | {
      code: string | null;
      kind: 'generation';
      message: string;
      retryable: true;
    }
  | {
      code: string | null;
      fieldErrors: KnowledgeExtractionFieldErrors;
      kind: 'source_validation';
      message: string;
      retryable: false;
      sourceIssues: readonly KnowledgeExtractionSourceIssue[];
    }
  | {
      code: string | null;
      kind: 'resolution';
      message: string;
      retryable: true;
    }
  | {
      code: 'KNOWLEDGE_EXTRACTION_TARGET_CHANGED';
      kind: 'target_changed';
      message: string;
      retryable: false;
    };

export interface KnowledgeExtractionUpdateTarget
  extends KnowledgeExtractionTargetPreview {
  project_id: string;
}

export interface KnowledgeExtractionState
  extends KnowledgeExtractionBinding {
  attemptId: string | null;
  extractionId: string | null;
  failure: KnowledgeExtractionFailure | null;
  generatedProposal: KnowledgeExtractionProposal | null;
  initialMessageId: string | null;
  proposal: KnowledgeExtractionProposal | null;
  resolution: KnowledgeExtractionResolutionResponse | null;
  retryCount: number;
  selectAllUsed: boolean;
  selection: KnowledgeExtractionSelection;
  selectionFingerprint: string;
  status: KnowledgeExtractionStatus;
  target: KnowledgeExtractionUpdateTarget | null;
}

export type KnowledgeExtractionEvent =
  | {
      binding: KnowledgeExtractionBinding;
      type: 'binding_changed';
    }
  | {
      initialMessageId?: string;
      type: 'start';
    }
  | {
      selection: KnowledgeExtractionSelection;
      selectAllUsed?: boolean;
      type: 'selection_changed';
    }
  | {
      failure: Extract<
        KnowledgeExtractionFailure,
        { kind: 'source_validation' }
      >;
      type: 'selection_invalid';
    }
  | {
      attemptId: string;
      type: 'generation_started';
    }
  | {
      failure: Extract<
        KnowledgeExtractionFailure,
        { kind: 'generation' }
      >;
      type: 'generation_failed';
    }
  | {
      failure: Extract<
        KnowledgeExtractionFailure,
        { kind: 'source_validation' }
      >;
      type: 'source_invalid';
    }
  | {
      extractionId: string;
      proposal: KnowledgeExtractionProposal;
      type: 'generation_succeeded';
    }
  | {
      field: keyof KnowledgeExtractionProposal;
      type: 'proposal_edited';
      value: string;
    }
  | {
      type: 'update_target_selection_started';
    }
  | {
      target: KnowledgeExtractionUpdateTarget;
      type: 'update_target_selected';
    }
  | {
      type: 'update_target_selection_cancelled';
    }
  | {
      type: 'new_bubble_save_started';
    }
  | {
      type: 'bubble_update_save_started';
    }
  | {
      failure: Extract<
        KnowledgeExtractionFailure,
        { kind: 'resolution' }
      >;
      type: 'resolution_failed';
    }
  | {
      failure: Extract<
        KnowledgeExtractionFailure,
        { kind: 'target_changed' }
      >;
      target: KnowledgeExtractionUpdateTarget;
      type: 'update_target_changed';
    }
  | {
      resolution: KnowledgeExtractionResolutionResponse;
      type: 'resolved';
    }
  | {
      type: 'discarded';
    }
  | {
      type: 'reset';
    };

function emptySelection(): KnowledgeExtractionSelection {
  return {
    detailLevel: 'standard',
    frozenContextItemIds: [],
    instructions: '',
    messageIds: [],
  };
}

function normalizeIdentifiers(identifiers: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const candidate of identifiers) {
    const identifier = candidate.trim();

    if (identifier.length === 0 || seen.has(identifier)) {
      continue;
    }

    seen.add(identifier);
    normalized.push(identifier);
  }

  return normalized;
}

export function normalizeKnowledgeExtractionSelection(
  selection: KnowledgeExtractionSelection,
): KnowledgeExtractionSelection {
  return {
    detailLevel: selection.detailLevel,
    frozenContextItemIds: normalizeIdentifiers(
      selection.frozenContextItemIds,
    ),
    instructions: selection.instructions,
    messageIds: normalizeIdentifiers(selection.messageIds),
  };
}

export function knowledgeExtractionSelectionFingerprint(
  selection: KnowledgeExtractionSelection,
): string {
  const normalized = normalizeKnowledgeExtractionSelection(selection);

  return JSON.stringify({
    detail_level: normalized.detailLevel,
    frozen_context_item_ids: [...normalized.frozenContextItemIds].sort(),
    instructions:
      normalized.instructions.trim().replace(/\s+/g, ' ') || null,
    message_ids: [...normalized.messageIds].sort(),
  });
}

export function hasKnowledgeExtractionSources(
  selection: KnowledgeExtractionSelection,
): boolean {
  return (
    selection.messageIds.length > 0 ||
    selection.frozenContextItemIds.length > 0
  );
}

export function createKnowledgeExtractionState(
  binding: KnowledgeExtractionBinding,
): KnowledgeExtractionState {
  const selection = emptySelection();

  return {
    ...binding,
    attemptId: null,
    extractionId: null,
    failure: null,
    generatedProposal: null,
    initialMessageId: null,
    proposal: null,
    resolution: null,
    retryCount: 0,
    selectAllUsed: false,
    selection,
    selectionFingerprint:
      knowledgeExtractionSelectionFingerprint(selection),
    status: 'idle',
    target: null,
  };
}

function selectingState(
  state: KnowledgeExtractionState,
  initialMessageId?: string,
): KnowledgeExtractionState {
  const normalizedMessageId = initialMessageId?.trim() ?? '';
  const selection = normalizeKnowledgeExtractionSelection({
    detailLevel: 'standard',
    frozenContextItemIds: [],
    instructions: '',
    messageIds:
      normalizedMessageId.length > 0 ? [normalizedMessageId] : [],
  });

  return {
    ...createKnowledgeExtractionState(state),
    initialMessageId:
      normalizedMessageId.length > 0 ? normalizedMessageId : null,
    selection,
    selectionFingerprint:
      knowledgeExtractionSelectionFingerprint(selection),
    status: 'selecting',
  };
}

function terminalState(
  state: KnowledgeExtractionState,
  status: 'resolved' | 'discarded',
  resolution: KnowledgeExtractionResolutionResponse | null,
): KnowledgeExtractionState {
  return {
    ...createKnowledgeExtractionState(state),
    resolution,
    status,
  };
}

function resolutionMatchesSavingState(
  state: KnowledgeExtractionState,
  resolution: KnowledgeExtractionResolutionResponse,
): boolean {
  const kind = resolution.resolution.kind;

  return (
    (state.status === 'saving_new' && kind === 'new_bubble') ||
    (state.status === 'saving_update' && kind === 'update_bubble') ||
    (state.status === 'reviewing' && kind === 'reject')
  );
}

export function knowledgeExtractionReducer(
  state: KnowledgeExtractionState,
  event: KnowledgeExtractionEvent,
): KnowledgeExtractionState {
  switch (event.type) {
    case 'binding_changed':
      return createKnowledgeExtractionState(event.binding);

    case 'start':
      return state.status === 'idle' ||
        state.status === 'resolved' ||
        state.status === 'discarded'
        ? selectingState(state, event.initialMessageId)
        : state;

    case 'selection_changed': {
      if (
        state.status !== 'selecting' &&
        state.status !== 'source_invalid' &&
        state.status !== 'generation_failed'
      ) {
        return state;
      }

      const selection = normalizeKnowledgeExtractionSelection(
        event.selection,
      );
      const selectionFingerprint =
        knowledgeExtractionSelectionFingerprint(selection);
      const selectionChanged =
        selectionFingerprint !== state.selectionFingerprint;

      return {
        ...state,
        attemptId: selectionChanged ? null : state.attemptId,
        failure: null,
        retryCount: selectionChanged ? 0 : state.retryCount,
        selectAllUsed:
          state.selectAllUsed || event.selectAllUsed === true,
        selection,
        selectionFingerprint,
        status: 'selecting',
      };
    }

    case 'generation_started':
      return (state.status === 'selecting' ||
        state.status === 'generation_failed') &&
        hasKnowledgeExtractionSources(state.selection) &&
        event.attemptId.trim().length > 0
        ? {
            ...state,
            attemptId: event.attemptId,
            failure: null,
            retryCount:
              state.status === 'generation_failed'
                ? state.retryCount + 1
                : state.retryCount,
            status: 'generating',
          }
        : state;

    case 'selection_invalid':
      return state.status === 'selecting' ||
        state.status === 'generation_failed'
        ? {
            ...state,
            failure: event.failure,
            status: 'source_invalid',
          }
        : state;

    case 'generation_failed':
      return state.status === 'generating'
        ? {
            ...state,
            failure: event.failure,
            status: 'generation_failed',
          }
        : state;

    case 'source_invalid':
      return state.status === 'generating'
        ? {
            ...state,
            failure: event.failure,
            status: 'source_invalid',
          }
        : state;

    case 'generation_succeeded':
      return state.status === 'generating' &&
        event.extractionId.trim().length > 0
        ? {
            ...state,
            extractionId: event.extractionId,
            failure: null,
            generatedProposal: { ...event.proposal },
            proposal: { ...event.proposal },
            status: 'reviewing',
          }
        : state;

    case 'proposal_edited':
      return state.status === 'reviewing' && state.proposal
        ? {
            ...state,
            failure: null,
            proposal: {
              ...state.proposal,
              [event.field]: event.value,
            },
          }
        : state;

    case 'update_target_selection_started':
      return state.status === 'reviewing' && state.proposal
        ? {
            ...state,
            failure: null,
            status: 'selecting_update_target',
          }
        : state;

    case 'update_target_selected':
      return state.status === 'selecting_update_target' &&
        event.target.project_id === state.projectId
        ? {
            ...state,
            failure: null,
            status: 'reviewing',
            target: event.target,
          }
        : state;

    case 'update_target_selection_cancelled':
      return state.status === 'selecting_update_target'
        ? {
            ...state,
            failure: null,
            status: 'reviewing',
          }
        : state;

    case 'new_bubble_save_started':
      return state.status === 'reviewing' &&
        state.proposal &&
        state.extractionId
        ? {
            ...state,
            failure: null,
            status: 'saving_new',
          }
        : state;

    case 'bubble_update_save_started':
      return state.status === 'reviewing' &&
        state.proposal &&
        state.extractionId &&
        state.target
        ? {
            ...state,
            failure: null,
            status: 'saving_update',
          }
        : state;

    case 'resolution_failed':
      return state.status === 'saving_new' ||
        state.status === 'saving_update' ||
        state.status === 'reviewing'
        ? {
            ...state,
            failure: event.failure,
            status: 'reviewing',
          }
        : state;

    case 'update_target_changed':
      return state.status === 'saving_update' &&
        event.target.project_id === state.projectId
        ? {
            ...state,
            failure: event.failure,
            status: 'reviewing',
            target: event.target,
          }
        : state;

    case 'resolved':
      return resolutionMatchesSavingState(state, event.resolution)
        ? terminalState(state, 'resolved', event.resolution)
        : state;

    case 'discarded':
      return state.status !== 'idle' &&
        state.status !== 'resolved' &&
        state.status !== 'discarded'
        ? terminalState(state, 'discarded', null)
        : state;

    case 'reset':
      return state.status === 'idle' ||
        state.status === 'resolved' ||
        state.status === 'discarded'
        ? createKnowledgeExtractionState(state)
        : state;
  }
}

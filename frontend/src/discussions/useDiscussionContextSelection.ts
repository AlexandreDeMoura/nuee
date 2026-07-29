import {
  useCallback,
  useMemo,
  useState,
} from 'react';
import type { DiscussionContextSelectionInput } from '../api';
import type { DiscussionCreationFailure } from './discussionCreationFailure';

export type DiscussionContextEntryPoint =
  | 'canvas_action'
  | 'discussions_panel'
  | 'selected_bubble'
  | 'write_first';

export type PendingDiscussionContextKind = 'bubble' | 'document';

export interface PendingDiscussionContextSource {
  id: string;
  kind: PendingDiscussionContextKind;
  title: string;
}

export interface DiscussionContextSourceCandidate
  extends PendingDiscussionContextSource {
  projectId: string;
}

export type DiscussionContextSelectionPhase =
  | 'idle'
  | 'invitation'
  | 'selecting_bubbles'
  | 'selecting_documents'
  | 'review'
  | 'submitting'
  | 'error';

interface DiscussionContextSelectionState {
  bubbleSources: PendingDiscussionContextSource[];
  documentSources: PendingDiscussionContextSource[];
  entryPoint: DiscussionContextEntryPoint;
  error: string | null;
  failure: DiscussionCreationFailure | null;
  phase: DiscussionContextSelectionPhase;
  projectId: string;
  prompt: string;
  returnPhase: 'invitation' | 'review';
  selectionRevision: number;
}

export interface PrepareDiscussionContextOptions {
  entryPoint: DiscussionContextEntryPoint;
  initialSources?: readonly DiscussionContextSourceCandidate[];
}

export interface DiscussionContextSelectionController {
  backFromSourceSelection: () => void;
  backToInvitation: () => void;
  beginSourceSelection: (kind: PendingDiscussionContextKind) => void;
  beginSubmitting: (projectContextOnly?: boolean) => void;
  cancel: () => void;
  complete: () => void;
  confirmSourceSelection: (
    kind: PendingDiscussionContextKind,
    sources: readonly DiscussionContextSourceCandidate[],
  ) => void;
  entryPoint: DiscussionContextEntryPoint;
  error: string | null;
  failure: DiscussionCreationFailure | null;
  invite: (prompt: string) => void;
  pendingSources: readonly PendingDiscussionContextSource[];
  phase: DiscussionContextSelectionPhase;
  prepare: (options: PrepareDiscussionContextOptions) => void;
  prompt: string;
  removeSource: (kind: PendingDiscussionContextKind, sourceId: string) => void;
  retrySubmission: () => void;
  review: () => void;
  selection: DiscussionContextSelectionInput;
  selectionRevision: number;
  submissionFailed: (failure: DiscussionCreationFailure | string) => void;
}

function emptyState(projectId: string): DiscussionContextSelectionState {
  return {
    bubbleSources: [],
    documentSources: [],
    entryPoint: 'write_first',
    error: null,
    failure: null,
    phase: 'idle',
    projectId,
    prompt: '',
    returnPhase: 'invitation',
    selectionRevision: 0,
  };
}

function sourceIds(
  sources: readonly PendingDiscussionContextSource[],
): string[] {
  return sources.map(({ id }) => id);
}

function haveSameSourceIds(
  first: readonly PendingDiscussionContextSource[],
  second: readonly PendingDiscussionContextSource[],
): boolean {
  const firstIds = sourceIds(first);
  const secondIds = sourceIds(second);

  return (
    firstIds.length === secondIds.length &&
    firstIds.every((sourceId, index) => sourceId === secondIds[index])
  );
}

function asFailure(
  failure: DiscussionCreationFailure | string,
): DiscussionCreationFailure {
  return typeof failure === 'string'
    ? { code: null, message: failure, sourceIssues: [] }
    : failure;
}

function failureAfterSourceRemoval(
  failure: DiscussionCreationFailure | null,
  kind: PendingDiscussionContextKind,
  sourceId: string,
): DiscussionCreationFailure | null {
  if (!failure) {
    return null;
  }

  if (failure.code !== 'DISCUSSION_CONTEXT_SOURCE_INVALID') {
    return null;
  }

  const sourceIssues = failure.sourceIssues.filter(
    (issue) => issue.sourceKind !== kind || issue.sourceId !== sourceId,
  );

  return sourceIssues.length > 0 ? { ...failure, sourceIssues } : null;
}

function normalizeCandidates(
  projectId: string,
  kind: PendingDiscussionContextKind,
  candidates: readonly DiscussionContextSourceCandidate[],
): PendingDiscussionContextSource[] {
  const normalized: PendingDiscussionContextSource[] = [];
  const indicesById = new Map<string, number>();

  for (const candidate of candidates) {
    const id = candidate.id.trim();
    const title = candidate.title.trim();

    if (
      candidate.projectId !== projectId ||
      candidate.kind !== kind ||
      id.length === 0 ||
      title.length === 0
    ) {
      continue;
    }

    const existingIndex = indicesById.get(id);
    const source = { id, kind, title };

    if (existingIndex === undefined) {
      indicesById.set(id, normalized.length);
      normalized.push(source);
    } else {
      normalized[existingIndex] = source;
    }
  }

  return normalized;
}

/**
 * Owns pending discussion context only. It deliberately stores identifiers and
 * review labels, never source bodies or durable frozen-context records.
 */
export function useDiscussionContextSelection(
  projectId: string,
): DiscussionContextSelectionController {
  const [storedState, setStoredState] = useState<
    DiscussionContextSelectionState
  >(() => emptyState(projectId));
  const state =
    storedState.projectId === projectId
      ? storedState
      : emptyState(projectId);

  if (storedState.projectId !== projectId) {
    setStoredState(state);
  }

  const prepare = useCallback(
    ({
      entryPoint,
      initialSources = [],
    }: PrepareDiscussionContextOptions) => {
      setStoredState({
        ...emptyState(projectId),
        bubbleSources: normalizeCandidates(
          projectId,
          'bubble',
          initialSources,
        ),
        documentSources: normalizeCandidates(
          projectId,
          'document',
          initialSources,
        ),
        entryPoint,
      });
    },
    [projectId],
  );

  const invite = useCallback(
    (prompt: string) => {
      setStoredState((current) => {
        const scoped =
          current.projectId === projectId ? current : emptyState(projectId);

        return {
          ...scoped,
          error: null,
          failure: null,
          phase: 'invitation',
          prompt,
        };
      });
    },
    [projectId],
  );

  const beginSourceSelection = useCallback(
    (kind: PendingDiscussionContextKind) => {
      setStoredState((current) => {
        const scoped =
          current.projectId === projectId ? current : emptyState(projectId);

        return {
          ...scoped,
          error: null,
          failure: null,
          phase:
            kind === 'bubble'
              ? 'selecting_bubbles'
              : 'selecting_documents',
          returnPhase:
            scoped.phase === 'review' ? 'review' : 'invitation',
        };
      });
    },
    [projectId],
  );

  const backFromSourceSelection = useCallback(() => {
    setStoredState((current) =>
      current.projectId === projectId &&
      (current.phase === 'selecting_bubbles' ||
        current.phase === 'selecting_documents')
        ? {
            ...current,
            phase: current.returnPhase,
          }
        : current,
    );
  }, [projectId]);

  const confirmSourceSelection = useCallback(
    (
      kind: PendingDiscussionContextKind,
      sources: readonly DiscussionContextSourceCandidate[],
    ) => {
      setStoredState((current) => {
        const scoped =
          current.projectId === projectId ? current : emptyState(projectId);
        const normalized = normalizeCandidates(projectId, kind, sources);
        const currentSources =
          kind === 'bubble'
            ? scoped.bubbleSources
            : scoped.documentSources;
        const selectionChanged = !haveSameSourceIds(
          currentSources,
          normalized,
        );

        return {
          ...scoped,
          ...(kind === 'bubble'
            ? { bubbleSources: normalized }
            : { documentSources: normalized }),
          error: null,
          failure: null,
          phase: 'review',
          returnPhase: 'review',
          selectionRevision:
            scoped.selectionRevision + (selectionChanged ? 1 : 0),
        };
      });
    },
    [projectId],
  );

  const review = useCallback(() => {
    setStoredState((current) =>
      current.projectId === projectId
        ? { ...current, phase: 'review' }
        : current,
    );
  }, [projectId]);

  const backToInvitation = useCallback(() => {
    setStoredState((current) =>
      current.projectId === projectId
        ? { ...current, error: null, failure: null, phase: 'invitation' }
        : current,
    );
  }, [projectId]);

  const removeSource = useCallback(
    (kind: PendingDiscussionContextKind, sourceId: string) => {
      setStoredState((current) => {
        if (current.projectId !== projectId) {
          return current;
        }

        const currentSources =
          kind === 'bubble'
            ? current.bubbleSources
            : current.documentSources;

        if (!currentSources.some(({ id }) => id === sourceId)) {
          return current;
        }

        const failure = failureAfterSourceRemoval(
          current.failure,
          kind,
          sourceId,
        );

        return kind === 'bubble'
          ? {
              ...current,
              bubbleSources: current.bubbleSources.filter(
                ({ id }) => id !== sourceId,
              ),
              error: failure?.message ?? null,
              failure,
              selectionRevision: current.selectionRevision + 1,
            }
          : {
              ...current,
              documentSources: current.documentSources.filter(
                ({ id }) => id !== sourceId,
              ),
              error: failure?.message ?? null,
              failure,
              selectionRevision: current.selectionRevision + 1,
            };
      });
    },
    [projectId],
  );

  const beginSubmitting = useCallback(
    (projectContextOnly = false) => {
      setStoredState((current) => {
        if (current.projectId !== projectId) {
          return current;
        }

        return {
          ...current,
          ...(projectContextOnly
            ? { bubbleSources: [], documentSources: [] }
            : {}),
          error: null,
          failure: null,
          phase: 'submitting',
          selectionRevision:
            current.selectionRevision +
            (projectContextOnly &&
            (current.bubbleSources.length > 0 ||
              current.documentSources.length > 0)
              ? 1
              : 0),
        };
      });
    },
    [projectId],
  );

  const submissionFailed = useCallback(
    (failure: DiscussionCreationFailure | string) => {
      const normalizedFailure = asFailure(failure);

      setStoredState((current) =>
        current.projectId === projectId && current.phase === 'submitting'
          ? {
              ...current,
              error: normalizedFailure.message,
              failure: normalizedFailure,
              phase: 'error',
            }
          : current,
      );
    },
    [projectId],
  );

  const retrySubmission = useCallback(() => {
    setStoredState((current) =>
      current.projectId === projectId && current.phase === 'error'
        ? {
            ...current,
            error: null,
            failure: null,
            phase: 'submitting',
          }
        : current,
    );
  }, [projectId]);

  const cancel = useCallback(() => {
    setStoredState(emptyState(projectId));
  }, [projectId]);

  const complete = cancel;
  const pendingSources = useMemo(
    () => [...state.bubbleSources, ...state.documentSources],
    [state.bubbleSources, state.documentSources],
  );
  const selection = useMemo<DiscussionContextSelectionInput>(
    () => ({
      bubble_ids: state.bubbleSources.map(({ id }) => id),
      document_ids: state.documentSources.map(({ id }) => id),
    }),
    [state.bubbleSources, state.documentSources],
  );

  return useMemo(
    () => ({
      backFromSourceSelection,
      backToInvitation,
      beginSourceSelection,
      beginSubmitting,
      cancel,
      complete,
      confirmSourceSelection,
      entryPoint: state.entryPoint,
      error: state.error,
      failure: state.failure,
      invite,
      pendingSources,
      phase: state.phase,
      prepare,
      prompt: state.prompt,
      removeSource,
      retrySubmission,
      review,
      selection,
      selectionRevision: state.selectionRevision,
      submissionFailed,
    }),
    [
      backFromSourceSelection,
      backToInvitation,
      beginSourceSelection,
      beginSubmitting,
      cancel,
      complete,
      confirmSourceSelection,
      invite,
      pendingSources,
      prepare,
      removeSource,
      retrySubmission,
      review,
      selection,
      state.entryPoint,
      state.error,
      state.failure,
      state.phase,
      state.prompt,
      state.selectionRevision,
      submissionFailed,
    ],
  );
}

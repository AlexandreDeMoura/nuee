import { useCallback, useMemo, useState } from 'react';
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
  selectionRevision: number;
}

export interface PrepareDiscussionContextOptions {
  entryPoint: DiscussionContextEntryPoint;
  initialSources?: readonly DiscussionContextSourceCandidate[];
}

export interface DiscussionContextSelectionController {
  beginSubmitting: () => void;
  cancel: () => void;
  complete: () => void;
  entryPoint: DiscussionContextEntryPoint;
  error: string | null;
  failure: DiscussionCreationFailure | null;
  pendingSources: readonly PendingDiscussionContextSource[];
  phase: DiscussionContextSelectionPhase;
  prepare: (options: PrepareDiscussionContextOptions) => void;
  removeSource: (kind: PendingDiscussionContextKind, sourceId: string) => void;
  replaceSources: (
    sources: readonly DiscussionContextSourceCandidate[],
  ) => void;
  retrySubmission: () => void;
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

function haveSameSources(
  first: readonly PendingDiscussionContextSource[],
  second: readonly PendingDiscussionContextSource[],
): boolean {
  return (
    first.length === second.length &&
    first.every((source, index) => {
      const candidate = second[index];
      return (
        candidate?.id === source.id &&
        candidate.kind === source.kind &&
        candidate.title === source.title
      );
    })
  );
}

function asFailure(
  failure: DiscussionCreationFailure | string,
): DiscussionCreationFailure {
  return typeof failure === 'string'
    ? { code: null, message: failure, sourceIssues: [] }
    : failure;
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

function failureForSources(
  failure: DiscussionCreationFailure | null,
  sources: readonly PendingDiscussionContextSource[],
): DiscussionCreationFailure | null {
  if (!failure || failure.code !== 'DISCUSSION_CONTEXT_SOURCE_INVALID') {
    return null;
  }

  const sourceKeys = new Set(
    sources.map(({ id, kind }) => `${kind}:${id}`),
  );
  const sourceIssues = failure.sourceIssues.filter((issue) =>
    sourceKeys.has(`${issue.sourceKind}:${issue.sourceId}`),
  );

  return sourceIssues.length > 0 ? { ...failure, sourceIssues } : null;
}

/**
 * Owns the identifier-only context attached to a new discussion draft. The
 * composer owns mention-token ranges; this hook owns the pending source set,
 * submission revision, and recoverable creation failure.
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

  const replaceSources = useCallback(
    (sources: readonly DiscussionContextSourceCandidate[]) => {
      setStoredState((current) => {
        const scoped =
          current.projectId === projectId ? current : emptyState(projectId);
        const bubbleSources = normalizeCandidates(
          projectId,
          'bubble',
          sources,
        );
        const documentSources = normalizeCandidates(
          projectId,
          'document',
          sources,
        );
        const selectionChanged =
          !haveSameSourceIds(scoped.bubbleSources, bubbleSources) ||
          !haveSameSourceIds(scoped.documentSources, documentSources);

        if (!selectionChanged) {
          if (
            haveSameSources(scoped.bubbleSources, bubbleSources) &&
            haveSameSources(scoped.documentSources, documentSources)
          ) {
            return scoped;
          }

          return {
            ...scoped,
            bubbleSources,
            documentSources,
          };
        }

        const failure = failureForSources(scoped.failure, [
          ...bubbleSources,
          ...documentSources,
        ]);

        return {
          ...scoped,
          bubbleSources,
          documentSources,
          error: failure?.message ?? null,
          failure,
          phase: 'idle',
          selectionRevision: scoped.selectionRevision + 1,
        };
      });
    },
    [projectId],
  );

  const removeSource = useCallback(
    (kind: PendingDiscussionContextKind, sourceId: string) => {
      setStoredState((current) => {
        if (current.projectId !== projectId) {
          return current;
        }

        const sources = [
          ...current.bubbleSources,
          ...current.documentSources,
        ].filter(
          (source) => source.kind !== kind || source.id !== sourceId,
        );

        if (
          sources.length ===
          current.bubbleSources.length + current.documentSources.length
        ) {
          return current;
        }

        const failure = failureForSources(current.failure, sources);

        return {
          ...current,
          bubbleSources: sources.filter(({ kind }) => kind === 'bubble'),
          documentSources: sources.filter(({ kind }) => kind === 'document'),
          error: failure?.message ?? null,
          failure,
          phase: 'idle',
          selectionRevision: current.selectionRevision + 1,
        };
      });
    },
    [projectId],
  );

  const beginSubmitting = useCallback(() => {
    setStoredState((current) =>
      current.projectId === projectId
        ? {
            ...current,
            error: null,
            failure: null,
            phase: 'submitting',
          }
        : current,
    );
  }, [projectId]);

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
      beginSubmitting,
      cancel,
      complete,
      entryPoint: state.entryPoint,
      error: state.error,
      failure: state.failure,
      pendingSources,
      phase: state.phase,
      prepare,
      removeSource,
      replaceSources,
      retrySubmission,
      selection,
      selectionRevision: state.selectionRevision,
      submissionFailed,
    }),
    [
      beginSubmitting,
      cancel,
      complete,
      pendingSources,
      prepare,
      removeSource,
      replaceSources,
      retrySubmission,
      selection,
      state.entryPoint,
      state.error,
      state.failure,
      state.phase,
      state.selectionRevision,
      submissionFailed,
    ],
  );
}

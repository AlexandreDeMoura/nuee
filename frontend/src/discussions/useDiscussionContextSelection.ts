import {
  useCallback,
  useMemo,
  useState,
} from 'react';
import type { DiscussionContextSelectionInput } from '../api';

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
  phase: DiscussionContextSelectionPhase;
  projectId: string;
  prompt: string;
  returnPhase: 'invitation' | 'review';
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
  invite: (prompt: string) => void;
  pendingSources: readonly PendingDiscussionContextSource[];
  phase: DiscussionContextSelectionPhase;
  prepare: (options: PrepareDiscussionContextOptions) => void;
  prompt: string;
  removeSource: (kind: PendingDiscussionContextKind, sourceId: string) => void;
  retrySubmission: () => void;
  review: () => void;
  selection: DiscussionContextSelectionInput;
  submissionFailed: (message: string) => void;
}

function emptyState(projectId: string): DiscussionContextSelectionState {
  return {
    bubbleSources: [],
    documentSources: [],
    entryPoint: 'write_first',
    error: null,
    phase: 'idle',
    projectId,
    prompt: '',
    returnPhase: 'invitation',
  };
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
        const hasPendingSources =
          scoped.bubbleSources.length + scoped.documentSources.length > 0;

        return {
          ...scoped,
          error: null,
          phase:
            kind === 'bubble'
              ? 'selecting_bubbles'
              : 'selecting_documents',
          returnPhase: hasPendingSources ? 'review' : 'invitation',
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

        return {
          ...scoped,
          ...(kind === 'bubble'
            ? { bubbleSources: normalized }
            : { documentSources: normalized }),
          error: null,
          phase: 'review',
          returnPhase: 'review',
        };
      });
    },
    [projectId],
  );

  const review = useCallback(() => {
    setStoredState((current) =>
      current.projectId === projectId
        ? { ...current, error: null, phase: 'review' }
        : current,
    );
  }, [projectId]);

  const backToInvitation = useCallback(() => {
    setStoredState((current) =>
      current.projectId === projectId
        ? { ...current, error: null, phase: 'invitation' }
        : current,
    );
  }, [projectId]);

  const removeSource = useCallback(
    (kind: PendingDiscussionContextKind, sourceId: string) => {
      setStoredState((current) => {
        if (current.projectId !== projectId) {
          return current;
        }

        return kind === 'bubble'
          ? {
              ...current,
              bubbleSources: current.bubbleSources.filter(
                ({ id }) => id !== sourceId,
              ),
            }
          : {
              ...current,
              documentSources: current.documentSources.filter(
                ({ id }) => id !== sourceId,
              ),
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
          phase: 'submitting',
        };
      });
    },
    [projectId],
  );

  const submissionFailed = useCallback(
    (message: string) => {
      setStoredState((current) =>
        current.projectId === projectId && current.phase === 'submitting'
          ? {
              ...current,
              error: message,
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
      invite,
      pendingSources,
      phase: state.phase,
      prepare,
      prompt: state.prompt,
      removeSource,
      retrySubmission,
      review,
      selection,
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
      state.phase,
      state.prompt,
      submissionFailed,
    ],
  );
}

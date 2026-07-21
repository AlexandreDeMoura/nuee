import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, CircleHelp, LoaderCircle, RotateCcw } from 'lucide-react';
import {
  updateProjectDescription,
  type Project,
  type UpdateProjectDescriptionInput,
} from '../api';

const DESCRIPTION_LIMIT = 280;
const DEFAULT_SAVE_DELAY_MS = 600;

export type ProjectDescriptionSaveStatus = 'dirty' | 'saving' | 'saved' | 'error';

export type ProjectDescriptionUpdateRequest = (
  projectId: string,
  input: UpdateProjectDescriptionInput,
  signal?: AbortSignal,
) => Promise<Project>;

export interface ProjectDescriptionEditorProps {
  project: Project;
  onProjectSaved: (project: Project) => void;
  onStatusChange?: (status: ProjectDescriptionSaveStatus) => void;
  requestUpdate?: ProjectDescriptionUpdateRequest;
  saveDelayMs?: number;
}

const focusRing =
  '[-webkit-tap-highlight-color:transparent] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/30';

const statusPresentation: Record<
  ProjectDescriptionSaveStatus,
  { label: string; classes: string }
> = {
  dirty: { label: 'UNSAVED', classes: 'text-[#a27439]' },
  saving: { label: 'SAVING', classes: 'text-[#3f63a8]' },
  saved: { label: 'SAVED', classes: 'text-[#5c9a6b]' },
  error: { label: 'SAVE FAILED', classes: 'text-[#b4544e]' },
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function ProjectDescriptionEditor({
  project,
  onProjectSaved,
  onStatusChange,
  requestUpdate = updateProjectDescription,
  saveDelayMs = DEFAULT_SAVE_DELAY_MS,
}: ProjectDescriptionEditorProps) {
  const [draft, setDraft] = useState(project.description);
  const [persistedDescription, setPersistedDescription] = useState(project.description);
  const [status, setStatus] = useState<ProjectDescriptionSaveStatus>('saved');
  const [isSaving, setIsSaving] = useState(false);
  const [failedDraft, setFailedDraft] = useState<string | null>(null);
  const draftRef = useRef(draft);
  const statusRef = useRef<ProjectDescriptionSaveStatus>('saved');
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const onProjectSavedRef = useRef(onProjectSaved);
  const onStatusChangeRef = useRef(onStatusChange);

  const normalizedDraft = draft.trim();
  const isDescriptionEmpty = normalizedDraft.length === 0;
  const isDescriptionTooLong = draft.length > DESCRIPTION_LIMIT;
  const isDescriptionValid = !isDescriptionEmpty && !isDescriptionTooLong;
  const presentedStatus = statusPresentation[status];

  useEffect(() => {
    onProjectSavedRef.current = onProjectSaved;
  }, [onProjectSaved]);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      activeControllerRef.current?.abort();
    };
  }, []);

  const publishStatus = useCallback((nextStatus: ProjectDescriptionSaveStatus) => {
    if (statusRef.current === nextStatus) {
      return;
    }

    statusRef.current = nextStatus;
    setStatus(nextStatus);
    onStatusChangeRef.current?.(nextStatus);
  }, []);

  const saveDraft = useCallback(
    async (submittedDraft: string) => {
      const description = submittedDraft.trim();

      if (!description || description === persistedDescription || activeControllerRef.current) {
        return;
      }

      const controller = new AbortController();
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      activeControllerRef.current = controller;
      setIsSaving(true);
      setFailedDraft(null);
      publishStatus('saving');

      try {
        const updatedProject = await requestUpdate(
          project.id,
          { description },
          controller.signal,
        );

        if (!mountedRef.current || requestId !== requestIdRef.current) {
          return;
        }

        setPersistedDescription(updatedProject.description);
        onProjectSavedRef.current(updatedProject);

        if (draftRef.current.trim() === updatedProject.description) {
          draftRef.current = updatedProject.description;
          setDraft(updatedProject.description);
          publishStatus('saved');
        } else {
          publishStatus('dirty');
        }
      } catch (error: unknown) {
        if (
          !mountedRef.current ||
          requestId !== requestIdRef.current ||
          isAbortError(error)
        ) {
          return;
        }

        setFailedDraft(submittedDraft);
        publishStatus(draftRef.current === submittedDraft ? 'error' : 'dirty');
      } finally {
        if (mountedRef.current && requestId === requestIdRef.current) {
          activeControllerRef.current = null;
          setIsSaving(false);
        }
      }
    },
    [persistedDescription, project.id, publishStatus, requestUpdate],
  );

  useEffect(() => {
    if (!isDescriptionValid) {
      if (!isSaving) {
        publishStatus('dirty');
      }
      return;
    }

    if (normalizedDraft === persistedDescription) {
      if (!isSaving) {
        publishStatus('saved');
      }
      return;
    }

    if (isSaving || failedDraft === draft) {
      return;
    }

    publishStatus('dirty');
    const timeoutId = window.setTimeout(() => {
      void saveDraft(draft);
    }, saveDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    draft,
    failedDraft,
    isDescriptionValid,
    isSaving,
    normalizedDraft,
    persistedDescription,
    publishStatus,
    saveDelayMs,
    saveDraft,
  ]);

  const handleRetry = () => {
    if (isSaving || !isDescriptionValid) {
      return;
    }

    setFailedDraft(null);
    void saveDraft(draftRef.current);
  };

  return (
    <div className="flex flex-1 flex-col p-[18px]">
      <div className="mb-2 flex items-center gap-2">
        <label
          className="text-[10px] font-medium tracking-[0.06em] text-[#9aa6b4] uppercase [font-family:'IBM_Plex_Mono',ui-monospace,monospace]"
          htmlFor="project-description"
        >
          Project description
        </label>
        <span
          className={`ml-auto inline-flex items-center gap-1.5 text-[9.5px] font-semibold tracking-[0.05em] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${presentedStatus.classes}`}
          aria-live="polite"
        >
          {status === 'saving' && (
            <LoaderCircle
              className="size-[11px] animate-spin motion-reduce:animate-none"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          )}
          {status === 'saved' && (
            <CircleCheck className="size-[11px]" strokeWidth={1.9} aria-hidden="true" />
          )}
          {status === 'error' && (
            <CircleAlert className="size-[11px]" strokeWidth={1.9} aria-hidden="true" />
          )}
          {presentedStatus.label}
        </span>
      </div>

      <textarea
        className={`min-h-[132px] w-full resize-y rounded-[10px] border bg-[#fafbfc] p-3 text-[12.5px] leading-[1.6] text-[#3a4453] placeholder:text-[#b6c0cc] ${focusRing} ${
          status === 'error' || !isDescriptionValid
            ? 'border-[#e6c7c4] focus:border-[#b4544e]'
            : 'border-[#e1e6ec] focus:border-[#3f63a8]'
        }`}
        id="project-description"
        name="description"
        value={draft}
        maxLength={DESCRIPTION_LIMIT}
        rows={6}
        required
        aria-invalid={!isDescriptionValid || status === 'error'}
        aria-describedby="project-description-feedback project-description-context"
        onChange={(event) => {
          const nextDraft = event.target.value;
          draftRef.current = nextDraft;
          setDraft(nextDraft);

          if (failedDraft !== null) {
            setFailedDraft(null);
          }

          if (!isSaving) {
            publishStatus('dirty');
          }
        }}
      />

      <div className="mt-2 flex min-h-[18px] items-start gap-2">
        <div className="min-w-0 flex-1" id="project-description-feedback">
          {isDescriptionEmpty && (
            <p className="m-0 flex items-center gap-1 text-[11px] text-[#b4544e]" role="alert">
              <CircleAlert className="size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
              A project description is required.
            </p>
          )}
          {isDescriptionTooLong && (
            <p className="m-0 flex items-center gap-1 text-[11px] text-[#b4544e]" role="alert">
              <CircleAlert className="size-3 shrink-0" strokeWidth={2} aria-hidden="true" />
              The description must be {DESCRIPTION_LIMIT} characters or fewer.
            </p>
          )}
          {isDescriptionValid && status === 'dirty' && (
            <p className="m-0 text-[10.5px] text-[#9a7a4d]">Changes waiting to save…</p>
          )}
          {status === 'saving' && (
            <p className="m-0 text-[10.5px] text-[#7286ad]">Saving your changes…</p>
          )}
          {status === 'saved' && (
            <p className="m-0 text-[10.5px] text-[#8b97a6]">All changes saved.</p>
          )}
        </div>
        <span
          className={`shrink-0 text-[10px] font-medium [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${
            isDescriptionTooLong ? 'text-[#b4544e]' : 'text-[#9aa6b4]'
          }`}
        >
          {draft.length} / {DESCRIPTION_LIMIT}
        </span>
      </div>

      {status === 'error' && (
        <div
          className="mt-2.5 rounded-[9px] border border-[#ecd4d1] bg-[#fbf1f0] p-3"
          role="alert"
        >
          <p className="m-0 text-xs font-semibold text-[#a44a44]">
            Couldn’t save the description
          </p>
          <p className="mt-1 mb-2.5 text-[11px] leading-[1.45] text-[#b06b66]">
            Your unsaved draft is still here. Check your connection and try again.
          </p>
          <button
            className={`inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-[8px] border border-[#e2c0bc] bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-[#a44a44] hover:bg-[#fdf8f8] ${focusRing}`}
            type="button"
            onClick={handleRetry}
          >
            <RotateCcw className="size-[13px]" strokeWidth={1.8} aria-hidden="true" />
            Retry save
          </button>
        </div>
      )}

      <p
        className="mt-4 mb-0 flex items-start gap-1.5 text-[11px] leading-[1.5] text-[#8b97a6]"
        id="project-description-context"
      >
        <CircleHelp className="mt-px size-[13px] shrink-0" strokeWidth={1.7} aria-hidden="true" />
        Changes apply to new discussions. Existing discussion context stays unchanged.
      </p>
    </div>
  );
}

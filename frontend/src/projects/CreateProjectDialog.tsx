import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  FormEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import {
  CircleAlert,
  CircleHelp,
  FileText,
  LoaderCircle,
  RotateCcw,
  X,
} from 'lucide-react';
import {
  createProject,
  getDocumentUploadPolicy,
  type CreateProjectInput,
  type DocumentUploadPolicy,
  type Project,
} from '../api';
import { analytics, trackAnalytics, type AnalyticsClient } from '../analytics';
import {
  documentPolicyDescription,
  documentPolicyExtensions,
  formatDocumentSize,
} from '../documents';
import { focusRing } from '../ui/focusRing';
import { useFieldValidity } from '../ui/useFieldValidity';
import { useModalShell } from '../ui/useModalShell';

const DESCRIPTION_LIMIT = 280;

const fieldClasses =
  `w-full rounded-[9px] border bg-white px-3 py-2.5 text-[13px] text-[#1e2733] placeholder:text-[#b6c0cc] disabled:cursor-not-allowed disabled:border-[#eef1f5] disabled:bg-[#fafbfc] disabled:text-[#8b97a6] ${focusRing}`;

type CreateProjectRequest = (input: CreateProjectInput) => Promise<Project>;
type DocumentPolicyRequest = (
  signal?: AbortSignal,
) => Promise<DocumentUploadPolicy>;

export interface CreateProjectDialogProps {
  onCancel: () => void;
  onCreated: (project: Project, documentFiles?: readonly File[]) => void;
  requestCreate?: CreateProjectRequest;
  requestDocumentPolicy?: DocumentPolicyRequest;
  analyticsClient?: AnalyticsClient;
}

export function CreateProjectDialog({
  onCancel,
  onCreated,
  requestCreate = createProject,
  requestDocumentPolicy = getDocumentUploadPolicy,
  analyticsClient = analytics,
}: CreateProjectDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [hasCreateError, setHasCreateError] = useState(false);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [documentPolicy, setDocumentPolicy] =
    useState<DocumentUploadPolicy | null>(null);
  const [documentPolicyError, setDocumentPolicyError] = useState(false);
  const [documentPolicyRequestKey, setDocumentPolicyRequestKey] = useState(0);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const isCreatingRef = useRef(false);

  const normalizedTitle = title.trim();
  const normalizedDescription = description.trim();
  const isValid = normalizedTitle.length > 0 && normalizedDescription.length > 0;
  const { containerRef, isClosing } = useModalShell({
    onEscape: () => {
      if (!isCreatingRef.current) {
        onCancel();
      }
    },
    initialFocus: () => titleInputRef.current,
  });
  const fields = useFieldValidity(
    {
      title: normalizedTitle.length === 0,
      description: normalizedDescription.length === 0,
    },
    { isSuppressed: isClosing },
  );
  const titleError = fields.showError.title;
  const descriptionError = fields.showError.description;
  const hasVisibleError = titleError || descriptionError;
  const documentAccept = useMemo(
    () =>
      documentPolicy
        ? documentPolicyExtensions(documentPolicy).join(',')
        : '',
    [documentPolicy],
  );

  useEffect(() => {
    const controller = new AbortController();

    requestDocumentPolicy(controller.signal)
      .then((policy) => {
        if (!controller.signal.aborted) {
          setDocumentPolicy(policy);
        }
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          return;
        }

        setDocumentPolicyError(true);
      });

    return () => controller.abort();
  }, [documentPolicyRequestKey, requestDocumentPolicy]);

  const handleBackdropMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !isCreatingRef.current) {
      onCancel();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isValid || isCreatingRef.current) {
      fields.revealAll();
      return;
    }

    isCreatingRef.current = true;
    setIsCreating(true);
    setHasCreateError(false);

    try {
      const project = await requestCreate({
        title: normalizedTitle,
        description: normalizedDescription,
      });

      isCreatingRef.current = false;
      setIsCreating(false);
      trackAnalytics(analyticsClient, 'project_created', { project_id: project.id });
      if (documentFiles.length > 0) {
        onCreated(project, documentFiles);
      } else {
        onCreated(project);
      }
    } catch {
      isCreatingRef.current = false;
      setIsCreating(false);
      setHasCreateError(true);
    }
  };

  const handleDocumentsSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';

    if (files.length > 0) {
      setDocumentFiles((current) => [...current, ...files]);
    }
  };

  const clearCreateError = () => {
    if (hasCreateError) {
      setHasCreateError(false);
    }
  };

  const inputBorderClasses = (hasError: boolean) =>
    hasError
      ? 'border-[#e6c7c4] bg-[#fdf8f8] focus:border-[#b4544e]'
      : 'border-[#dbe1e9] focus:border-[#3f63a8]';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1e2733]/45 p-4 backdrop-blur-[1.5px]"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        className="w-full max-w-[456px] overflow-hidden rounded-2xl border border-[#e1e6ec] bg-white shadow-[0_24px_60px_-18px_rgba(20,28,40,0.55)]"
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-project-title"
        aria-describedby="create-project-description"
        aria-busy={isCreating}
        tabIndex={-1}
      >
        <form noValidate onSubmit={handleSubmit}>
          <div className="px-5 pt-5 pb-[18px] sm:px-6 sm:pt-[22px]">
            <div className="mb-1.5 flex items-center gap-3">
              <h2
                className="m-0 text-[17px] font-semibold tracking-[-0.2px] text-[#1e2733]"
                id="create-project-title"
              >
                New project
              </h2>
              <span
                className={`ml-auto shrink-0 text-[9.5px] font-medium tracking-[0.06em] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${
                  isCreating
                    ? 'inline-flex items-center gap-1.5 text-[#3f63a8]'
                    : !hasVisibleError
                      ? 'text-[#b6c0cc]'
                      : 'rounded-[5px] bg-[#f7ecec] px-[7px] py-[3px] text-[#b4544e]'
                }`}
                aria-live="polite"
              >
                {isCreating && (
                  <LoaderCircle
                    className="size-[11px] animate-spin motion-reduce:animate-none"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                )}
                {isCreating
                  ? 'CREATING'
                  : isValid
                    ? documentFiles.length > 0
                      ? `${documentFiles.length} ${documentFiles.length === 1 ? 'DOCUMENT' : 'DOCUMENTS'}`
                      : '2 FIELDS · NO DOCUMENTS'
                    : 'INCOMPLETE'}
              </span>
            </div>

            <p
              className="mt-0 mb-5 text-[12.5px] leading-[1.5] text-[#8b97a6]"
              id="create-project-description"
            >
              Just enough to start thinking. Nothing is pre-filled and no goals are assumed.
            </p>

            {hasCreateError && (
              <div
                className="mb-4 flex items-start gap-2.5 rounded-[9px] border border-[#ecd4d1] bg-[#fbf1f0] px-3 py-2.5"
                role="alert"
              >
                <CircleAlert
                  className="mt-px size-[15px] shrink-0 text-[#b4544e]"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
                <div>
                  <p className="m-0 text-xs font-semibold text-[#a44a44]">
                    Couldn’t create the project
                  </p>
                  <p className="mt-0.5 mb-0 text-[11px] leading-[1.45] text-[#b06b66]">
                    The server didn’t respond. Your title and description are safe below — try again.
                  </p>
                </div>
              </div>
            )}

            <label
              className="mb-[7px] flex items-center gap-1 text-[11.5px] font-semibold text-[#3a4453]"
              htmlFor="create-project-name"
            >
              Title <span className="text-[#b4544e]">*</span>
            </label>
            <input
              className={`${fieldClasses} ${inputBorderClasses(titleError)} mb-1`}
              id="create-project-name"
              ref={titleInputRef}
              name="title"
              type="text"
              value={title}
              placeholder="Name your project…"
              disabled={isCreating}
              required
              aria-invalid={titleError}
              aria-describedby={titleError ? 'create-project-name-error' : undefined}
              onBlur={() => fields.markTouched('title')}
              onChange={(event) => {
                setTitle(event.target.value);
                clearCreateError();
              }}
            />
            <p
              className={`mt-1 mb-3.5 flex min-h-4 items-center gap-1 text-[11px] text-[#b4544e] ${
                titleError ? 'visible' : 'invisible'
              }`}
              id="create-project-name-error"
            >
              <CircleAlert className="size-3" strokeWidth={2} aria-hidden="true" />
              A title is required.
            </p>

            <label
              className="mb-[7px] flex items-center gap-1 text-[11.5px] font-semibold text-[#3a4453]"
              htmlFor="create-project-summary"
            >
              Short description <span className="text-[#b4544e]">*</span>
              <span className="ml-auto text-[10px] font-medium text-[#9aa6b4] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
                {description.length} / {DESCRIPTION_LIMIT}
              </span>
            </label>
            <textarea
              className={`${fieldClasses} ${inputBorderClasses(descriptionError)} min-h-16 resize-y leading-[1.55]`}
              id="create-project-summary"
              name="description"
              value={description}
              placeholder="What are you exploring?"
              disabled={isCreating}
              required
              maxLength={DESCRIPTION_LIMIT}
              rows={3}
              aria-invalid={descriptionError}
              aria-describedby={
                descriptionError
                  ? 'create-project-summary-error create-project-context-hint'
                  : 'create-project-context-hint'
              }
              onBlur={() => fields.markTouched('description')}
              onChange={(event) => {
                setDescription(event.target.value);
                clearCreateError();
              }}
            />
            {descriptionError && (
              <p
                className="mt-[7px] mb-0 flex items-center gap-1 text-[11px] text-[#b4544e]"
                id="create-project-summary-error"
              >
                <CircleAlert className="size-3" strokeWidth={2} aria-hidden="true" />
                A short description is required.
              </p>
            )}
            <p
              className="mt-[9px] mb-0 flex items-start gap-1.5 text-[11px] leading-[1.4] text-[#8b97a6]"
              id="create-project-context-hint"
            >
              <CircleHelp className="mt-px size-[13px] shrink-0" strokeWidth={1.7} aria-hidden="true" />
              Captured as context in every discussion. You can edit it anytime from the Project panel.
            </p>

            <div className="mt-5 border-t border-[#eef1f5] pt-4">
              <div className="mb-2 flex items-baseline gap-2">
                <label
                  className="text-[11.5px] font-semibold text-[#3a4453]"
                  htmlFor="create-project-documents"
                >
                  Documents <span className="font-normal text-[#9aa6b4]">(optional)</span>
                </label>
                {documentFiles.length > 0 && (
                  <span className="ml-auto text-[10px] font-medium text-[#7b8899] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
                    {documentFiles.length} selected
                  </span>
                )}
              </div>
              <input
                className="sr-only"
                accept={documentAccept}
                aria-describedby="create-project-documents-hint"
                disabled={isCreating || !documentPolicy}
                id="create-project-documents"
                multiple
                ref={documentInputRef}
                type="file"
                onChange={handleDocumentsSelected}
              />
              <button
                className={`inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-[9px] border border-dashed border-[#cdd8ea] bg-[#f8faff] px-3 py-2 text-[12px] font-semibold text-[#3f63a8] hover:border-[#aebed8] hover:bg-[#f1f5fc] disabled:cursor-not-allowed disabled:border-[#e4e9ef] disabled:bg-[#fafbfc] disabled:text-[#9aa6b4] ${focusRing}`}
                type="button"
                disabled={isCreating || !documentPolicy}
                onClick={() => documentInputRef.current?.click()}
              >
                <FileText className="size-[14px]" strokeWidth={1.8} aria-hidden="true" />
                Choose documents
              </button>
              <p
                className="mt-2 mb-0 text-[10.5px] leading-[1.45] text-[#8b97a6]"
                id="create-project-documents-hint"
              >
                {documentPolicy
                  ? `${documentPolicyDescription(documentPolicy)}. Uploads start after the project is created.`
                  : documentPolicyError
                    ? 'Upload requirements are unavailable. You can add documents from the project later.'
                    : 'Loading supported formats and upload limit…'}
              </p>
              {documentPolicyError && (
                <button
                  className={`mt-2 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-[11px] font-semibold text-[#8d4944] hover:bg-[#f8e7e5] ${focusRing}`}
                  type="button"
                  disabled={isCreating}
                  onClick={() => {
                    setDocumentPolicyError(false);
                    setDocumentPolicyRequestKey((key) => key + 1);
                  }}
                >
                  <RotateCcw className="size-3" strokeWidth={1.8} aria-hidden="true" />
                  Retry upload requirements
                </button>
              )}
              {documentFiles.length > 0 && (
                <ul className="mt-3 max-h-28 space-y-1.5 overflow-y-auto" aria-label="Selected documents">
                  {documentFiles.map((file, index) => (
                    <li
                      className="flex items-center gap-2 rounded-lg border border-[#e7ebf0] bg-[#fafbfc] px-2.5 py-2"
                      key={`${file.name}:${file.size}:${file.lastModified}:${index}`}
                    >
                      <FileText className="size-3.5 shrink-0 text-[#7182a0]" strokeWidth={1.7} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-[11px] text-[#4d5968]">
                        {file.name}
                      </span>
                      <span className="shrink-0 text-[9.5px] text-[#9aa6b4] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
                        {formatDocumentSize(file.size)}
                      </span>
                      <button
                        className={`shrink-0 rounded p-0.5 text-[#8b97a6] hover:bg-[#eef1f5] hover:text-[#5c6a7a] ${focusRing}`}
                        type="button"
                        aria-label={`Remove ${file.name}`}
                        disabled={isCreating}
                        onClick={() =>
                          setDocumentFiles((current) =>
                            current.filter((_, fileIndex) => fileIndex !== index),
                          )
                        }
                      >
                        <X className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5 border-t border-[#eef1f5] bg-[#fafbfc] px-5 py-3.5 sm:px-6">
            <span className="mr-auto hidden text-[10.5px] font-medium text-[#b6c0cc] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] sm:inline">
              {isCreating ? 'Creation in progress' : 'ESC to cancel'}
            </span>
            <button
              className={`min-h-9 rounded-[9px] border border-[#e1e6ec] bg-white px-[15px] py-2 text-[12.5px] font-semibold text-[#5c6a7a] disabled:cursor-not-allowed disabled:border-[#eef1f5] disabled:text-[#c4cdd8] ${focusRing}`}
              type="button"
              disabled={isCreating}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className={`inline-flex min-h-9 items-center justify-center gap-[7px] rounded-[9px] bg-[#3f63a8] px-[18px] py-2 text-[12.5px] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(63,99,168,0.7)] hover:bg-[#33538f] disabled:cursor-not-allowed disabled:bg-[#c4cdd8] disabled:shadow-none ${focusRing}`}
              type="submit"
              disabled={!isValid || isCreating}
            >
              {isCreating && (
                <LoaderCircle
                  className="size-3 animate-spin motion-reduce:animate-none"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              )}
              {isCreating ? 'Creating…' : hasCreateError ? 'Try again' : 'Create project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

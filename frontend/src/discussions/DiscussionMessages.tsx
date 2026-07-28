import { AlertCircle, LoaderCircle, MessageSquare } from 'lucide-react';
import type { DiscussionDetails, DiscussionMessage } from '../api';
import type { PendingDiscussionTurn } from './useDiscussionLifecycle';

interface DiscussionMessagesProps {
  details: DiscussionDetails | null;
  loadError: string | null;
  loadStatus: 'draft' | 'loading' | 'ready' | 'error';
  onRetry: (turn: PendingDiscussionTurn) => void;
  pendingTurn: PendingDiscussionTurn | null;
}

function unansweredTurn(
  message: DiscussionMessage,
): PendingDiscussionTurn | null {
  return message.role === 'user' &&
    (message.status === 'pending' || message.status === 'failed') &&
    message.request_id
    ? {
        content: message.content,
        discussionId: message.discussion_id,
        requestId: message.request_id,
        status: message.status,
      }
    : null;
}

function ResponseStatus({
  onRetry,
  turn,
}: {
  onRetry: (turn: PendingDiscussionTurn) => void;
  turn: PendingDiscussionTurn;
}) {
  if (turn.status === 'pending') {
    return (
      <div
        className="ml-1 flex items-center gap-2 text-[11.5px] text-[#728096]"
        role="status"
      >
        <LoaderCircle
          className="size-3.5 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        Generating a focused response…
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-[#efd5d2] bg-[#fff8f7] px-3.5 py-3 text-[#8f3f3a]"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertCircle
          className="mt-0.5 size-4 shrink-0"
          strokeWidth={1.8}
          aria-hidden="true"
        />
        <div>
          <p className="text-[12px] font-semibold">Response failed</p>
          <p className="mt-0.5 text-[11.5px] leading-[1.45] text-[#a25a55]">
            Your message was saved. Retry this response without adding another
            copy of the message.
          </p>
          <button
            className="mt-2 cursor-pointer rounded-[7px] border border-[#e4bdb9] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#8f3f3a] hover:bg-[#fff2f0] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#a64540]/25"
            type="button"
            onClick={() => onRetry(turn)}
          >
            Retry response
          </button>
        </div>
      </div>
    </div>
  );
}

function Message({
  message,
}: {
  message: DiscussionMessage;
}) {
  const isUser = message.role === 'user';

  return (
    <article
      className={isUser ? 'ml-auto max-w-[82%]' : 'mr-auto w-full max-w-[92%]'}
      aria-label={isUser ? 'Your message' : 'AI response'}
      data-message-id={message.id}
      data-message-role={message.role}
    >
      <p
        className={
          isUser
            ? 'whitespace-pre-wrap rounded-2xl rounded-br-[6px] bg-[#3f63a8] px-4 py-3 text-[13px] leading-[1.55] text-white'
            : 'whitespace-pre-wrap text-[13px] leading-[1.65] text-[#344050]'
        }
      >
        {message.content}
      </p>
    </article>
  );
}

function EmptyDiscussion() {
  return (
    <div className="m-auto max-w-[380px] py-8 text-center">
      <span className="mx-auto mb-3.75 grid size-11.5 place-items-center rounded-[13px] bg-[#eef2fa] text-[#3f63a8]">
        <MessageSquare
          className="size-5.25"
          strokeWidth={1.6}
          aria-hidden="true"
        />
      </span>
      <p className="text-[16px] font-semibold text-[#1e2733]">
        Ask one focused question
      </p>
      <p className="mt-1.5 text-[12.5px] leading-[1.55] text-[#8b97a6]">
        Answers stay short by default. When something&apos;s worth keeping,
        extract it as a bubble — the thread stays as reasoning history.
      </p>
    </div>
  );
}

export function DiscussionMessages({
  details,
  loadError,
  loadStatus,
  onRetry,
  pendingTurn,
}: DiscussionMessagesProps) {
  if (loadStatus === 'loading') {
    return (
      <div className="m-auto flex items-center gap-2 text-[12px] text-[#728096]" role="status">
        <LoaderCircle
          className="size-4 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        Loading discussion…
      </div>
    );
  }

  if (loadStatus === 'error') {
    return (
      <div className="m-auto max-w-[360px] text-center" role="alert">
        <AlertCircle
          className="mx-auto size-5 text-[#a64540]"
          aria-hidden="true"
        />
        <p className="mt-2 text-[13px] font-semibold text-[#7d3935]">
          Discussion unavailable
        </p>
        <p className="mt-1 text-[11.5px] leading-[1.5] text-[#9d5c57]">
          {loadError ?? 'The discussion could not be loaded.'}
        </p>
      </div>
    );
  }

  const messages = details?.messages ?? [];
  const hasPendingInDetails =
    pendingTurn !== null &&
    messages.some(
      (message) =>
        message.role === 'user' &&
        message.request_id === pendingTurn.requestId,
    );

  if (messages.length === 0 && pendingTurn === null) {
    return <EmptyDiscussion />;
  }

  return (
    <div className="flex flex-col gap-5" aria-label="Discussion messages">
      {messages.map((message) => {
        const persistedTurn = unansweredTurn(message);
        const turn =
          persistedTurn &&
          pendingTurn?.requestId === persistedTurn.requestId
            ? pendingTurn
            : persistedTurn;

        return (
          <div className="contents" key={message.id}>
            <Message message={message} />
            {turn && <ResponseStatus onRetry={onRetry} turn={turn} />}
          </div>
        );
      })}
      {pendingTurn && !hasPendingInDetails && (
        <>
          <Message
            message={{
              id: `optimistic:${pendingTurn.requestId}`,
              discussion_id: pendingTurn.discussionId ?? 'draft',
              role: 'user',
              content: pendingTurn.content,
              created_at: new Date().toISOString(),
              status: pendingTurn.status,
              request_id: pendingTurn.requestId,
            }}
          />
          <ResponseStatus onRetry={onRetry} turn={pendingTurn} />
        </>
      )}
    </div>
  );
}

import { AlertCircle, LoaderCircle, MessageSquare } from 'lucide-react';
import type { DiscussionDetails, DiscussionMessage } from '../api';
import {
  DiscussionKnowledgeAction,
  type DiscussionKnowledgeActionHandler,
} from './DiscussionKnowledgeAction';
import { RichResponse } from '../ui/RichResponse';
import { DiscussionMessageSources } from './DiscussionMessageSources';
import type { PendingDiscussionTurn } from './useDiscussionLifecycle';

interface DiscussionMessagesProps {
  details: DiscussionDetails | null;
  loadError: string | null;
  loadStatus: 'draft' | 'loading' | 'ready' | 'error';
  onExtractKnowledge?: DiscussionKnowledgeActionHandler;
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
        webSearch: false,
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
        className="ml-1.25 flex items-center gap-2.5 text-[14px] text-[#728096]"
        aria-atomic="true"
        role="status"
      >
        <LoaderCircle
          className="size-4.25 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        Generating a focused response…
      </div>
    );
  }

  const timedOut = turn.failureCode === 'AI_GENERATION_TIMEOUT';
  const failureTitle = timedOut ? 'Response timed out' : 'Response failed';
  const failureMessage = timedOut
    ? turn.webSearch
      ? 'Web search took longer than five minutes. Your message was saved and you can retry the response.'
      : 'The response took too long to generate. Your message was saved and you can retry it.'
    : 'Your message was saved. Retry this response without adding another copy of the message.';

  return (
    <div
      className="rounded-xl border border-[#efd5d2] bg-[#fff8f7] px-4.25 py-3.5 text-[#8f3f3a]"
      aria-atomic="true"
      role="alert"
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle
          className="mt-0.5 size-4.75 shrink-0"
          strokeWidth={1.8}
          aria-hidden="true"
        />
        <div>
          <p className="text-[14.5px] font-semibold">{failureTitle}</p>
          <p className="mt-0.5 text-[14px] leading-[1.45] text-[#a25a55]">
            {failureMessage}
          </p>
          <button
            className="mt-2.5 cursor-pointer rounded-[9px] border border-[#e4bdb9] bg-white px-3 py-1.25 text-[13px] font-semibold text-[#8f3f3a] hover:bg-[#fff2f0] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#a64540]/25"
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
  onExtractKnowledge,
}: {
  message: DiscussionMessage;
  onExtractKnowledge?: DiscussionKnowledgeActionHandler;
}) {
  const isUser = message.role === 'user';

  return (
    <article
      className={isUser ? 'ml-auto max-w-[82%]' : 'mr-auto w-full max-w-[92%]'}
      aria-label={isUser ? 'Your message' : 'AI response'}
      data-message-id={message.id}
      data-message-role={message.role}
    >
      {isUser ? (
        <p className="whitespace-pre-wrap rounded-2xl rounded-br-[7px] bg-[#3f63a8] px-4.75 py-3.5 text-[15.5px] leading-[1.55] text-white">
          {message.content}
        </p>
      ) : (
        <>
          <RichResponse content={message.content} />
          {message.web_search_used === true && (
            <DiscussionMessageSources citations={message.citations} />
          )}
          <div className="mt-3.5 border-t border-[#e8ecf1] pt-3">
            <DiscussionKnowledgeAction
              onExtract={onExtractKnowledge}
              source={{
                discussionId: message.discussion_id,
                messageId: message.id,
              }}
              variant="message"
            />
          </div>
        </>
      )}
    </article>
  );
}

function EmptyDiscussion() {
  return (
    <div className="m-auto max-w-[456px] py-9.5 text-center">
      <span className="mx-auto mb-4.5 grid size-13.75 place-items-center rounded-[16px] bg-[#eef2fa] text-[#3f63a8]">
        <MessageSquare
          className="size-6.25"
          strokeWidth={1.6}
          aria-hidden="true"
        />
      </span>
      <p className="text-[19px] font-semibold text-[#1e2733]">
        Ask one focused question
      </p>
      <p className="mt-1.75 text-[15px] leading-[1.55] text-[#8b97a6]">
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
  onExtractKnowledge,
  onRetry,
  pendingTurn,
}: DiscussionMessagesProps) {
  if (loadStatus === 'loading') {
    return (
      <div className="m-auto flex items-center gap-2.5 text-[14.5px] text-[#728096]" role="status">
        <LoaderCircle
          className="size-4.75 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        Loading discussion…
      </div>
    );
  }

  if (loadStatus === 'error') {
    return (
      <div className="m-auto max-w-[432px] text-center" role="alert">
        <AlertCircle
          className="mx-auto size-6 text-[#a64540]"
          aria-hidden="true"
        />
        <p className="mt-2.5 text-[15.5px] font-semibold text-[#7d3935]">
          Discussion unavailable
        </p>
        <p className="mt-1.25 text-[14px] leading-[1.5] text-[#9d5c57]">
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
    <div
      className="flex flex-col gap-6"
      aria-label="Discussion messages"
      aria-live="polite"
      aria-relevant="additions text"
      role="log"
    >
      {messages.map((message) => {
        const persistedTurn = unansweredTurn(message);
        const turn =
          persistedTurn &&
          pendingTurn?.requestId === persistedTurn.requestId
            ? pendingTurn
            : persistedTurn;

        return (
          <div className="contents" key={message.id}>
            <Message
              message={message}
              onExtractKnowledge={onExtractKnowledge}
            />
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
            onExtractKnowledge={onExtractKnowledge}
          />
          <ResponseStatus onRetry={onRetry} turn={pendingTurn} />
        </>
      )}
    </div>
  );
}

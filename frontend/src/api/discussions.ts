import type {
  CreateDiscussionInput,
  Discussion,
  DiscussionDetails,
  DiscussionListResponse,
  DiscussionMessage,
  DiscussionMessageStatus,
  DiscussionRole,
  DiscussionSummary,
  FrozenContext,
  SendMessageInput,
} from '@nuee/shared-types';
import { requestJson } from './client';

export type {
  CreateDiscussionInput,
  Discussion,
  DiscussionDetails,
  DiscussionListResponse,
  DiscussionMessage,
  DiscussionMessageStatus,
  DiscussionRole,
  DiscussionSummary,
  FrozenContext,
  SendMessageInput,
};

export type DiscussionRequest = typeof requestJson;

export function createDiscussionsApi(request: DiscussionRequest = requestJson) {
  function collectionPath(projectId: string): string {
    return `/projects/${encodeURIComponent(projectId)}/discussions`;
  }

  function resourcePath(projectId: string, discussionId: string): string {
    return `${collectionPath(projectId)}/${encodeURIComponent(discussionId)}`;
  }

  function createDiscussion(
    projectId: string,
    input: CreateDiscussionInput,
    signal?: AbortSignal,
  ): Promise<DiscussionDetails> {
    return request<DiscussionDetails>(collectionPath(projectId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    });
  }

  function getProjectDiscussions(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<DiscussionListResponse> {
    return request<DiscussionListResponse>(collectionPath(projectId), {
      signal,
    });
  }

  function getDiscussion(
    projectId: string,
    discussionId: string,
    signal?: AbortSignal,
  ): Promise<DiscussionDetails> {
    return request<DiscussionDetails>(
      resourcePath(projectId, discussionId),
      { signal },
    );
  }

  function requestMessage(
    projectId: string,
    discussionId: string,
    input: SendMessageInput,
    signal?: AbortSignal,
  ): Promise<DiscussionDetails> {
    return request<DiscussionDetails>(
      `${resourcePath(projectId, discussionId)}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal,
      },
    );
  }

  function sendDiscussionMessage(
    projectId: string,
    discussionId: string,
    input: SendMessageInput,
    signal?: AbortSignal,
  ): Promise<DiscussionDetails> {
    return requestMessage(projectId, discussionId, input, signal);
  }

  function retryDiscussionMessage(
    projectId: string,
    discussionId: string,
    input: SendMessageInput,
    signal?: AbortSignal,
  ): Promise<DiscussionDetails> {
    return requestMessage(projectId, discussionId, input, signal);
  }

  function generateDiscussionTitle(
    projectId: string,
    discussionId: string,
    signal?: AbortSignal,
  ): Promise<DiscussionDetails> {
    return request<DiscussionDetails>(
      `${resourcePath(projectId, discussionId)}/title`,
      {
        method: 'POST',
        signal,
      },
    );
  }

  function recordDiscussionOpen(
    projectId: string,
    discussionId: string,
    signal?: AbortSignal,
  ): Promise<DiscussionDetails> {
    return request<DiscussionDetails>(
      `${resourcePath(projectId, discussionId)}/open`,
      {
        method: 'POST',
        signal,
      },
    );
  }

  function deleteDiscussion(
    projectId: string,
    discussionId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return request<void>(resourcePath(projectId, discussionId), {
      method: 'DELETE',
      signal,
    });
  }

  return {
    createDiscussion,
    deleteDiscussion,
    generateDiscussionTitle,
    getDiscussion,
    getProjectDiscussions,
    recordDiscussionOpen,
    retryDiscussionMessage,
    sendDiscussionMessage,
  };
}

export const {
  createDiscussion,
  deleteDiscussion,
  generateDiscussionTitle,
  getDiscussion,
  getProjectDiscussions,
  recordDiscussionOpen,
  retryDiscussionMessage,
  sendDiscussionMessage,
} = createDiscussionsApi();

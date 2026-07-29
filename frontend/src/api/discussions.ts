import type {
  CreateDiscussionInput,
  Discussion,
  DiscussionDetails,
  DiscussionFrozenContext,
  DiscussionListResponse,
  DiscussionMessage,
  DiscussionMessageStatus,
  DiscussionRole,
  DiscussionSummary,
  FrozenContext,
  SendMessageInput,
} from '@nuee/shared-types';
import { requestJson } from './client';
import { assertDiscussionDetails } from './discussionResponse';

export {
  assertDiscussionDetails,
  isDiscussionDetails,
  isFrozenContextV1,
} from './discussionResponse';

export type {
  CreateDiscussionInput,
  Discussion,
  DiscussionDetails,
  DiscussionFrozenContext,
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
    return request<unknown>(collectionPath(projectId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    }).then((response) =>
      assertDiscussionDetails(response, projectId, undefined, input),
    );
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
    return request<unknown>(
      resourcePath(projectId, discussionId),
      { signal },
    ).then((response) =>
      assertDiscussionDetails(response, projectId, discussionId),
    );
  }

  function requestMessage(
    projectId: string,
    discussionId: string,
    input: SendMessageInput,
    signal?: AbortSignal,
  ): Promise<DiscussionDetails> {
    return request<unknown>(
      `${resourcePath(projectId, discussionId)}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal,
      },
    ).then((response) =>
      assertDiscussionDetails(response, projectId, discussionId),
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
    return request<unknown>(
      `${resourcePath(projectId, discussionId)}/title`,
      {
        method: 'POST',
        signal,
      },
    ).then((response) =>
      assertDiscussionDetails(response, projectId, discussionId),
    );
  }

  function recordDiscussionOpen(
    projectId: string,
    discussionId: string,
    signal?: AbortSignal,
  ): Promise<DiscussionDetails> {
    return request<unknown>(
      `${resourcePath(projectId, discussionId)}/open`,
      {
        method: 'POST',
        signal,
      },
    ).then((response) =>
      assertDiscussionDetails(response, projectId, discussionId),
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

import { request } from './client';
import { messagingPath } from './services';

/**
 * The three endpoints the brief asks for, plus the conversation they hang off.
 *
 * Every one of them takes a token: messaging authenticates on every request and
 * reads the tenant out of the claim, never out of a parameter. That is why none of
 * these functions has a `tenantId` argument — offering one would be offering a way
 * to ask for somebody else's data.
 */

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

export type Conversation = {
  id: string;
  participantIds: string[];
  createdAt: string;
  /** Only the create response carries it: every row of a list has the same one. */
  tenantId?: string;
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type SearchPage = Page<Message> & { total: number };

const path = (suffix: string): string => messagingPath(`/api/v1/${suffix}`);

export const listConversations = (
  token: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<Page<Conversation>> =>
  request<Page<Conversation>>(path('conversations'), {
    token,
    query: {
      limit: options.limit ? String(options.limit) : undefined,
      cursor: options.cursor,
    },
  });

export const createConversation = (
  token: string,
  participantIds: string[],
): Promise<Conversation> =>
  request<Conversation>(path('conversations'), {
    method: 'POST',
    token,
    body: { participantIds },
  });

export const sendMessage = (
  token: string,
  input: { conversationId: string; content: string; metadata?: Record<string, unknown> },
): Promise<Message> =>
  request<Message>(path('messages'), { method: 'POST', token, body: input });

export const listMessages = (
  token: string,
  conversationId: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<Page<Message>> =>
  request<Page<Message>>(path(`conversations/${conversationId}/messages`), {
    token,
    query: {
      limit: options.limit ? String(options.limit) : undefined,
      cursor: options.cursor,
    },
  });

export const searchMessages = (
  token: string,
  conversationId: string,
  q: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<SearchPage> =>
  request<SearchPage>(path(`conversations/${conversationId}/messages/search`), {
    token,
    query: {
      q,
      limit: options.limit ? String(options.limit) : undefined,
      cursor: options.cursor,
    },
  });

import { prefixRoutes } from '@/shared/routes.config';

export const ROUTES = {
  messages: 'messages',
  conversations: prefixRoutes('conversations', {
    index: '',
    messages: ':conversationId/messages',
    messagesSearch: ':conversationId/messages/search',
  }),
};

export const API_TAGS = {
  messages: 'Messages',
  conversations: 'Conversations',
};

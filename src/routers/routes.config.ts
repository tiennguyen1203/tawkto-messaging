type RouteConfigs = { [key: string]: string | RouteConfigs };

const prefixRoutes = <T extends RouteConfigs>(prefix: string, routes: T): T =>
  Object.fromEntries(
    Object.entries(routes).map(([key, value]) => {
      if (typeof value === 'string') {
        return [key, value ? `${prefix}/${value}` : prefix];
      }
      return [key, prefixRoutes(prefix, value)];
    }),
  ) as T;

export const ROUTES = {
  health: 'health',
  messages: 'messages',
  conversations: prefixRoutes('conversations', {
    index: '',
    messages: ':conversationId/messages',
    messagesSearch: ':conversationId/messages/search',
  }),
};

export const ROUTE_VERSION = {
  v1: '1',
};

export const API_TAGS = {
  health: 'Health',
  messages: 'Messages',
  conversations: 'Conversations',
};

/**
 * The one place that knows what the services put on the wire.
 *
 * Every response from both of them is wrapped —
 * `{ statusCode, message, data, timeStamp }` — so `data` is unwrapped here rather
 * than at each call site. That envelope has already caught out more than one
 * caller who reached straight for the field they wanted.
 *
 * A non-2xx becomes a thrown `ApiError` carrying the status and the server's own
 * message, so a page can tell "not found" from "the network is down" without
 * reading a response body.
 */

export type ApiEnvelope<T> = {
  statusCode: number;
  message: string;
  data: T;
  timeStamp: number;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Sent as `Authorization: Bearer …` when present. */
  token?: string;
  query?: Record<string, string | undefined>;
};

const withQuery = (path: string, query?: RequestOptions['query']): string => {
  if (!query) {
    return path;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, value);
    }
  }

  const serialised = params.toString();
  return serialised ? `${path}?${serialised}` : path;
};

/** Pulls the server's message out of a failure body, whatever shape it took. */
const messageFrom = (body: unknown, fallback: string): string => {
  if (body && typeof body === 'object' && 'message' in body) {
    const { message } = body as { message: unknown };
    if (typeof message === 'string') {
      return message;
    }
    // class-validator answers with an array of them, one per offending field.
    if (Array.isArray(message)) {
      return message.join(', ');
    }
  }

  return fallback;
};

export const request = async <T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> => {
  const response = await fetch(withQuery(path, options.query), {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  // Read the body once, whatever the status: a failure carries the message worth
  // showing, and a body read twice is a body read never.
  const raw: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      messageFrom(raw, `Request to ${path} failed with ${response.status}`),
      raw,
    );
  }

  return (raw as ApiEnvelope<T>).data;
};

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, request } from './client';

const respondWith = (status: number, body: unknown) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
};

describe('@api/client', () => {
  afterEach(() => vi.unstubAllGlobals());

  describe('when the service answers successfully', () => {
    it('should return what is inside the envelope, not the envelope', async () => {
      // Both services wrap every response. A caller reaching for `.id` on the
      // whole body gets undefined and no error, which is the failure this exists
      // to prevent.
      respondWith(200, {
        statusCode: 200,
        message: 'successful',
        data: { id: 'abc', name: 'Acme' },
        timeStamp: 1786800000000,
      });

      await expect(request('/api/v1/for-demo/tenants')).resolves.toEqual({
        id: 'abc',
        name: 'Acme',
      });
    });
  });

  describe('when the service answers with an error', () => {
    it('should throw an ApiError carrying the status and the server message', async () => {
      respondWith(404, {
        message: 'Tenant not found.',
        error: 'Not Found',
        statusCode: 404,
      });

      await expect(request('/api/v1/for-demo/users')).rejects.toMatchObject({
        name: 'ApiError',
        status: 404,
        message: 'Tenant not found.',
      });
    });

    it('should join the field errors class-validator returns as a list', async () => {
      // A 400 from the DTO layer answers with one message per offending field.
      // Showing `[object Object]` to a reviewer is how a validation message goes
      // unread.
      respondWith(400, {
        message: ['name should not be empty', 'name must be a string'],
        statusCode: 400,
      });

      await expect(request('/api/v1/for-demo/tenants')).rejects.toThrow(
        'name should not be empty, name must be a string',
      );
    });

    it('should still fail usefully when the body is not JSON', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 502,
          json: () => Promise.reject(new Error('not json')),
        }),
      );

      const thrown = await request('/api/health').catch((e: unknown) => e);

      expect(thrown).toBeInstanceOf(ApiError);
      expect((thrown as ApiError).status).toBe(502);
    });
  });

  describe('when a query is given', () => {
    it('should append only the values that are present', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { items: [] } }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await request('/api/v1/for-demo/users', {
        query: { tenantId: 'abc', cursor: undefined },
      });

      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        '/api/v1/for-demo/users?tenantId=abc',
      );
    });
  });

  describe('when a token is given', () => {
    it('should send it as a bearer credential', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: null }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await request('/api/v1/messages', { method: 'POST', body: {}, token: 'jwt' });

      const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
      expect(init.headers.Authorization).toBe('Bearer jwt');
      expect(init.headers['Content-Type']).toBe('application/json');
    });
  });
});

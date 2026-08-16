import { ref, type Ref } from 'vue';

import { ApiError } from './client';

export type RequestState<T> = {
  data: Ref<T | undefined>;
  error: Ref<string | undefined>;
  pending: Ref<boolean>;
  run: () => Promise<void>;
};

/**
 * The loading-and-error convention every page uses, so none of them writes its own
 * `try`/`catch` and forgets a branch.
 *
 * `error` is a string rather than the thrown value: a page renders a message, and
 * an `ApiError` already carries the one the server chose. Anything else — a
 * network failure, a bug — is reported as itself rather than swallowed into
 * "something went wrong".
 */
export const useRequest = <T>(fn: () => Promise<T>): RequestState<T> => {
  const data = ref<T>() as Ref<T | undefined>;
  const error = ref<string>();
  const pending = ref(false);

  const run = async (): Promise<void> => {
    pending.value = true;
    error.value = undefined;

    try {
      data.value = await fn();
    } catch (thrown) {
      error.value =
        thrown instanceof ApiError
          ? thrown.message
          : thrown instanceof Error
            ? thrown.message
            : String(thrown);
    } finally {
      pending.value = false;
    }
  };

  return { data, error, pending, run };
};

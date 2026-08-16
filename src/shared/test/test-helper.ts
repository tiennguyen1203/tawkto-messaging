import 'reflect-metadata';
import { Type } from '@nestjs/common';
import { faker } from '@faker-js/faker';
import { ProviderTestHelper } from './test-helper/provider-test-helper';
import { ControllerTestHelper } from './test-helper/controller-test-helper';
import { FullAppTestHelper } from './test-helper/full-app-test-helper';

function isController(target: Type): boolean {
  return !!Reflect.getMetadata('path', target);
}

/**
 * Three harnesses behind two entry points, because which of the two lightweight ones
 * you want is decided by what you passed, not by what you remember to ask for.
 *
 * **Lightweight** — scans the dependency tree and exposes only what is needed. A
 * controller gets `ControllerTestHelper`, which builds a minimal Nest app with the
 * real guard chain, filter and interceptor; anything else gets `ProviderTestHelper`,
 * which does not build an app at all:
 * ```ts
 * const testHelper = TestHelper.lightweightMode(MyUseCase);    // provider harness
 * const testHelper = TestHelper.lightweightMode(MyController); // controller harness
 * ```
 *
 * **Full app** — loads a service's whole module tree, and so catches the wiring
 * mistakes the other two cannot see:
 * ```ts
 * const testHelper = TestHelper.fullAppMode(AppModule);
 * ```
 */
export const TestHelper = {
  lightweightMode<T>(targetClass: Type<T>) {
    if (isController(targetClass)) {
      return new ControllerTestHelper(targetClass);
    }
    return new ProviderTestHelper(targetClass);
  },

  fullAppMode(rootModule: Type) {
    return new FullAppTestHelper(rootModule);
  },
};

export { ProviderTestHelper } from './test-helper/provider-test-helper';
export { ControllerTestHelper } from './test-helper/controller-test-helper';
export { FullAppTestHelper } from './test-helper/full-app-test-helper';

export const optionalValue = <T>(value: T): T | undefined | null =>
  faker.helpers.arrayElement([null, undefined, value]);

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
 * Test helper facade with three modes:
 *
 * **Lightweight** — scans and exposes only the dependencies actually needed:
 * ```ts
 * const testHelper = TestHelper.lightweightMode(MyUseCase);
 * const testHelper = TestHelper.lightweightMode(MyController);
 * ```
 *
 * **Full app** — loads the entire AppModule:
 * ```ts
 * const testHelper = TestHelper.fullAppMode();
 * ```
 */
export const TestHelper = {
  lightweightMode<T>(targetClass: Type<T>) {
    if (isController(targetClass)) {
      return new ControllerTestHelper(targetClass);
    }
    return new ProviderTestHelper(targetClass);
  },

  fullAppMode() {
    return new FullAppTestHelper();
  },
};

export { ProviderTestHelper } from './test-helper/provider-test-helper';
export { ControllerTestHelper } from './test-helper/controller-test-helper';
export { FullAppTestHelper } from './test-helper/full-app-test-helper';

export const optionalValue = <T>(value: T): T | undefined | null =>
  faker.helpers.arrayElement([null, undefined, value]);

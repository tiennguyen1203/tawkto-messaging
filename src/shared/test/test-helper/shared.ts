import { Logger, Type } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Connection } from 'mongoose';
import { AuthUserType, RoleEnum } from '@/shared/types/auth-user.type';
import { CachingService } from '@/shared/infra/caching/service';
import { DatabaseHelper } from '../database-helper';
import { TestClsService } from '../support/test-cls.service';
import request from '../supertest-helper';

/**
 * A real CachingService backed by an in-memory cache-manager store, so TTL and
 * expiry behave exactly as they do in production.
 */
export async function createRealCachingService(): Promise<CachingService> {
  const { createCache } = await import('cache-manager');
  return new CachingService(createCache());
}

/**
 * Classes replaced by a test double in every mode. Empty for now — this project
 * has no third-party integrations yet. Kafka and Elasticsearch clients land here
 * in M2/M3.
 */
export const DEFAULT_MOCKS: [Type, Type][] = [];

export type MockConfig = { provide: Type; useClass: Type };

export function createMockInstance(useClass: Type): any {
  try {
    return new useClass();
  } catch {
    // Walk the whole prototype chain so inherited methods are stubbed too.
    const instance: any = {};
    let proto = useClass.prototype;
    while (proto && proto !== Object.prototype) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (
          name !== 'constructor' &&
          typeof proto[name] === 'function' &&
          !(name in instance)
        ) {
          instance[name] = jest.fn();
        }
      }
      proto = Object.getPrototypeOf(proto);
    }
    return instance;
  }
}

type SelfDeclaredDep = { index: number; param: Type | string | symbol };

/**
 * Recursively instantiate a class by resolving its constructor dependencies.
 * Connection and ClsService are supplied directly; mocked classes are swapped for
 * their doubles; anything else is resolved recursively.
 */
export function resolveInstance(
  cls: Type,
  ctx: { connection: Connection; cls: TestClsService },
  mockMap: Map<Type, Type>,
  resolved = new Map<Type, any>(),
): any {
  if (resolved.has(cls)) return resolved.get(cls);

  const paramTypes: Type[] =
    Reflect.getMetadata('design:paramtypes', cls) || [];
  const selfDeps: SelfDeclaredDep[] =
    Reflect.getMetadata('self:paramtypes', cls) || [];
  const selfDepsMap = new Map(selfDeps.map((d) => [d.index, d.param]));

  const args = paramTypes.map((dep, i) => {
    const injectedToken = selfDepsMap.get(i);

    if (
      injectedToken &&
      (typeof injectedToken === 'string' || typeof injectedToken === 'symbol')
    ) {
      return undefined;
    }

    const actualDep =
      injectedToken && typeof injectedToken === 'function'
        ? (injectedToken as Type)
        : dep;

    if (!actualDep || actualDep.name === 'Object') return undefined;
    if (
      actualDep.name === 'Connection' ||
      actualDep.name === 'NativeConnection'
    )
      return ctx.connection;
    if (actualDep.name === 'ClsService') return ctx.cls;
    if (actualDep.name === 'Logger')
      return { log() {}, error() {}, warn() {}, debug() {}, verbose() {} };

    if (mockMap.has(actualDep)) {
      return createMockInstance(mockMap.get(actualDep)!);
    }

    return resolveInstance(actualDep, ctx, mockMap, resolved);
  });

  const instance = new cls(...args);
  resolved.set(cls, instance);
  return instance;
}

export function buildMockMap(overrides: MockConfig[]): Map<Type, Type> {
  const allMocks = new Map<Type, Type>(DEFAULT_MOCKS);
  for (const { provide, useClass } of overrides) {
    allMocks.set(provide, useClass);
  }
  return allMocks;
}

let userSeq = 0;

export abstract class BaseTestHelper<TUnit = any> {
  protected databaseHelper = new DatabaseHelper();
  protected mockConfigs: MockConfig[] = [];
  protected realProviders = new Set<Type>();
  protected tokenProviders = new Map<string | symbol | Type, any>();
  protected extraImports: any[] = [];
  protected testCls = new TestClsService();

  abstract get unit(): TUnit;
  abstract beforeAll(): Promise<void>;

  get request(): request.SuperTest {
    throw new Error(
      'request is not available in provider mode. Use controller or full app mode.',
    );
  }

  /** The CLS store the unit under test reads its tenant from. */
  get cls(): ClsService<any> {
    return this.testCls as unknown as ClsService<any>;
  }

  mock(provide: Type, useClass: Type): this {
    this.mockConfigs.push({ provide, useClass });
    return this;
  }

  real(...providers: Type[]): this {
    for (const p of providers) this.realProviders.add(p);
    return this;
  }

  /**
   * Hands the unit a dependency the scanner cannot build itself.
   *
   * Class tokens are accepted as well as string ones: a provider a module
   * configures through `useFactory` — the Elasticsearch `Client`, say — is
   * registered under its class but cannot be constructed by scanning, since the
   * factory is where its configuration lives.
   */
  provide(token: string | symbol | Type, value: any): this {
    this.tokenProviders.set(token, value);
    return this;
  }

  /**
   * Pulls a real Nest module into the test module — for units that depend on
   * providers a module configures rather than on plain classes (Terminus, for
   * instance). Whatever those modules export is removed from the scanned
   * provider list so the module's configured instance wins.
   *
   * Only meaningful in controller mode; provider mode has no Nest module to
   * import into.
   */
  imports(...modules: any[]): this {
    this.extraImports.push(...modules);
    return this;
  }

  /**
   * Pins the ambient tenant for the code under test — the same thing JwtStrategy
   * does for a real request.
   */
  setTenant(tenantId: string): this {
    this.testCls.set('tenantId', tenantId);
    return this;
  }

  async afterAll() {
    await this.databaseHelper.dropDatabase();
    global.gc?.();
  }

  async cleanUp() {
    await this.databaseHelper.cleanUpDb();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  }

  get<TInput = any, TResult = TInput>(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    _typeOrToken: Type<TInput> | Function | string | symbol,
  ): TResult {
    throw new Error(
      'get() not supported in this mode. Use the unit property instead.',
    );
  }

  spyOn<
    T extends new (...args: any[]) => any,
    Key extends keyof InstanceType<T>,
  >(
    target: T,
    methodName: Key,
  ): InstanceType<T>[Key] extends (...args: infer P) => infer R
    ? jest.SpyInstance<R, P>
    : jest.SpyInstance {
    const instance = this.get(target);
    return jest.spyOn(instance as any, methodName as any) as any;
  }

  fakeUser(overrides: Partial<AuthUserType> = {}): AuthUserType {
    userSeq += 1;
    return {
      id: `user-${userSeq}`,
      tenantId: 'tenant-a',
      roles: [RoleEnum.Member],
      ...overrides,
    };
  }

  protected silenceLogger() {
    Logger.overrideLogger(false);
  }
}

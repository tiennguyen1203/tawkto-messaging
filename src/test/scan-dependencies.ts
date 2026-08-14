import 'reflect-metadata';
import type { Type } from '@nestjs/common';

export type ScanResult = {
  /** Dependencies to expose as real providers */
  real: Type[];
  /** Mocked classes that were found in the dependency tree */
  mockedInTree: Type[];
  /** String/symbol tokens found via @Inject() that can't be auto-resolved */
  unresolvedTokens: (string | symbol)[];
};

type SelfDeclaredDep = { index: number; param: Type | string | symbol };

/**
 * Recursively scans the dependency tree of a class using reflect-metadata.
 *
 * Handles both standard TypeScript-emitted types (`design:paramtypes`) and
 * NestJS `@Inject()` decorated params (`self:paramtypes`). When a constructor
 * param is annotated with `@Inject(ClassToken)`, the class token is used
 * instead of the TypeScript-emitted type (which is `Object`).
 *
 * String/symbol tokens (e.g. `@Inject(CACHE_MANAGER)`) cannot be resolved
 * automatically — those classes must be handled via DEFAULT_MOCKS.
 *
 * @param rootClass - The class to scan dependencies for
 * @param mockedClasses - Classes that will be mocked (their sub-dependencies won't be scanned)
 */
export function scanDependencies(
  rootClass: Type,
  mockedClasses: Type[] = [],
): ScanResult {
  const visited = new Set<Type>();
  const mocked = new Set<Type>(mockedClasses);
  const mockedFound = new Set<Type>();
  const unresolvedTokens = new Set<string | symbol>();

  function walk(cls: Type) {
    if (visited.has(cls)) return;
    visited.add(cls);

    const paramTypes: Type[] | undefined = Reflect.getMetadata(
      'design:paramtypes',
      cls,
    );
    if (!paramTypes) return;

    // NestJS @Inject() metadata: overrides design:paramtypes at specific indices
    const selfDeps: SelfDeclaredDep[] =
      Reflect.getMetadata('self:paramtypes', cls) || [];
    const selfDepsMap = new Map(selfDeps.map((d) => [d.index, d.param]));

    for (let i = 0; i < paramTypes.length; i++) {
      const injectedToken = selfDepsMap.get(i);

      // Track string/symbol tokens — these can't be auto-resolved
      if (
        injectedToken &&
        (typeof injectedToken === 'string' || typeof injectedToken === 'symbol')
      ) {
        unresolvedTokens.add(injectedToken);
        continue;
      }

      // Prefer the @Inject(ClassToken) over the TypeScript-emitted type
      const dep =
        injectedToken && typeof injectedToken === 'function'
          ? (injectedToken as Type)
          : paramTypes[i];

      if (!dep || !dep.name || isBuiltIn(dep)) continue;
      if (mocked.has(dep)) {
        mockedFound.add(dep);
        continue;
      }
      walk(dep);
    }
  }

  walk(rootClass);
  visited.delete(rootClass);

  return {
    real: Array.from(visited),
    mockedInTree: Array.from(mockedFound),
    unresolvedTokens: Array.from(unresolvedTokens),
  };
}

function isBuiltIn(dep: Type): boolean {
  const builtInNames = [
    'Object',
    'String',
    'Number',
    'Boolean',
    'Array',
    'Function',
    'Logger',
    // Provided directly by the test helpers rather than walked: Connection is the
    // mongoose connection to the test container, ClsService is a fake store.
    'Connection',
    'NativeConnection',
    'ClsService',
    // Supplied by the framework itself. Registering these as ordinary providers
    // makes Nest construct them with no container, which fails deep inside the
    // injector with an unhelpful message.
    'ModuleRef',
    'Reflector',
    'HttpAdapterHost',
    'ApplicationConfig',
  ];
  return builtInNames.includes(dep.name);
}

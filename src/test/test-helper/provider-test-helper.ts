/* eslint-disable no-console */
import 'reflect-metadata';
import { Type } from '@nestjs/common';
import { config } from 'dotenv';
import { TestBed, type UnitReference } from '@suites/unit';
// Named import only. Mixing a default import with a named one from mongoose
// (a CJS module) makes `Connection` undefined at run time under esModuleInterop,
// which silently breaks it as a DI token — the mock is applied to `undefined`
// and the unit receives an auto-mock whose .model() returns nothing.
import { Connection, createConnection } from 'mongoose';
import { Client } from '@elastic/elasticsearch';
import { ClsService } from 'nestjs-cls';

import { ModuleRefSingleton } from '@/module-ref.singleton';
import { ConnectionSingleton } from '@/infra/database/connection.singleton';
import { CachingService } from '@/infra/caching/service';
import { SearchContainer } from '../search-container';
import { scanDependencies } from '../scan-dependencies';
import {
  BaseTestHelper,
  buildMockMap,
  createMockInstance,
  createRealCachingService,
  resolveInstance,
} from './shared';

/**
 * Lightweight helper for use cases and concerns. @suites TestBed.sociable() scans
 * the dependency tree and exposes only what the target actually needs, so a spec
 * boots in milliseconds instead of standing up the whole AppModule.
 *
 * The scanner reads constructor metadata, which means it can only see class
 * tokens. That is precisely why repositories take the mongoose `Connection`
 * rather than `@InjectModel(...)` — see D3.
 */
/**
 * The Elasticsearch client SearchModule builds from configuration. The scanner
 * cannot construct it — the factory is where its address lives — so the harness
 * supplies one pointed at the run's container, exactly as it does for the mongoose
 * connection. Specs that never search still need it, because MessageRepository
 * depends on the index whether or not a given test calls `search`.
 */
const searchClientForTests = () =>
  new Client({ node: SearchContainer.getNode() });

export class ProviderTestHelper<TUnit = any> extends BaseTestHelper<TUnit> {
  private _searchClient?: Client;
  private _unit!: TUnit;
  private _unitRef!: UnitReference;
  private _connection!: Connection;
  private _fakedInstances = new Map<Type, any>();

  constructor(private targetClass: Type<TUnit>) {
    super();
  }

  get unit(): TUnit {
    return this._unit;
  }

  override imports(): this {
    throw new Error(
      'imports() is only available in controller mode. In provider mode, expose ' +
        'the dependency with .provide(token, value) or mock it with .mock().',
    );
  }

  async beforeAll() {
    this.silenceLogger();

    const connection = await this.initializeConnection();
    const allMocks = buildMockMap(this.mockConfigs);

    const mockedClasses = Array.from(allMocks.keys());
    const { real, mockedInTree, unresolvedTokens } = scanDependencies(
      this.targetClass,
      mockedClasses,
    );

    const knownTokens = new Set<string | symbol>(['CONFIGURATION_TOKEN']);
    const missingTokens = unresolvedTokens.filter(
      (t) => !this.tokenProviders.has(t) && !knownTokens.has(t),
    );
    if (missingTokens.length > 0) {
      const tokenList = missingTokens
        .map((t) => (typeof t === 'symbol' ? t.toString() : `'${t}'`))
        .join(', ');
      console.warn(
        `\n⚠️  TestHelper Warning: ${this.targetClass.name} has unresolved @Inject() tokens: ${tokenList}\n` +
          `   These dependencies will be undefined at runtime.\n` +
          `   Fix: use .provide(token, ClassOrValue) to register them.\n`,
      );
    }

    const builder: any = real.reduce(
      (b, dep) => b.expose(dep),
      TestBed.sociable(this.targetClass),
    );

    // Only stand in for a dependency the tree actually asks for; @suites warns
    // loudly about mocks it cannot reach, which buries the real failures.
    const treeDeps = collectConstructorDeps([this.targetClass, ...real]);
    const needs = (name: string) => treeDeps.has(name);

    let configured = builder;
    if (needs('Connection') || needs('NativeConnection')) {
      configured = configured.mock(Connection).final(connection);
    }
    if (needs('ClsService')) {
      configured = configured.mock(ClsService).final(this.testCls);
    }
    if (needs('Client') && !this.tokenProviders.has(Client)) {
      this._searchClient = searchClientForTests();
      configured = configured.mock(Client).final(this._searchClient);
    }

    for (const dep of mockedInTree) {
      const instance = createMockInstance(allMocks.get(dep)!);
      this._fakedInstances.set(dep, instance);
      configured = configured.mock(dep).final(instance);
    }

    // CachingService injects CACHE_MANAGER, a string token the scanner cannot
    // resolve, so hand it a real cache backed by an in-memory store.
    if (needs('CachingService') && !this.realProviders.has(CachingService)) {
      const cachingService = await createRealCachingService();
      this._fakedInstances.set(CachingService, cachingService);
      configured = configured.mock(CachingService).final(cachingService);
    }

    for (const [token, classOrValue] of this.tokenProviders) {
      if (typeof classOrValue === 'function') {
        const instance = resolveInstance(
          classOrValue,
          { connection, cls: this.testCls },
          allMocks,
        );
        this._fakedInstances.set(classOrValue, instance);
        configured = configured.mock(token).final(instance);
      } else {
        configured = configured.mock(token).final(classOrValue);
      }
    }

    const { unit, unitRef } = await configured.compile();
    this._unit = unit;
    this._unitRef = unitRef;

    this.setupModuleRefSingleton(connection);
    await this.databaseHelper.runMigrations();
  }

  override async afterAll() {
    await super.afterAll();
    await this._connection?.close();
    await this._searchClient?.close();
  }

  override get<TInput = any, TResult = TInput>(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    typeOrToken: Type<TInput> | Function | string | symbol,
  ): TResult {
    if (typeof typeOrToken === 'function') {
      const faked = this._fakedInstances.get(typeOrToken as Type);
      if (faked) return faked as TResult;
      const found = this.findInstance(this._unit, typeOrToken as Type);
      if (found) return found as TResult;
    }
    try {
      return this._unitRef.get(typeOrToken as any) as any;
    } catch {
      return ModuleRefSingleton.getRef().get(typeOrToken) as TResult;
    }
  }

  private setupModuleRefSingleton(connection: Connection) {
    ModuleRefSingleton.setRef({
      get: (typeOrToken: any) => {
        if (typeOrToken === Connection) return connection;
        try {
          return this.get(typeOrToken);
        } catch {
          // Not in the scanned tree — covers repositories resolved on the fly.
          return new typeOrToken(connection, this.testCls);
        }
      },
    } as any);
  }

  private async initializeConnection(): Promise<Connection> {
    config({ path: '.env.test' });
    await this.databaseHelper.createDatabase();

    this._connection = await createConnection(this.databaseHelper.uri, {
      autoIndex: false,
    }).asPromise();

    ConnectionSingleton.set(this._connection);

    return this._connection;
  }

  private findInstance(
    root: any,
    targetType: Type,
    visited = new Set<any>(),
  ): any {
    if (!root || typeof root !== 'object' || visited.has(root)) return null;
    visited.add(root);

    if (root instanceof targetType) return root;

    for (const value of Object.values(root)) {
      if (value instanceof targetType) return value;
    }
    for (const value of Object.values(root)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const found = this.findInstance(value, targetType, visited);
        if (found) return found;
      }
    }
    return null;
  }
}

/**
 * Names of every class appearing in the constructors of the given classes.
 */
function collectConstructorDeps(classes: Type[]): Set<string> {
  const names = new Set<string>();

  for (const cls of classes) {
    const paramTypes: Type[] =
      Reflect.getMetadata('design:paramtypes', cls) || [];
    const selfDeps: { index: number; param: any }[] =
      Reflect.getMetadata('self:paramtypes', cls) || [];

    for (const p of paramTypes) {
      if (p?.name) names.add(p.name);
    }
    for (const d of selfDeps) {
      if (typeof d.param === 'function' && d.param.name)
        names.add(d.param.name);
    }
  }

  return names;
}

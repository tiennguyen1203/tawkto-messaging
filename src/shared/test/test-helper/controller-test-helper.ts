import 'reflect-metadata';
import { Client } from '@elastic/elasticsearch';
import {
  INestApplication,
  Type,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { APP_GUARD, HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { config } from 'dotenv';
// Named import only. Mixing a default import with a named one from mongoose
// (a CJS module) makes `Connection` undefined at run time under esModuleInterop,
// which silently breaks it as a DI token — the mock is applied to `undefined`
// and the unit receives an auto-mock whose .model() returns nothing.
import { Connection, createConnection } from 'mongoose';
import { ClsService } from 'nestjs-cls';

import { JwtStrategy } from '@/shared/auth-passport/jwt.strategy';
import { GlobalExceptionsFilter } from '@/shared/filters/global-exceptions.filter';
import { JwtStrategyGuard } from '@/shared/guards/jwt-strategy.guard';
import { ResponseInterceptor } from '@/shared/interceptors/response.interceptor';
import { CachingService } from '@/shared/infra/caching/service';
import { ConnectionSingleton } from '@/shared/infra/database/connection.singleton';
import { AppClsModule } from '@/shared/infra/cls/module';
import { scanDependencies } from '../scan-dependencies';
import request from '../supertest-helper';
import { SearchContainer } from '../search-container';
import {
  BaseTestHelper,
  buildMockMap,
  createMockInstance,
  createRealCachingService,
} from './shared';

/**
 * Lightweight helper for controllers: a minimal Nest app carrying only the
 * scanned dependency tree, the real guard chain, and the real global filter and
 * interceptor — so status codes and response envelopes are exercised for real.
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

export class ControllerTestHelper extends BaseTestHelper {
  private _searchClient?: Client;
  private app!: INestApplication;
  private _connection!: Connection;

  constructor(private targetClass: Type) {
    super();
  }

  get unit(): any {
    return this.app.get(this.targetClass);
  }

  get request(): request.SuperTest {
    const httpServer = this.app.getHttpServer();
    httpServer.nestApp = this.app;
    return (request as any)(this.app.getHttpServer());
  }

  async beforeAll() {
    this.silenceLogger();

    const connection = await this.initializeConnection();
    const allMocks = buildMockMap(this.mockConfigs);

    const mockedClasses = Array.from(allMocks.keys());
    const { real, mockedInTree } = scanDependencies(
      this.targetClass,
      mockedClasses,
    );

    const cachingService = await createRealCachingService();

    const providedByModules = collectModuleExports(this.extraImports);

    const providers: any[] = [
      JwtStrategy,
      { provide: APP_GUARD, useClass: JwtStrategyGuard },
      { provide: Connection, useValue: connection },
      // Terminus' MongooseHealthIndicator resolves the connection by @nestjs/mongoose's
      // string token, not by the Connection class, so register it under both.
      { provide: getConnectionToken(), useValue: connection },
      { provide: CachingService, useValue: cachingService },
      {
        provide: Client,
        useValue: (this._searchClient = searchClientForTests()),
      },
      ...real.filter(
        // Both are supplied above as values. Left in the list, Nest would try to
        // construct them itself — and `new Client()` with no options throws.
        (dep) =>
          dep !== CachingService &&
          dep !== Client &&
          !providedByModules.has(dep),
      ),
      ...mockedInTree.map((dep) => ({
        provide: dep,
        useValue: createMockInstance(allMocks.get(dep)!),
      })),
      ...[...this.tokenProviders.entries()].map(([token, value]) => ({
        provide: token,
        useValue: value,
      })),
    ];

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ envFilePath: '.env.test', isGlobal: true }),
        AppClsModule.register(),
        ...this.extraImports,
      ],
      controllers: [this.targetClass],
      providers,
    }).compile();

    this.app = module.createNestApplication();
    this.app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    this.app.enableVersioning({ type: VersioningType.URI });
    this.app.setGlobalPrefix('api');
    this.app.useGlobalInterceptors(new ResponseInterceptor());
    this.app.useGlobalFilters(
      new GlobalExceptionsFilter(this.app.get(HttpAdapterHost)),
    );
    await this.app.init();
    await this.databaseHelper.runMigrations();
  }

  /**
   * Controller mode runs the real ClsModule, so the tenant comes from the JWT via
   * JwtStrategy exactly as it does in production.
   */
  override get cls(): ClsService<any> {
    return this.app.get(ClsService);
  }

  override async afterAll() {
    await this.databaseHelper.dropDatabase();
    if (this.app) {
      await this.app.close();
    }
    await this._connection?.close();
    global.gc?.();
  }

  override get<TInput = any, TResult = TInput>(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    typeOrToken: Type<TInput> | Function | string | symbol,
  ): TResult {
    return this.app.get(typeOrToken);
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
}

/**
 * Walks the `exports` metadata of the given modules (following their `imports`)
 * to find every provider they already supply.
 */
function collectModuleExports(modules: any[]): Set<any> {
  const found = new Set<any>();
  const seen = new Set<any>();

  const visit = (mod: any) => {
    if (!mod || seen.has(mod)) return;
    seen.add(mod);

    // A DynamicModule carries its metadata on the object itself.
    const exported = mod.module
      ? (mod.exports ?? [])
      : (Reflect.getMetadata('exports', mod) ?? []);
    const imported = mod.module
      ? (mod.imports ?? [])
      : (Reflect.getMetadata('imports', mod) ?? []);

    for (const e of exported) {
      if (typeof e === 'function') found.add(e);
      else visit(e);
    }
    for (const i of imported) visit(i);
  };

  modules.forEach(visit);
  return found;
}

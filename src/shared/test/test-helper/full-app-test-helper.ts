import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';

import { SearchContainer } from '../search-container';
import { setupApp } from '@/shared/bootstrap';
import request from '../supertest-helper';
import { BaseTestHelper } from './shared';

/**
 * Loads the entire AppModule. Use when the lightweight modes cannot express what
 * is under test — module wiring, the caching module, ModuleRefSingleton.
 *
 * The infrastructure is pinned by writing MONGO_URI and ELASTICSEARCH_NODE into
 * the environment before Nest boots, so the configuration-driven providers pick
 * up the test containers without needing an override.
 */
export class FullAppTestHelper extends BaseTestHelper {
  app!: INestApplication;

  /**
   * The root module to boot. Passed in rather than imported: this harness is
   * shared by every service, and a shared thing that names one service's module
   * is no longer shared — it is that service's, sitting in the wrong directory.
   */
  constructor(private readonly rootModule: Type) {
    super();
  }

  get unit(): any {
    throw new Error(
      'unit is not available in full app mode. Use get(Class) instead.',
    );
  }

  get request(): request.SuperTest {
    const httpServer = this.app.getHttpServer();
    httpServer.nestApp = this.app;
    return (request as any)(this.app.getHttpServer());
  }

  async beforeAll() {
    this.silenceLogger();
    await this.databaseHelper.createDatabase();
    // Same trick as MONGO_URI above: SearchModule builds its client from
    // configuration, so the container's address has to be in the environment
    // before Nest reads it. Only this mode boots the real module — the
    // lightweight modes are handed a client with .provide(Client, ...).
    process.env.ELASTICSEARCH_NODE = SearchContainer.getNode();

    const module = await Test.createTestingModule({
      imports: [this.rootModule],
    }).compile();

    this.app = module.createNestApplication();
    setupApp(this.app, this.rootModule);
    await this.app.init();
    await this.databaseHelper.runMigrations();
  }

  override get cls(): ClsService<any> {
    return this.app.get(ClsService);
  }

  override async afterAll() {
    await this.databaseHelper.dropDatabase();
    if (this.app) {
      await this.app.close();
    }
    global.gc?.();
  }

  override get<TInput = any, TResult = TInput>(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    typeOrToken: Type<TInput> | Function | string | symbol,
  ): TResult {
    return this.app.get(typeOrToken);
  }
}

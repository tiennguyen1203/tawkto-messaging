import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';

import { AppModule } from '@/app.module';
import { setupApp } from '@/main.setup';
import request from '../supertest-helper';
import { BaseTestHelper } from './shared';

/**
 * Loads the entire AppModule. Use when the lightweight modes cannot express what
 * is under test — module wiring, the caching module, ModuleRefSingleton.
 *
 * The database is pinned by createDatabase() writing MONGO_URI into the
 * environment before Nest boots, so MongooseConfigService picks up the test
 * container without needing an override.
 */
export class FullAppTestHelper extends BaseTestHelper {
  app!: INestApplication;

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

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    this.app = module.createNestApplication();
    setupApp(this.app);
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

import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { env } from '@/shared/constants';
import { MongooseConfigService } from '@/shared/infra/database/database.service';
import { CachingModule } from '@/shared/infra/caching/module';
import { AppClsModule } from '@/shared/infra/cls/module';
import { LoggingModule } from '@/shared/infra/logging/module';

/**
 * What every process needs before it can be any particular service: config, the
 * request context, logging, a database connection and a cache.
 *
 * These are the shared kernel's modules and nothing else. A service's own
 * repositories and use cases are the service's to import — this list carried them
 * once, which meant a second service would have inherited the first one's
 * repositories simply by starting up.
 */
export const platformModules = [
  ConfigModule.forRoot({
    isGlobal: true,
    envFilePath:
      process.env.APP_ENV === env.APP_ENVS.test ? '.env.test' : '.env',
  }),
  AppClsModule.register(),
  LoggingModule.register(),
  MongooseModule.forRootAsync({
    useClass: MongooseConfigService,
  }),
  CachingModule.register(),
];

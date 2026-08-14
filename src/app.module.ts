import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_GUARD } from '@nestjs/core';

import { MongooseConfigService } from './infra/database/database.service';
import { RoutersModule } from './routers/module';
import { RepositoriesModule } from './cores/repositories.module';
import { JwtStrategyGuard } from './common/guards';
import { JwtStrategy } from './common/auth-passport/jwt.strategy';
import { env } from './common/constants';
import { CachingModule } from './infra/caching/module';
import { AppClsModule } from './infra/cls/module';
import { LoggingModule } from './infra/logging/module';

/**
 * Shared by every entrypoint — the HTTP API and the Kafka consumer alike.
 * Each entrypoint then adds only the modules specific to its own role.
 */
export const commonModules = [
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
  RepositoriesModule,
  CachingModule.register(),
];

@Module({
  imports: [...commonModules, RoutersModule],
  providers: [
    JwtStrategy,
    {
      provide: APP_GUARD,
      useClass: JwtStrategyGuard,
    },
  ],
})
export class AppModule {}

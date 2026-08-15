import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_GUARD } from '@nestjs/core';

import { MongooseConfigService } from '@/shared/infra/database/database.service';
import { RoutersModule } from './routers/module';
import { RepositoriesModule } from './cores/repositories.module';
import { WorkflowsModule } from './workflows/module';
import { JwtStrategyGuard } from '@/shared/guards';
import { JwtStrategy } from '@/shared/auth-passport/jwt.strategy';
import { env } from '@/shared/constants';
import { CachingModule } from '@/shared/infra/caching/module';
import { AppClsModule } from '@/shared/infra/cls/module';
import { LoggingModule } from '@/shared/infra/logging/module';

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
  WorkflowsModule,
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

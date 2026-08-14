/* eslint-disable @typescript-eslint/require-await */
import { DynamicModule, Global, Module } from '@nestjs/common';
import { CacheModule, CacheOptions } from '@nestjs/cache-manager';
import { CachingService } from './service';
import { ConfigService } from '@nestjs/config';
import { createKeyv } from '@keyv/redis';
import { env } from '@/common/constants';

@Global()
@Module({})
export class CachingModule {
  static register(): DynamicModule {
    const module = CacheModule.registerAsync({
      inject: [ConfigService],
      useFactory: async (
        configService: ConfigService,
      ): Promise<CacheOptions> => {
        // Tests run against an in-memory store; there is no Redis in the test
        // container set.
        if (configService.getOrThrow('APP_ENV') === env.APP_ENVS.test) {
          return {};
        }

        const keyv = createKeyv({
          socket: {
            host: configService.getOrThrow('REDIS_HOST'),
            port: Number(configService.getOrThrow('REDIS_PORT')),
          },
          username: configService.get('REDIS_USERNAME') || undefined,
          password: configService.get('REDIS_PASSWORD') || undefined,
        });

        // keyv ships separate ESM and CJS declaration files, each declaring its
        // own `Keyv` class with private fields. @keyv/redis and cache-manager
        // resolve to different ones, so structurally identical instances are
        // nominally incompatible — the dual-package hazard. The cast is confined
        // to this boundary; nothing downstream sees it.
        return { stores: [keyv] } as unknown as CacheOptions;
      },
    });

    return {
      module: CachingModule,
      global: true,
      providers: [CachingService],
      imports: [module],
      exports: [CachingService],
    };
  }
}

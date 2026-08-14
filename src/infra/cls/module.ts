import { DynamicModule, Module } from '@nestjs/common';
import { ClsModule, ClsStore } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import { Request } from 'express';

export type AppExecutionSource = 'http' | 'consumer' | 'cron';

export interface AppClsStore extends ClsStore {
  traceId: string;
  source: AppExecutionSource;
  /**
   * The tenant every query in this request must be scoped to. Populated from
   * the JWT by JwtStrategy and read by BaseRepository — never from user input.
   */
  tenantId?: string;
  userId?: string;
  jobName?: string;
  startTime?: number;
}

@Module({})
export class AppClsModule {
  static register(): DynamicModule {
    return {
      module: AppClsModule,
      imports: [
        ClsModule.forRoot({
          global: true,
          middleware: {
            mount: true,
            setup: (cls, req: Request) => {
              const incoming = req.headers['x-request-id'];
              const traceId =
                typeof incoming === 'string' && incoming.length > 0
                  ? incoming
                  : randomUUID();
              cls.set('traceId', traceId);
              cls.set('source', 'http');
              cls.set('startTime', Date.now());
            },
          },
        }),
      ],
    };
  }
}

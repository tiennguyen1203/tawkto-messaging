import 'reflect-metadata';

import { env, UTC_TIMEZONE } from './common/constants';
import dotenv from 'dotenv';

dotenv.config({
  path: process.env.APP_ENV === env.APP_ENVS.test ? '.env.test' : '.env',
});

process.env.TZ = UTC_TIMEZONE;

import { NestFactory } from '@nestjs/core';
import { setDefaultResultOrder } from 'dns';

import { ConsumerModule } from './consumer.module';
import { AppLogger } from './infra/logging/app.logger';

/**
 * A second process, not a second thread of the API: the indexer is scaled by
 * consumer lag while the API is scaled by request rate, and one should not
 * restart because the other did (D1).
 *
 * `createApplicationContext` rather than `create` — this process serves no HTTP.
 */
async function bootstrap() {
  setDefaultResultOrder('ipv4first');

  const app = await NestFactory.createApplicationContext(ConsumerModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(AppLogger));
  app.enableShutdownHooks();
}

void bootstrap();

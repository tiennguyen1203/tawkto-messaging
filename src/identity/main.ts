import 'reflect-metadata';

import { env, UTC_TIMEZONE } from '@/shared/constants';
import dotenv from 'dotenv';

dotenv.config({
  path: process.env.APP_ENV === env.APP_ENVS.test ? '.env.test' : '.env',
});

process.env.TZ = UTC_TIMEZONE;

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { setDefaultResultOrder } from 'dns';

import { setupApp } from '@/shared/bootstrap';
import { IdentityAppModule } from './app.module';

/**
 * A third process from the same image (ADR-001), on its own port so it can be
 * moved to its own deployment without anything else changing.
 */
async function bootstrap() {
  setDefaultResultOrder('ipv4first');
  const app = await NestFactory.create(IdentityAppModule, { bufferLogs: true });
  setupApp(app, IdentityAppModule);
  await app.listen(app.get(ConfigService).get('IDENTITY_PORT') ?? 3001);
}

void bootstrap();

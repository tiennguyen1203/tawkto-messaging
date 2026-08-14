import 'reflect-metadata';

import { env, UTC_TIMEZONE } from './common/constants';
import dotenv from 'dotenv';

dotenv.config({
  path: process.env.APP_ENV === env.APP_ENVS.test ? '.env.test' : '.env',
});

process.env.TZ = UTC_TIMEZONE;

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { setDefaultResultOrder } from 'dns';

import { AppModule } from './app.module';
import { setupApp } from './main.setup';

async function bootstrap() {
  setDefaultResultOrder('ipv4first');
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  setupApp(app);
  await app.listen(app.get(ConfigService).get('PORT') ?? 3000);
}

void bootstrap();

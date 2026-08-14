/**
 * NOTE: workaround to record the project root, which is /src/... in dev and
 * /dist/... once built.
 */
import { env } from './common/constants';

env.ROOT_DIR = __dirname;

import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { useContainer } from 'class-validator';
import { ClsService } from 'nestjs-cls';
import { HttpAdapterHost, ModuleRef } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { AppLogger } from './infra/logging/app.logger';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { GlobalExceptionsFilter } from './common/filters/global-exceptions.filter';
import { ModuleRefSingleton } from './module-ref.singleton';

export const setupApp = (app: INestApplication) => {
  app.enableCors();

  // `whitelist` strips any property without a validation decorator, so unknown
  // fields never reach a use case — this is the input sanitization the brief asks for.
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );

  app.enableVersioning({ type: VersioningType.URI });
  app.setGlobalPrefix('api');

  app.useGlobalInterceptors(
    new LoggingInterceptor(app.get(ClsService)),
    new ResponseInterceptor(),
  );
  useContainer(app.select(AppModule), { fallbackOnErrors: true });
  app.useGlobalFilters(new GlobalExceptionsFilter(app.get(HttpAdapterHost)));

  const config = new DocumentBuilder()
    .setTitle('Messaging API')
    .setDescription(
      'Message management API — NestJS, MongoDB, Kafka, Elasticsearch',
    )
    .setVersion('1')
    .addBearerAuth({
      description: 'Please enter the access token',
      type: 'http',
      in: 'Header',
      scheme: 'Bearer',
      name: 'Authorization',
    })
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('swagger', app, document);

  ModuleRefSingleton.setRef(app.get(ModuleRef));
  app.useLogger(app.get(AppLogger));
};

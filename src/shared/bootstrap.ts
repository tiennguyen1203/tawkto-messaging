/**
 * NOTE: workaround to record the project root, which is /src/... in dev and
 * /dist/... once built.
 */
import { env } from '@/shared/constants';

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

import { AppLogger } from '@/shared/infra/logging/app.logger';
import { LoggingInterceptor } from '@/shared/interceptors/logging.interceptor';
import { ResponseInterceptor } from '@/shared/interceptors/response.interceptor';
import { GlobalExceptionsFilter } from '@/shared/filters/global-exceptions.filter';
import { ModuleRefSingleton } from '@/shared/module-ref.singleton';

export const setupApp = (app: INestApplication, rootModule: unknown) => {
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
  useContainer(app.select(rootModule as Parameters<typeof app.select>[0]), {
    fallbackOnErrors: true,
  });
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

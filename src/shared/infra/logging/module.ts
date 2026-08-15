import { env } from '@/shared/constants';
import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppLogger } from './app.logger';

// Structured single-line JSON in production, human-readable colour locally.
const isProduction = process.env.APP_ENV === env.APP_ENVS.prod;

// fast-redact has no deep wildcard, so enumerate up to 5 levels of nesting.
const buildSensitivePaths = (keys: string[]): string[] => {
  const wildcardPrefixes = ['', '*.', '*.*.', '*.*.*.', '*.*.*.*.'];
  return keys.flatMap((key) => wildcardPrefixes.map((p) => `${p}${key}`));
};

/**
 * Whether `pino-pretty` can be loaded. It is a devDependency, so in an image
 * built with production dependencies only, it cannot.
 */
const canPrettyPrint = (): boolean => {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
};

@Module({})
export class LoggingModule {
  static register(): DynamicModule {
    return {
      module: LoggingModule,
      global: true,
      providers: [AppLogger],
      exports: [AppLogger],
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
            autoLogging: false,
            base: null,
            // Always emit our own timestamp. The template suppressed it in
            // production because the hosting platform prefixed one; running
            // locally and in plain Docker, nothing else supplies it.
            timestamp: () => `,"time":"${new Date().toISOString()}"`,
            formatters: {
              level: (label) => ({ level: label }),
            },
            redact: {
              paths: [
                ...buildSensitivePaths([
                  'password',
                  'token',
                  'accessToken',
                  'refreshToken',
                  'idToken',
                  'secret',
                  'authorization',
                  'apiKey',
                ]),
                'req.headers.authorization',
                'req.headers.cookie',
              ],
              censor: '[REDACTED]',
            },
            // Pretty printing is a convenience for a human watching a dev
            // server, and `pino-pretty` is a devDependency — so it is absent
            // from the production image whatever APP_ENV claims. Asking whether
            // the module is actually there, rather than which environment we say
            // we are in, is what stops a container dying at boot with `unable to
            // determine transport target`. A log collector wants JSON anyway.
            transport:
              isProduction || !canPrettyPrint()
                ? undefined
                : {
                    target: 'pino-pretty',
                    options: {
                      colorize: true,
                      singleLine: true,
                      translateTime: 'SYS:HH:MM:ss.l',
                      ignore: 'pid,hostname',
                      messageFormat: '[{context}] {msg}',
                    },
                  },
          },
        }),
      ],
    };
  }
}

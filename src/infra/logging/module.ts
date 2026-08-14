import { env } from '@/common/constants';
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
            transport: isProduction
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

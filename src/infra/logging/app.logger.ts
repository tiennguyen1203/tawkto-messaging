import { Injectable, LoggerService } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ClsService } from 'nestjs-cls';
import type { Logger as PinoInstance } from 'pino';
import { AppClsStore } from '../cls/module';

type PinoLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Bridges NestJS's LoggerService onto pino, fixing two things the default
 * nestjs-pino bridge gets wrong for this codebase.
 *
 * 1. It drops trailing object params when the message is a string:
 *    `logger.debug('text', { foo })` becomes `pino.debug({ context }, 'text', { foo })`,
 *    and `{ foo }` is treated as a printf interpolation value — silently
 *    discarded, because 'text' carries no format specifier. This wrapper merges
 *    object params into the merging object instead, so the ordinary
 *    `this.logger.debug('text', { foo })` pattern carries its data through.
 *
 * 2. It has no request context. Every record here is enriched with the current
 *    request's `traceId` from CLS (plus tenant and user when known), so all the
 *    logs emitted inside one request can be filtered by a single id.
 */
@Injectable()
export class AppLogger implements LoggerService {
  constructor(private readonly cls: ClsService<AppClsStore>) {}

  private get pino(): PinoInstance | undefined {
    return PinoLogger.root;
  }

  log(message: any, ...optionalParams: any[]) {
    this.call('info', message, optionalParams);
  }

  error(message: any, ...optionalParams: any[]) {
    this.call('error', message, optionalParams);
  }

  warn(message: any, ...optionalParams: any[]) {
    this.call('warn', message, optionalParams);
  }

  debug(message: any, ...optionalParams: any[]) {
    this.call('debug', message, optionalParams);
  }

  verbose(message: any, ...optionalParams: any[]) {
    this.call('trace', message, optionalParams);
  }

  fatal(message: any, ...optionalParams: any[]) {
    this.call('fatal', message, optionalParams);
  }

  private call(level: PinoLevel, message: any, optionalParams: any[]) {
    const objArg: Record<string, any> = {};

    const store = this.cls.isActive() ? this.cls.get() : undefined;
    if (store?.traceId) objArg.traceId = store.traceId;
    if (store?.source) objArg.source = store.source;
    if (store?.tenantId) objArg.tenantId = store.tenantId;
    if (store?.userId) objArg.userId = store.userId;
    if (store?.jobName) objArg.jobName = store.jobName;

    let params = optionalParams;

    if (params.length > 0 && typeof params[params.length - 1] === 'string') {
      objArg.context = params[params.length - 1];
      params = params.slice(0, -1);
    }

    const remaining: any[] = [];
    for (const p of params) {
      if (p instanceof Error) {
        objArg.err = p;
      } else if (p !== null && typeof p === 'object') {
        Object.assign(objArg, p);
      } else {
        remaining.push(p);
      }
    }

    const pino = this.pino;
    if (!pino) {
      // Pre-init fallback: LoggerModule.configure() hasn't set PinoLogger.root yet.
      const consoleLevel: 'log' | 'warn' | 'error' | 'debug' =
        level === 'fatal' || level === 'error'
          ? 'error'
          : level === 'warn'
            ? 'warn'
            : level === 'trace' || level === 'debug'
              ? 'debug'
              : 'log';
      // eslint-disable-next-line no-console
      console[consoleLevel](objArg, message, ...remaining);
      return;
    }

    if (message instanceof Error) {
      objArg.err = message;
      pino[level](objArg);
      return;
    }

    if (message !== null && typeof message === 'object') {
      Object.assign(objArg, message);
      pino[level](objArg, ...remaining);
      return;
    }

    pino[level](objArg, message, ...remaining);
  }
}

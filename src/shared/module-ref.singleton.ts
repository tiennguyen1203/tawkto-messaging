/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import { ModuleRef } from '@nestjs/core';

export interface Type<T = any> extends Function {
  new (...args: any[]): T;
}

export class ModuleRefSingleton {
  private static ref: ModuleRef;
  static getRef(): ModuleRef {
    if (!this.ref) {
      throw new Error('App has not been initialized');
    }

    return this.ref;
  }

  static setRef(app: ModuleRef) {
    this.ref = app;
  }

  static get<TInput = any, TResult = TInput>(
    typeOrToken: Type<TInput> | Function | string | symbol,
  ): TResult {
    return this.ref.get(typeOrToken, {
      strict: false,
    }) as TResult;
  }
}

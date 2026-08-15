import { Connection } from 'mongoose';

/**
 * Escape hatch for code that runs outside Nest's DI graph — chiefly test
 * factories, which are plain `new XFactory()` objects with no injector to ask.
 * Application code should inject `Connection` instead of reaching in here.
 */
export class ConnectionSingleton {
  private static connection: Connection;

  static get(): Connection {
    if (!this.connection) {
      throw new Error('Mongo connection has not been initialized');
    }
    return this.connection;
  }

  static set(connection: Connection) {
    this.connection = connection;
  }
}

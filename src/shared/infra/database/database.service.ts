import { Injectable } from '@nestjs/common';
import {
  MongooseModuleOptions,
  MongooseOptionsFactory,
} from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { getMongooseConfig } from './database.configuration';
import { ConnectionSingleton } from './connection.singleton';

@Injectable()
export class MongooseConfigService implements MongooseOptionsFactory {
  createMongooseOptions(): MongooseModuleOptions {
    return {
      ...getMongooseConfig(),
      // Publishes the connection for the few callers that live outside Nest's
      // DI graph — test factories, chiefly. Application code injects Connection.
      connectionFactory: (connection: Connection) => {
        ConnectionSingleton.set(connection);
        return connection;
      },
    };
  }
}

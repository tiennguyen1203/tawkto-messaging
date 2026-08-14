import { Global, Module } from '@nestjs/common';

/**
 * Repositories are plain providers constructed from the mongoose `Connection`
 * (a class token) rather than from `@InjectModel` (a string token). That keeps
 * them resolvable by the lightweight test harness, which walks constructor
 * metadata and cannot see string tokens.
 */
const repositories: any[] = [];

@Global()
@Module({
  providers: [...repositories],
  exports: [...repositories],
})
export class RepositoriesModule {}

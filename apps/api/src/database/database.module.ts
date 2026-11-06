import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [DatabaseService, StorageService],
  exports: [DatabaseService, StorageService],
})
export class DatabaseModule {}

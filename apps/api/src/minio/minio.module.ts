import { Module } from '@nestjs/common';
import { MinioService } from './minio.service';

/**
 * Plain module (NOT @Global): the import pipeline is the only consumer today. Promote to @Global when a
 * second one appears (e.g. presigned evidence download in Prompt 14).
 */
@Module({
  providers: [MinioService],
  exports: [MinioService],
})
export class MinioModule {}

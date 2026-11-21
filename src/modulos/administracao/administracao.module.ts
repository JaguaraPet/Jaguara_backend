import { Module } from '@nestjs/common';
import { LogsController } from './http/logs.controller';

@Module({
  controllers: [LogsController],
})
export class AdministracaoModule {}

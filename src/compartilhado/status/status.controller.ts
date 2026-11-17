import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class StatusController {
  @Get()
  verificar() {
    return { status: 'ok', horario: new Date().toISOString() };
  }
}

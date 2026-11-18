import { Controller, Get } from '@nestjs/common';
import { Publica } from '../auth/usuario-autenticado';

@Controller('health')
export class StatusController {
  @Publica()
  @Get()
  verificar() {
    return { status: 'ok', horario: new Date().toISOString() };
  }
}

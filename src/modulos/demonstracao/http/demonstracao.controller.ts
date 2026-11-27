import { Body, Controller, Ip, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Publica } from '../../../compartilhado/auth/usuario-autenticado';
import type { Tokens } from '../../acesso/aplicacao/autenticacao.service';
import {
  DemonstracaoCriada,
  DemonstracaoService,
} from '../aplicacao/demonstracao.service';

export class EntradaTutorDemonstracaoDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o código da demonstração' })
  @MaxLength(128)
  codigo: string;
}

@Controller('demonstracao')
export class DemonstracaoController {
  constructor(private readonly demonstracao: DemonstracaoService) {}

  /** Cria uma clínica de demonstração e já devolve a sessão dela. */
  @Publica()
  // Por visitante (IP): folga para uma turma ou banca na mesma rede.
  @Throttle({ geral: { limit: 20, ttl: 3_600_000 } })
  @Post()
  criar(@Ip() ip: string): Promise<DemonstracaoCriada> {
    return this.demonstracao.criar(ip);
  }

  /** Entra como a tutora da demonstração, para ver o mesmo ciclo pelo app. */
  @Publica()
  @Post('tutor')
  entrarComoTutor(@Body() dto: EntradaTutorDemonstracaoDto): Promise<Tokens> {
    return this.demonstracao.entrarComoTutor(dto.codigo);
  }
}

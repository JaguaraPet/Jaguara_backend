import { Controller, Get, INestApplication, Param } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { garantirMesmaEmpresa } from '../src/compartilhado/auth/escopo-empresa';
import {
  Autenticado,
  CHAVE_AUTENTICADO,
  CHAVE_PERMISSOES,
  Permissoes,
  SomenteAdministrador,
  SomenteEnterprise,
  SomenteTutor,
} from '../src/compartilhado/auth/permissoes';
import {
  CHAVE_PUBLICA,
  UsuarioAtual,
} from '../src/compartilhado/auth/usuario-autenticado';
import type {
  TipoUsuario,
  UsuarioAutenticado,
} from '../src/compartilhado/auth/usuario-autenticado';
import { criarAppTeste } from './utils/app';

/** Rotas usadas só neste teste, uma por regra da camada de acesso. */
@Controller('teste-acesso')
class RotasDeTesteController {
  @Get('sem-regra')
  semRegra() {
    return { ok: true };
  }

  @Autenticado()
  @Get('autenticado')
  autenticado() {
    return { ok: true };
  }

  @SomenteTutor()
  @Permissoes('pet:ler')
  @Get('tutor')
  tutor() {
    return { ok: true };
  }

  @SomenteEnterprise()
  @Permissoes('agenda:ler')
  @Get('empresas/:empresaId/agenda')
  agenda(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('empresaId') empresaId: string,
  ) {
    garantirMesmaEmpresa(usuario, empresaId);
    return { ok: true };
  }

  @SomenteAdministrador()
  @Permissoes('admin:auditoria')
  @Get('admin')
  admin() {
    return { ok: true };
  }
}

describe('Autorização por perfil (ADR-002, ADR-009, ADR-012)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  const empresaA = randomUUID();
  const empresaB = randomUUID();

  beforeAll(async () => {
    app = await criarAppTeste({ controllers: [RotasDeTesteController] });
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  function token(
    tipo: TipoUsuario,
    permissoes: string[],
    empresaId: string | null = null,
  ) {
    return jwt.sign({
      sub: randomUUID(),
      sid: randomUUID(),
      tipo,
      perfil: tipo,
      empresaId,
      permissoes,
    });
  }

  const get = (rota: string, accessToken: string) =>
    request(app.getHttpServer())
      .get(`/v1/teste-acesso/${rota}`)
      .set('Authorization', `Bearer ${accessToken}`);

  it('deve negar quando a rota não declara regra de acesso (negar por padrão)', async () => {
    const resposta = await get(
      'sem-regra',
      token('ADMINISTRADOR', ['admin:auditoria']),
    ).expect(403);
    expect(resposta.body).toMatchObject({ codigo: 'SEM_PERMISSAO' });
  });

  it('deve liberar qualquer usuário logado quando a rota só exige login', async () => {
    await get('autenticado', token('TUTOR', [])).expect(200);
    await get('autenticado', token('FUNCIONARIO', [], empresaA)).expect(200);
  });

  it('deve liberar o tutor com a permissão e negar o tutor sem ela', async () => {
    await get('tutor', token('TUTOR', ['pet:ler'])).expect(200);
    await get('tutor', token('TUTOR', [])).expect(403);
  });

  it('deve negar rotas do tutor para a empresa, mesmo com a permissão (ADR-002)', async () => {
    await get('tutor', token('EMPRESA', ['pet:ler'], empresaA)).expect(403);
  });

  it('deve negar rotas da empresa para o tutor (ADR-002)', async () => {
    await get(
      `empresas/${empresaA}/agenda`,
      token('TUTOR', ['agenda:ler']),
    ).expect(403);
  });

  it('deve liberar o funcionário com a permissão só na própria empresa (RN24)', async () => {
    const funcionario = token('FUNCIONARIO', ['agenda:ler'], empresaA);
    await get(`empresas/${empresaA}/agenda`, funcionario).expect(200);
    await get(`empresas/${empresaB}/agenda`, funcionario).expect(403);
  });

  it('deve negar o funcionário quando o perfil dele não tem a permissão (RN20)', async () => {
    await get(
      `empresas/${empresaA}/agenda`,
      token('FUNCIONARIO', ['cliente:ler'], empresaA),
    ).expect(403);
  });

  it('deve liberar a área de administração só para o administrador', async () => {
    await get('admin', token('ADMINISTRADOR', ['admin:auditoria'])).expect(200);
    await get('admin', token('EMPRESA', ['admin:auditoria'], empresaA)).expect(
      403,
    );
  });

  it('deve exigir @Publica, @Permissoes ou @Autenticado em todas as rotas da API', () => {
    const reflector = app.get(Reflector);
    const descobertas = app.get(DiscoveryService);
    const semRegra: string[] = [];
    for (const wrapper of descobertas.getControllers()) {
      const instance = wrapper.instance as object | undefined;
      const metatype = wrapper.metatype as (new () => unknown) | undefined;
      if (!instance || !metatype || metatype === RotasDeTesteController)
        continue;
      const prototipo = Object.getPrototypeOf(instance) as Record<
        string,
        unknown
      >;
      for (const nome of Object.getOwnPropertyNames(prototipo)) {
        const metodo = prototipo[nome];
        if (nome === 'constructor' || typeof metodo !== 'function') continue;
        if (!Reflect.getMetadata('path', metodo)) continue;
        const alvos = [metodo, metatype];
        const temRegra = [
          CHAVE_PUBLICA,
          CHAVE_PERMISSOES,
          CHAVE_AUTENTICADO,
        ].some(
          (chave) =>
            reflector.getAllAndOverride<unknown>(chave, alvos) !== undefined,
        );
        if (!temRegra) semRegra.push(`${metatype.name}.${nome}`);
      }
    }
    expect(semRegra).toEqual([]);
  });
});

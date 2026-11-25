import type { ConfigService } from '@nestjs/config';
import type { SessoesRevogadas } from '../../../compartilhado/auth/sessoes-revogadas';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import {
  categoriaDaPermissao,
  categoriaDoPerfil,
  problemaNasPermissoes,
} from '../dominio/permissoes-globais';
import { PermissoesGlobaisService } from './permissoes-globais.service';

describe('PermissoesGlobaisService (UC-29, RN35)', () => {
  const admin = { sub: 'adm', perfil: 'Administrador' } as UsuarioAutenticado;
  const perfilTutor = {
    id: 'pt',
    nome: 'Tutor',
    descricao: null,
    escopo: 'GLOBAL',
    empresaId: null,
    perfilPermissao: [{ permissao: { codigo: 'pet:ler' } }],
    _count: { usuario: 3 },
  };
  const montar = (perfil: object = perfilTutor) => {
    const prisma = {
      perfilAcesso: {
        findUnique: jest.fn().mockResolvedValue(perfil),
        findMany: jest.fn().mockResolvedValue([perfil]),
      },
      permissao: { findMany: jest.fn().mockResolvedValue([{ id: 'x' }]) },
      perfilPermissao: { deleteMany: jest.fn(), createMany: jest.fn() },
      $transaction: jest.fn(),
    };
    const revogadas = { marcarPerfilAlterado: jest.fn() };
    const config = { get: () => 15 } as unknown as ConfigService<
      Ambiente,
      true
    >;
    return {
      prisma,
      revogadas,
      servico: new PermissoesGlobaisService(
        prisma as unknown as PrismaService,
        revogadas as unknown as SessoesRevogadas,
        config,
      ),
    };
  };
  const codigo = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: ErroNegocio) => e.codigo,
    );

  it('deve classificar perfis e permissões', () => {
    expect(categoriaDoPerfil('Tutor')).toBe('TUTOR');
    expect(categoriaDoPerfil('Empresa')).toBe('EMPRESA');
    expect(categoriaDoPerfil('Suporte')).toBe('ADMINISTRADOR');
    expect(categoriaDaPermissao('admin:suporte')).toBe('ADMINISTRADOR');
    expect(categoriaDaPermissao('pet:ler')).toBe('TUTOR');
    expect(categoriaDaPermissao('agenda:editar')).toBe('EMPRESA');
    expect(categoriaDaPermissao('chat:usar')).toBeNull();
    expect(problemaNasPermissoes('TUTOR', ['pet:ler', 'chat:usar'])).toBeNull();
    expect(
      problemaNasPermissoes('ADMINISTRADOR', [
        'admin:suporte',
        'relatorio:ler',
      ]),
    ).toBeNull();
    expect(problemaNasPermissoes('TUTOR', ['admin:usuarios'])).toMatch(
      /admin:usuarios/,
    );
    expect(problemaNasPermissoes('EMPRESA', ['inexistente:x'])).toMatch(
      /inexistente/,
    );
  });

  it('CT-29-01: deve trocar as permissões e marcar o perfil para valer na hora', async () => {
    const { prisma, revogadas, servico } = montar();
    expect(servico.catalogo().length).toBeGreaterThan(20);
    const r = await servico.alterar(admin, 'pt', [
      'pet:ler',
      'privacidade:solicitar',
    ]);
    expect(r).toMatchObject({ nome: 'Tutor', categoria: 'TUTOR', usuarios: 3 });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(revogadas.marcarPerfilAlterado).toHaveBeenCalledWith('Tutor', 900);
  });

  it('CT-29-02: deve recusar perfil vazio, mistura e o próprio bloqueio', async () => {
    const { servico } = montar();
    expect(await codigo(servico.alterar(admin, 'pt', []))).toBe(
      'DADOS_INVALIDOS',
    );
    expect(await codigo(servico.alterar(admin, 'pt', ['admin:usuarios']))).toBe(
      'DADOS_INVALIDOS',
    );
    const doAdmin = montar({ ...perfilTutor, nome: 'Administrador' });
    expect(
      await codigo(doAdmin.servico.alterar(admin, 'pa', ['admin:suporte'])),
    ).toBe('RN35_AUTOBLOQUEIO');
    const daEmpresa = montar({
      ...perfilTutor,
      escopo: 'EMPRESA',
      empresaId: 'e1',
    });
    expect(
      await codigo(daEmpresa.servico.alterar(admin, 'pe', ['pet:ler'])),
    ).toBe('NAO_ENCONTRADO');
  });
});

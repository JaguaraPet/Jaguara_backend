import type { ConfigService } from '@nestjs/config';
import type { UsuarioAutenticado } from '../../../compartilhado/auth/usuario-autenticado';
import type { Ambiente } from '../../../compartilhado/config/ambiente';
import { ErroNegocio } from '../../../compartilhado/erros/erro-negocio';
import type { PrismaService } from '../../../compartilhado/prisma/prisma.service';
import type { FilaEmailService } from '../../notificacao/aplicacao/fila-email.service';
import { CompartilhamentosService } from './compartilhamentos.service';
import type { PoliticaAcessoPet } from './politica-acesso-pet';

describe('CompartilhamentosService (UC-11, RN15)', () => {
  const tutor = { sub: 't1', tipo: 'TUTOR' } as UsuarioAutenticado;
  const compartilhamento = {
    id: 'c1',
    petId: 'p1',
    empresaId: null,
    destinatarioEmail: 'vet@exemplo.com',
    escopos: ['VACINAS', 'ALERGIAS'],
    dataExpiracao: null,
    status: 'ATIVO' as const,
    pet: { nome: 'Thor' },
  };

  const montar = () => {
    const prisma = {
      compartilhamentoPet: {
        findMany: jest.fn().mockResolvedValue([compartilhamento]),
        findUnique: jest.fn().mockResolvedValue(compartilhamento),
        create: jest.fn().mockResolvedValue(compartilhamento),
        update: jest.fn().mockResolvedValue(compartilhamento),
      },
      empresaEnterprise: {
        findUnique: jest.fn().mockResolvedValue({ id: 'e1' }),
      },
      tutor: { findUnique: jest.fn().mockResolvedValue({ nome: 'Ana' }) },
      pet: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          nome: 'Thor',
          sexo: 'MACHO',
          castrado: true,
          dataNascimento: null,
          raca: { nome: 'SRD', especie: { nome: 'Cachorro' } },
        }),
      },
      vacinacao: {
        findMany: jest.fn().mockResolvedValue([
          {
            nomeVacina: 'V10',
            dataAplicacao: new Date('2026-10-01'),
            dataProximaDose: null,
            responsavelAplicacao: 'Dra.',
          },
        ]),
      },
      exame: { findMany: jest.fn().mockResolvedValue([]) },
      tratamentoMedicamentoso: { findMany: jest.fn().mockResolvedValue([]) },
      alergiaRestricao: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const fila = { enviar: jest.fn().mockResolvedValue(undefined) };
    const servico = new CompartilhamentosService(
      prisma as unknown as PrismaService,
      {
        nivel: jest.fn().mockResolvedValue('RESPONSAVEL_PRINCIPAL'),
      } as unknown as PoliticaAcessoPet,
      fila as unknown as FilaEmailService,
      { get: () => 'http://web.exemplo' } as unknown as ConfigService<
        Ambiente,
        true
      >,
    );
    return { prisma, fila, servico };
  };
  const codigo = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as ErroNegocio).codigo;
    }
    return 'SEM_ERRO';
  };

  it('CT-11-01: deve criar o link, guardar só o hash e mandar o e-mail', async () => {
    const { prisma, fila, servico } = montar();
    const criado = await servico.compartilhar(tutor, 'p1', {
      destinatarioEmail: 'Vet@Exemplo.com',
      escopos: ['VACINAS', 'ALERGIAS', 'VACINAS'],
    });
    const token = criado.link!.split('/compartilhado/')[1];
    const gravado = (
      prisma.compartilhamentoPet.create.mock.calls[0] as [
        { data: { token: string; escopos: string[] } },
      ]
    )[0].data;
    expect(gravado.token).not.toBe(token);
    expect(gravado.escopos).toEqual(['VACINAS', 'ALERGIAS']);
    expect(fila.enviar).toHaveBeenCalledWith(
      'COMPARTILHAMENTO_PET',
      'vet@exemplo.com',
      expect.objectContaining({ secoes: 'vacinas, alergias e restrições' }),
    );
    await expect(servico.listar(tutor, 'p1')).resolves.toHaveLength(1);
  });

  it('CT-11-02: deve mostrar só as seções compartilhadas e cortar link revogado', async () => {
    const { prisma, servico } = montar();
    await expect(servico.verPorLink('t')).resolves.toMatchObject({
      secoes: ['vacinas', 'alergias'],
    });
    await expect(servico.secaoPorLink('t', 'vacinas')).resolves.toHaveLength(1);
    await expect(servico.secaoPorLink('t', 'alergias')).resolves.toEqual([]);
    expect(await codigo(servico.secaoPorLink('t', 'exames'))).toBe(
      'SEM_PERMISSAO',
    );
    prisma.compartilhamentoPet.findUnique.mockResolvedValueOnce({
      ...compartilhamento,
      status: 'REVOGADO',
    });
    expect(await codigo(servico.verPorLink('t'))).toBe('LINK_EXPIRADO');
    await servico.revogar(tutor, 'c1');
    expect(prisma.compartilhamentoPet.update).toHaveBeenCalled();
    expect(
      await codigo(servico.compartilhar(tutor, 'p1', { escopos: ['VACINAS'] })),
    ).toBe('DADOS_INVALIDOS');
  });
});

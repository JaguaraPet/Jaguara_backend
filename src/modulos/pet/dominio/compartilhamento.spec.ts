import { situacao, validarCompartilhamento } from './compartilhamento';

describe('compartilhamento do pet (UC-11, RN15)', () => {
  const agora = new Date('2026-11-21T12:00:00Z');

  it('deve exigir um destino só e expiração futura', () => {
    expect(
      validarCompartilhamento(
        { destinatarioEmail: 'vet@exemplo.com', escopos: ['VACINAS'] },
        agora,
      ),
    ).toBeNull();
    expect(
      validarCompartilhamento({ escopos: ['VACINAS'] }, agora)?.campo,
    ).toBe('empresaId');
    expect(
      validarCompartilhamento(
        {
          empresaId: 'e1',
          destinatarioEmail: 'vet@exemplo.com',
          escopos: ['VACINAS'],
        },
        agora,
      )?.campo,
    ).toBe('empresaId');
    expect(
      validarCompartilhamento(
        {
          empresaId: 'e1',
          escopos: ['VACINAS'],
          dataExpiracao: '2026-11-20T00:00:00Z',
        },
        agora,
      )?.campo,
    ).toBe('dataExpiracao');
  });

  it('deve reservar a edição clínica para empresas', () => {
    expect(
      validarCompartilhamento(
        { destinatarioEmail: 'a@b.c', escopos: ['EDICAO_CLINICA'] },
        agora,
      )?.campo,
    ).toBe('escopos');
    expect(
      validarCompartilhamento(
        { empresaId: 'e1', escopos: ['EXAMES', 'EDICAO_CLINICA'] },
        agora,
      ),
    ).toBeNull();
  });

  it('deve tratar o link vencido como expirado', () => {
    expect(situacao({ status: 'ATIVO', dataExpiracao: null }, agora)).toBe(
      'ATIVO',
    );
    expect(
      situacao(
        { status: 'ATIVO', dataExpiracao: new Date('2026-11-21T11:00:00Z') },
        agora,
      ),
    ).toBe('EXPIRADO');
    expect(situacao({ status: 'REVOGADO', dataExpiracao: null }, agora)).toBe(
      'REVOGADO',
    );
  });
});

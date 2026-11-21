import { podeAcessarSaude } from './acesso-saude';
import { validarVacinacao } from './vacinacao';

describe('saúde do pet (RN15, RN17, RN30)', () => {
  const tutor = {
    nivel: 'RESPONSAVEL' as const,
    permissoes: ['saude:ler', 'saude:editar'],
    escopos: [],
    clienteSemConta: false,
  };
  const empresa = {
    nivel: 'EMPRESA' as const,
    permissoes: ['atendimento:ler', 'atendimento:editar'],
    escopos: ['PERFIL_BASICO', 'VACINAS'],
    clienteSemConta: false,
  };

  it('deve liberar o tutor responsável conforme as permissões do perfil', () => {
    expect(
      podeAcessarSaude({ ...tutor, escopo: 'EXAMES', modo: 'editar' }),
    ).toBe(true);
    expect(
      podeAcessarSaude({
        ...tutor,
        permissoes: ['saude:ler'],
        escopo: 'EXAMES',
        modo: 'editar',
      }),
    ).toBe(false);
    expect(
      podeAcessarSaude({
        ...tutor,
        nivel: 'NENHUM',
        escopo: 'VACINAS',
        modo: 'ler',
      }),
    ).toBe(false);
  });

  it('CT-36-02: deve limitar a empresa aos escopos compartilhados', () => {
    expect(
      podeAcessarSaude({ ...empresa, escopo: 'VACINAS', modo: 'ler' }),
    ).toBe(true);
    expect(
      podeAcessarSaude({ ...empresa, escopo: 'EXAMES', modo: 'ler' }),
    ).toBe(false);
    expect(
      podeAcessarSaude({ ...empresa, escopo: 'VACINAS', modo: 'editar' }),
    ).toBe(false);
    expect(
      podeAcessarSaude({
        ...empresa,
        escopos: ['VACINAS', 'EDICAO_CLINICA'],
        escopo: 'VACINAS',
        modo: 'editar',
      }),
    ).toBe(true);
    expect(
      podeAcessarSaude({
        ...empresa,
        permissoes: ['atendimento:ler'],
        escopos: ['VACINAS', 'EDICAO_CLINICA'],
        escopo: 'VACINAS',
        modo: 'editar',
      }),
    ).toBe(false);
    expect(
      podeAcessarSaude({
        ...empresa,
        escopos: [],
        clienteSemConta: true,
        escopo: 'EXAMES',
        modo: 'editar',
      }),
    ).toBe(true);
  });

  it('CT-13-02: deve exigir responsável, aplicação não futura e próxima dose depois', () => {
    const hoje = '2026-11-21';
    const base = {
      responsavelAplicacao: 'Dra. Júlia',
      dataAplicacao: '2026-11-20',
    };
    expect(validarVacinacao(base, hoje)).toBeNull();
    expect(
      validarVacinacao({ ...base, responsavelAplicacao: '  ' }, hoje)?.campo,
    ).toBe('responsavelAplicacao');
    expect(
      validarVacinacao({ ...base, dataAplicacao: '2026-11-22' }, hoje)?.campo,
    ).toBe('dataAplicacao');
    expect(
      validarVacinacao({ ...base, dataProximaDose: '2026-11-20' }, hoje)?.campo,
    ).toBe('dataProximaDose');
  });
});

import {
  assinaturaVigente,
  normalizarConteudo,
  participa,
  podeIniciar,
  salasDaConversa,
} from './conversa';

describe('conversa (UC-43, RN25)', () => {
  const tutor = { id: 't1', tipo: 'TUTOR' as const, empresaId: null };
  const atendente = { id: 'f1', tipo: 'FUNCIONARIO' as const, empresaId: 'e1' };

  it('CT-43-01: deve deixar o tutor com vínculo abrir conversa com a empresa', () => {
    expect(
      podeIniciar(
        tutor,
        { tipo: 'EMPRESA', empresaId: 'e1' },
        { temVinculoEmpresa: true, temPantera: false },
      ),
    ).toBeNull();
    expect(
      podeIniciar(
        tutor,
        { tipo: 'EMPRESA', empresaId: 'e1' },
        { temVinculoEmpresa: false, temPantera: true },
      ),
    ).toBe('SEM_VINCULO_EMPRESA');
    expect(
      podeIniciar(
        tutor,
        { tipo: 'EMPRESA' },
        { temVinculoEmpresa: true, temPantera: true },
      ),
    ).toBe('EMPRESA_OBRIGATORIA');
  });

  it('CT-43-02: deve bloquear o assistente sem PANTERA ativo', () => {
    const situacao = { temVinculoEmpresa: false, temPantera: false };
    expect(podeIniciar(tutor, { tipo: 'ASSISTENTE_VIRTUAL' }, situacao)).toBe(
      'SEM_PANTERA',
    );
    expect(
      podeIniciar(
        tutor,
        { tipo: 'ASSISTENTE_VIRTUAL' },
        { ...situacao, temPantera: true },
      ),
    ).toBeNull();
    expect(
      podeIniciar(atendente, { tipo: 'ASSISTENTE_VIRTUAL' }, situacao),
    ).toBe('SO_TUTOR_INICIA');
  });

  it('deve limitar a conversa ao tutor dono e à empresa dela', () => {
    const daEmpresa = {
      tipo: 'EMPRESA' as const,
      tutorId: 't1',
      empresaId: 'e1',
    };
    const assistente = {
      tipo: 'ASSISTENTE_VIRTUAL' as const,
      tutorId: 't1',
      empresaId: null,
    };
    expect(participa(tutor, daEmpresa)).toBe(true);
    expect(participa({ ...tutor, id: 't2' }, daEmpresa)).toBe(false);
    expect(participa(atendente, daEmpresa)).toBe(true);
    expect(participa({ ...atendente, empresaId: 'e2' }, daEmpresa)).toBe(false);
    expect(participa(atendente, assistente)).toBe(false);
    expect(
      participa({ id: 'a', tipo: 'ADMINISTRADOR', empresaId: null }, daEmpresa),
    ).toBe(false);
  });

  it('deve recusar mensagem vazia ou longa demais', () => {
    expect(normalizarConteudo('  Oi  ')).toEqual({ ok: true, texto: 'Oi' });
    expect(normalizarConteudo('   ').ok).toBe(false);
    expect(normalizarConteudo(42).ok).toBe(false);
    expect(normalizarConteudo('a'.repeat(4001)).ok).toBe(false);
  });

  it('deve considerar só a assinatura PANTERA ativa e dentro do prazo', () => {
    const hoje = new Date('2026-11-20T15:00:00Z');
    const base = { plano: 'PANTERA', status: 'ATIVA', dataFim: null };
    expect(assinaturaVigente(base, hoje)).toBe(true);
    expect(
      assinaturaVigente({ ...base, dataFim: new Date('2026-11-20') }, hoje),
    ).toBe(true);
    expect(
      assinaturaVigente({ ...base, dataFim: new Date('2026-11-19') }, hoje),
    ).toBe(false);
    expect(assinaturaVigente({ ...base, status: 'CANCELADA' }, hoje)).toBe(
      false,
    );
    expect(
      assinaturaVigente(
        { ...base, status: 'CANCELADA', dataFim: new Date('2026-12-01') },
        hoje,
      ),
    ).toBe(true);
    expect(assinaturaVigente({ ...base, status: 'PENDENTE' }, hoje)).toBe(
      false,
    );
    expect(assinaturaVigente({ ...base, plano: 'GRATUITO' }, hoje)).toBe(false);
  });

  it('deve avisar o tutor e a empresa da mensagem nova', () => {
    expect(
      salasDaConversa({ tipo: 'EMPRESA', tutorId: 't1', empresaId: 'e1' }),
    ).toEqual(['usuario:t1', 'empresa:e1']);
    expect(
      salasDaConversa({
        tipo: 'ASSISTENTE_VIRTUAL',
        tutorId: 't1',
        empresaId: null,
      }),
    ).toEqual(['usuario:t1']);
  });
});

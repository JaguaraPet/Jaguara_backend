import {
  descreverPet,
  excedeuLimite,
  idadeAproximada,
  INSTRUCOES_SISTEMA,
  prepararHistorico,
} from './assistente';

describe('assistente virtual (UC-43, ARQ-03)', () => {
  const hoje = new Date('2026-11-20T12:00:00Z');

  it('deve mandar só a idade aproximada, sem a data de nascimento', () => {
    expect(idadeAproximada(null, hoje)).toBeNull();
    expect(idadeAproximada(new Date('2026-10-01'), hoje)).toBe(
      'menos de 2 meses',
    );
    expect(idadeAproximada(new Date('2026-05-21'), hoje)).toBe('5 meses');
    expect(idadeAproximada(new Date('2025-11-20'), hoje)).toBe('1 ano');
    expect(idadeAproximada(new Date('2020-12-01'), hoje)).toBe('5 anos');
    expect(idadeAproximada(new Date('2027-01-01'), hoje)).toBeNull();
  });

  it('deve descrever espécie, raça, idade e alergias do pet', () => {
    const texto = descreverPet({
      nome: 'Thor',
      especie: 'Cachorro',
      raca: 'SRD',
      idade: '3 anos',
      alergias: ['Frango (gravidade alta)'],
    });
    expect(texto).toContain('Cachorro, raça SRD');
    expect(texto).toContain('Frango (gravidade alta)');
    expect(descreverPet(null)).toContain('não escolheu');
    expect(
      descreverPet({
        nome: 'Mia',
        especie: 'Gato',
        raca: 'Siamês',
        idade: null,
        alergias: [],
      }),
    ).toContain('nenhuma registrada');
  });

  it('deve proibir diagnóstico e prescrição nas instruções fixas (R08)', () => {
    expect(INSTRUCOES_SISTEMA).toMatch(/não faça diagnóstico/i);
    expect(INSTRUCOES_SISTEMA).toMatch(/não prescreva/i);
  });

  it('deve montar o histórico alternado começando e terminando no tutor', () => {
    expect(
      prepararHistorico([
        { papel: 'assistente', texto: 'Olá!' },
        { papel: 'tutor', texto: 'Oi' },
        { papel: 'tutor', texto: 'Tudo bem?' },
        { papel: 'assistente', texto: 'Sim' },
        { papel: 'tutor', texto: 'E o Thor?' },
      ]),
    ).toEqual([
      { papel: 'tutor', texto: 'Oi\n\nTudo bem?' },
      { papel: 'assistente', texto: 'Sim' },
      { papel: 'tutor', texto: 'E o Thor?' },
    ]);
    expect(prepararHistorico([{ papel: 'assistente', texto: 'Olá!' }])).toEqual(
      [],
    );
    expect(
      prepararHistorico([
        { papel: 'tutor', texto: 'Oi' },
        { papel: 'assistente', texto: 'Olá' },
      ]),
    ).toEqual([{ papel: 'tutor', texto: 'Oi' }]);
  });

  it('deve bloquear quando chega ao limite do dia', () => {
    expect(excedeuLimite(29, 30)).toBe(false);
    expect(excedeuLimite(30, 30)).toBe(true);
  });
});

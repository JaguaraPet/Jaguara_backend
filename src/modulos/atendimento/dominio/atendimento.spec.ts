import {
  alteracoes,
  jaOcorreu,
  totalDosItens,
  valorDoItem,
} from './atendimento';

describe('atendimento (UC-23, RN27, RN28)', () => {
  it('CT-23-01: deve cobrar o serviço agendado pelo preço contratado', () => {
    const agendado = { servicoId: 'banho', precoContratado: 60 };
    expect(valorDoItem({ servicoId: 'banho' }, agendado, 70)).toBe(60);
    expect(valorDoItem({ servicoId: 'hidratacao' }, agendado, 25)).toBe(25);
  });

  it('deve somar os itens sem erro de arredondamento', () => {
    expect(
      totalDosItens([
        { servicoId: 'a', quantidade: 3, valorUnitario: 0.1 },
        { servicoId: 'b', quantidade: 1, valorUnitario: 60 },
      ]),
    ).toBe(60.3);
    expect(totalDosItens([])).toBe(0);
  });

  it('deve exigir que o horário do agendamento já tenha começado', () => {
    const agora = new Date('2026-11-21T15:00:00Z');
    expect(jaOcorreu(new Date('2026-11-21T14:00:00Z'), agora)).toBe(true);
    expect(jaOcorreu(agora, agora)).toBe(true);
    expect(jaOcorreu(new Date('2026-11-21T16:00:00Z'), agora)).toBe(false);
  });

  it('deve listar só os campos alterados para a auditoria', () => {
    expect(
      alteracoes(
        {
          observacoesClinicas: 'Sem alterações',
          procedimentosRealizados: 'Banho',
        },
        { observacoesClinicas: 'Otite leve', procedimentosRealizados: 'Banho' },
      ),
    ).toEqual([
      {
        campo: 'observacoesClinicas',
        antes: 'Sem alterações',
        depois: 'Otite leve',
      },
    ]);
    expect(
      alteracoes(
        { observacoesClinicas: null },
        { observacoesClinicas: undefined },
      ),
    ).toEqual([]);
  });
});

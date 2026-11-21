import { cruzam, fimDoEvento, tipoDaCategoria } from './evento';

describe('calendário do pet (UC-10, RN14, RN37)', () => {
  const h = (hora: string) => new Date(`2026-11-21T${hora}:00-03:00`);

  it('deve dar uma hora ao evento sem fim', () => {
    expect(fimDoEvento(h('10:00')).toISOString()).toBe(
      h('11:00').toISOString(),
    );
    expect(fimDoEvento(h('10:00'), h('10:30'))).toEqual(h('10:30'));
  });

  it('CT-10-02: deve detectar compromissos que se cruzam', () => {
    const consulta = { inicio: h('10:00'), fim: h('11:00') };
    expect(cruzam(consulta, { inicio: h('10:30'), fim: h('11:30') })).toBe(
      true,
    );
    expect(cruzam(consulta, { inicio: h('11:00'), fim: h('12:00') })).toBe(
      false,
    );
    expect(cruzam(consulta, { inicio: h('09:00'), fim: h('10:00') })).toBe(
      false,
    );
  });

  it('deve tirar o tipo do evento da categoria do serviço', () => {
    expect(tipoDaCategoria('VACINACAO')).toBe('VACINA');
    expect(tipoDaCategoria('CRECHE')).toBe('HOSPEDAGEM');
    expect(tipoDaCategoria('PET_SITTER')).toBe('COMPROMISSO');
  });
});

import type { EventoExterno } from '../dominio/calendario-externo';

/** Porta do calendário externo (UC-09). */
export interface ProvedorCalendario {
  readonly nome: 'google' | 'simulado';
  /** Endereço de consentimento do provedor; ele volta para `retorno` com code e state. */
  urlAutorizacao(estado: string, retorno: string): string;
  /** Troca o código pelo token de atualização e a conta do usuário no provedor. */
  trocarCodigo(
    codigo: string,
    retorno: string,
  ): Promise<{ tokenAtualizacao: string; conta: string }>;
  /** Eventos do calendário principal no período. */
  listarEventos(
    tokenAtualizacao: string,
    de: Date,
    ate: Date,
  ): Promise<EventoExterno[]>;
}

export const PROVEDOR_CALENDARIO = Symbol('PROVEDOR_CALENDARIO');

const ESCOPO = 'https://www.googleapis.com/auth/calendar.readonly openid email';

interface EventoGoogle {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

/** Data do Google: com hora, ou dia inteiro (que começa às 00h de Brasília). */
const dataGoogle = (d?: { dateTime?: string; date?: string }) =>
  d?.dateTime
    ? new Date(d.dateTime)
    : d?.date
      ? new Date(`${d.date}T00:00:00-03:00`)
      : undefined;

/** Google Agenda pela API REST, só leitura (ARQ-03). */
export class CalendarioGoogle implements ProvedorCalendario {
  readonly nome = 'google' as const;

  constructor(
    private readonly clienteId: string,
    private readonly segredo: string,
    private readonly http: typeof fetch = (...a) => fetch(...a),
  ) {}

  urlAutorizacao(estado: string, retorno: string): string {
    const p = new URLSearchParams({
      client_id: this.clienteId,
      redirect_uri: retorno,
      response_type: 'code',
      scope: ESCOPO,
      access_type: 'offline',
      prompt: 'consent',
      state: estado,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
  }

  async trocarCodigo(codigo: string, retorno: string) {
    const resposta = await this.http('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: codigo,
        client_id: this.clienteId,
        client_secret: this.segredo,
        redirect_uri: retorno,
        grant_type: 'authorization_code',
      }).toString(),
    });
    const corpo = (await resposta.json()) as {
      refresh_token?: string;
      id_token?: string;
    };
    if (!resposta.ok || !corpo.refresh_token)
      throw new Error('O Google não autorizou o acesso.');
    const conta = corpo.id_token
      ? ((
          JSON.parse(
            Buffer.from(corpo.id_token.split('.')[1], 'base64url').toString(),
          ) as { email?: string }
        ).email ?? 'conta Google')
      : 'conta Google';
    return { tokenAtualizacao: corpo.refresh_token, conta };
  }

  async listarEventos(
    tokenAtualizacao: string,
    de: Date,
    ate: Date,
  ): Promise<EventoExterno[]> {
    const token = await this.http('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: tokenAtualizacao,
        client_id: this.clienteId,
        client_secret: this.segredo,
        grant_type: 'refresh_token',
      }).toString(),
    });
    const acesso = (await token.json()) as { access_token?: string };
    if (!token.ok || !acesso.access_token)
      throw new Error('AUTORIZACAO_REVOGADA');
    const p = new URLSearchParams({
      timeMin: de.toISOString(),
      timeMax: ate.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });
    const resposta = await this.http(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${p.toString()}`,
      { headers: { Authorization: `Bearer ${acesso.access_token}` } },
    );
    if (!resposta.ok)
      throw new Error(`Google Agenda respondeu ${resposta.status}`);
    const { items = [] } = (await resposta.json()) as {
      items?: EventoGoogle[];
    };
    return items
      .filter((e) => e.status !== 'cancelled' && dataGoogle(e.start))
      .map((e) => ({
        idExterno: e.id,
        titulo: (e.summary ?? 'Compromisso').slice(0, 255),
        descricao: e.description,
        local: e.location?.slice(0, 255),
        inicio: dataGoogle(e.start)!,
        fim: dataGoogle(e.end),
      }));
  }
}

/**
 * Calendário sem credenciais do Google (desenvolvimento e testes): a autorização volta direto
 * para a API com o código "simulado" e a sincronização traz dois compromissos de exemplo.
 */
export class CalendarioSimulado implements ProvedorCalendario {
  readonly nome = 'simulado' as const;

  urlAutorizacao(estado: string, retorno: string): string {
    return `${retorno}?${new URLSearchParams({ code: 'simulado', state: estado }).toString()}`;
  }

  trocarCodigo(codigo: string) {
    if (codigo !== 'simulado')
      return Promise.reject(new Error('Código inválido'));
    return Promise.resolve({
      tokenAtualizacao: 'token-simulado',
      conta: 'agenda.simulada@exemplo.com',
    });
  }

  listarEventos(_token: string, de: Date): Promise<EventoExterno[]> {
    const dia = (n: number, hora: number) =>
      new Date(
        Date.UTC(
          de.getUTCFullYear(),
          de.getUTCMonth(),
          de.getUTCDate() + n,
          hora + 3,
        ),
      );
    return Promise.resolve([
      {
        idExterno: 'simulado-1',
        titulo: 'Passeio no parque',
        inicio: dia(2, 8),
        fim: dia(2, 9),
      },
      {
        idExterno: 'simulado-2',
        titulo: 'Retorno ao veterinário',
        local: 'Clínica',
        inicio: dia(5, 15),
      },
    ]);
  }
}

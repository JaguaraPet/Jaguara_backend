import { createHash, createHmac } from 'node:crypto';

/**
 * URL assinada no padrão AWS Signature V4 (query string), aceita pelo SeaweedFS, MinIO e S3
 * (ADR-005). O arquivo vai e volta direto entre o aparelho e o armazenamento; a API só assina.
 */
export interface CredenciaisS3 {
  endpoint: string;
  regiao: string;
  bucket: string;
  chaveAcesso: string;
  chaveSecreta: string;
  /** true (padrão) para http://host/bucket/chave; false para http://bucket.host/chave. */
  estiloCaminho?: boolean;
}

/** Codificação RFC 3986 exigida pela assinatura; a barra só fica livre no caminho. */
export function codificar(texto: string, manterBarra = false): string {
  const codificado = encodeURIComponent(texto).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return manterBarra ? codificado.replace(/%2F/g, '/') : codificado;
}

const sha256 = (texto: string) =>
  createHash('sha256').update(texto, 'utf8').digest('hex');
const hmac = (chave: Buffer | string, texto: string) =>
  createHmac('sha256', chave).update(texto, 'utf8').digest();

/** Instante no formato da assinatura: 20261123T120000Z. */
const instante = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

export function assinarUrl(
  c: CredenciaisS3,
  pedido: {
    metodo: 'GET' | 'PUT';
    chave: string;
    expiraSegundos: number;
    agora?: Date;
    /** Parâmetros extras assinados, como response-content-disposition. */
    parametros?: Record<string, string>;
  },
): string {
  const base = new URL(c.endpoint);
  const estiloCaminho = c.estiloCaminho ?? true;
  const host = estiloCaminho ? base.host : `${c.bucket}.${base.host}`;
  const caminho = estiloCaminho
    ? `/${c.bucket}/${codificar(pedido.chave, true)}`
    : `/${codificar(pedido.chave, true)}`;
  const quando = instante(pedido.agora ?? new Date());
  const dia = quando.slice(0, 8);
  const escopo = `${dia}/${c.regiao}/s3/aws4_request`;

  const parametros: Record<string, string> = {
    ...pedido.parametros,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${c.chaveAcesso}/${escopo}`,
    'X-Amz-Date': quando,
    'X-Amz-Expires': String(pedido.expiraSegundos),
    'X-Amz-SignedHeaders': 'host',
  };
  const consulta = Object.keys(parametros)
    .sort()
    .map((k) => `${codificar(k)}=${codificar(parametros[k])}`)
    .join('&');

  const requisicaoCanonica = [
    pedido.metodo,
    caminho,
    consulta,
    `host:${host}`,
    '',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const textoAssinado = [
    'AWS4-HMAC-SHA256',
    quando,
    escopo,
    sha256(requisicaoCanonica),
  ].join('\n');
  const chaveAssinatura = hmac(
    hmac(hmac(hmac(`AWS4${c.chaveSecreta}`, dia), c.regiao), 's3'),
    'aws4_request',
  );
  const assinatura = createHmac('sha256', chaveAssinatura)
    .update(textoAssinado, 'utf8')
    .digest('hex');
  return `${base.protocol}//${host}${caminho}?${consulta}&X-Amz-Signature=${assinatura}`;
}

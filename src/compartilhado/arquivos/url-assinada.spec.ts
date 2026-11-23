import { assinarUrl, codificar } from './url-assinada';

describe('URL assinada S3 (ADR-005)', () => {
  it('deve reproduzir o exemplo oficial de URL pré-assinada da AWS', () => {
    // Exemplo "Authenticating Requests: Using Query Parameters" da documentação do S3.
    const url = assinarUrl(
      {
        endpoint: 'https://s3.amazonaws.com',
        regiao: 'us-east-1',
        bucket: 'examplebucket',
        chaveAcesso: 'AKIAIOSFODNN7EXAMPLE',
        chaveSecreta: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        estiloCaminho: false,
      },
      {
        metodo: 'GET',
        chave: 'test.txt',
        expiraSegundos: 86400,
        agora: new Date('2013-05-24T00:00:00Z'),
      },
    );
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('deve usar o estilo de caminho e codificar a chave', () => {
    const url = assinarUrl(
      {
        endpoint: 'http://localhost:8333',
        regiao: 'us-east-1',
        bucket: 'jaguara-arquivos',
        chaveAcesso: 'jaguara',
        chaveSecreta: 'segredo',
      },
      { metodo: 'PUT', chave: 'pets/p1/laudo final.pdf', expiraSegundos: 300 },
    );
    expect(url).toMatch(
      /^http:\/\/localhost:8333\/jaguara-arquivos\/pets\/p1\/laudo%20final\.pdf\?/,
    );
    expect(url).toContain('X-Amz-Expires=300');
    expect(codificar("a/b c!'")).toBe('a%2Fb%20c%21%27');
  });
});

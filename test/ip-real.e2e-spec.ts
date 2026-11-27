import { Controller, Get, INestApplication, Ip } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { Publica } from '../src/compartilhado/auth/usuario-autenticado';
import { criarAppTeste } from './utils/app';

@Controller('teste-ip')
class IpTesteController {
  @Publica()
  @Get()
  ip(@Ip() ip: string) {
    return { ip };
  }
}

describe('IP de quem acessa, atrás do proxy do CapRover', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await criarAppTeste({ controllers: [IpTesteController] });
  });

  afterAll(async () => {
    await app.close();
  });

  it('deve usar o IP repassado pelo proxy, para os limites e a auditoria serem por pessoa', async () => {
    const resposta = await request(app.getHttpServer())
      .get('/v1/teste-ip')
      .set('X-Forwarded-For', '203.0.113.7')
      .expect(200);
    expect(resposta.body).toEqual({ ip: '203.0.113.7' });
  });

  it('deve ignorar IPs forjados antes do último salto do proxy', async () => {
    const resposta = await request(app.getHttpServer())
      .get('/v1/teste-ip')
      .set('X-Forwarded-For', '198.51.100.1, 203.0.113.8')
      .expect(200);
    expect(resposta.body).toEqual({ ip: '203.0.113.8' });
  });
});

# Jaguara · Backend

API REST e WebSocket e worker de filas do Jaguara, em NestJS (ADR-004), organizados como monólito modular.

## Rodar

```bash
npm install
npm run start:dev          # API em http://localhost:3000
npm run start:worker:dev   # worker
```

## Estrutura

```text
src/
  modulos/          um módulo por pacote do domínio (MOD-01)
    <modulo>/       http/ aplicacao/ dominio/ infra/
  compartilhado/    auth, erros, auditoria, prisma, config, status
  main.ts           API
  worker.ts         worker
test/               testes de API (Jest + Supertest)
```

Camadas e regras de dependência no ARQ-01, seção 5.2.

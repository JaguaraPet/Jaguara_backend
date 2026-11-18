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

## Banco de dados

O PostgreSQL 16 roda em Docker (ADR-005):

```bash
docker compose up -d postgres
```

| Banco | Uso | Conexão |
|---|---|---|
| `jaguara` | Desenvolvimento | `postgresql://jaguara:jaguara@localhost:5432/jaguara` |
| `jaguara_teste` | Testes automatizados | `postgresql://jaguara:jaguara@localhost:5432/jaguara_teste` |

Na primeira subida, o script `docker/postgres/init/01-bancos.sql` cria o banco de testes e as extensões `pgcrypto` (identificadores `uuid`) e `btree_gist` (restrições contra agendamentos sobrepostos). Para recriar tudo do zero: `docker compose down -v` e suba de novo.

As credenciais acima são só do ambiente local.

## Dependências

- Gerenciador: **npm** (versão 11 ou maior), com o `package-lock.json` versionado. Instale com `npm ci` para reproduzir exatamente as versões do lock.
- Node.js **24 LTS**, fixado no `.nvmrc` (`nvm use`). O `engine-strict` do `.npmrc` recusa versões abaixo disso.
- Atualizações: o Dependabot abre pull requests semanais para pacotes npm (correções e versões menores agrupadas) e mensais para as actions do GitHub.

## Integração e entrega contínuas

- **CI** (`.github/workflows/ci.yml`): em todo pull request, roda lint, verificação de tipos, testes e build, além da auditoria das dependências de produção. O pull request só entra com o CI verde (ADR-008).
- **CD** (`.github/workflows/cd.yml`): a cada merge na `main` publica a imagem `ghcr.io/jaguarapet/jaguara-backend` com a tag `homologacao` e, a cada tag `vX.Y.Z`, com a versão. Com as variáveis do CapRover configuradas no repositório, implanta a API e o worker (ENT-01).

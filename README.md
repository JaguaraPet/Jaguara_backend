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

## Modelo de dados (Prisma)

O schema `prisma/schema.prisma` representa as 57 tabelas e os 42 enums do MOD-03, com modelos em PascalCase e campos em camelCase mapeados para os nomes do banco (`@@map` e `@map`). A migração inicial `prisma/migrations/20261115120000_inicial` é o script validado do MOD-03 e inclui as restrições que o Prisma não expressa (CHECK e EXCLUDE contra agendamentos sobrepostos).

```bash
npm run prisma:deploy     # aplica as migrações no banco do DATABASE_URL
npm run prisma:migrate    # cria uma migração nova a partir de mudanças no schema
npm run prisma:generate   # gera o Prisma Client em src/generated (roda também no npm install)
npm run prisma:studio     # abre o Prisma Studio
```

Mudanças no modelo: altere o MOD-03 e o `schema.prisma` juntos e gere a migração com `npm run prisma:migrate -- --name <descricao>`. Restrições CHECK e EXCLUDE novas vão escritas à mão no `migration.sql`.

## Dependências

- Gerenciador: **npm** (versão 11 ou maior), com o `package-lock.json` versionado. Instale com `npm ci` para reproduzir exatamente as versões do lock.
- Node.js **24 LTS**, fixado no `.nvmrc` (`nvm use`). O `engine-strict` do `.npmrc` recusa versões abaixo disso.
- Atualizações: o Dependabot abre pull requests semanais para pacotes npm (correções e versões menores agrupadas) e mensais para as actions do GitHub.

## Integração e entrega contínuas

- **CI** (`.github/workflows/ci.yml`): em todo pull request, roda lint, verificação de tipos, testes e build, além da auditoria das dependências de produção. O pull request só entra com o CI verde (ADR-008).
- **CD** (`.github/workflows/cd.yml`): a cada merge na `main` publica a imagem `ghcr.io/jaguarapet/jaguara-backend` com a tag `homologacao` e, a cada tag `vX.Y.Z`, com a versão. Com as variáveis do CapRover configuradas no repositório, implanta a API e o worker (ENT-01).

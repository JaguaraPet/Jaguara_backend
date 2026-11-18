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

## Ambiente local

Pré-requisitos: Node.js 24 (`nvm use`) e Docker.

```bash
cp .env.example .env        # variáveis do ambiente local
docker compose up -d        # PostgreSQL, Redis, armazenamento S3 e caixa de e-mail
npm install                 # também gera o Prisma Client
npm run prisma:deploy       # cria as tabelas
npm run start:dev           # API em http://localhost:3000
npm run start:worker:dev    # worker (em outro terminal)
```

| Serviço | Endereço | Uso |
|---|---|---|
| PostgreSQL 16 | `localhost:5432`, bancos `jaguara` e `jaguara_teste` | Dados (ADR-005) |
| Redis 7 | `localhost:6379` | Filas BullMQ e revogação de sessões (ADR-011, ADR-012) |
| Armazenamento S3 (SeaweedFS) | `http://localhost:8333`, bucket `jaguara-arquivos` | Fotos e documentos |
| Mailpit | SMTP `localhost:1025`, caixa em http://localhost:8025 | Todo e-mail enviado localmente aparece aqui |

Na primeira subida, `docker/postgres/init/01-bancos.sql` cria o banco de testes e as extensões `pgcrypto` e `btree_gist`, e o serviço `s3-bucket` cria o bucket. Para recriar tudo do zero: `docker compose down -v`.

Para rodar a API e o worker também em contêineres: `docker compose --profile completo up -d --build`.

As variáveis estão descritas no `.env.example` e são validadas na inicialização (`src/compartilhado/config/ambiente.ts`): a API não sobe com variável faltando ou inválida. As credenciais do `.env.example` servem só para o ambiente local.

## Modelo de dados (Prisma)

O schema `prisma/schema.prisma` representa as 57 tabelas e os 42 enums do MOD-03, com modelos em PascalCase e campos em camelCase mapeados para os nomes do banco (`@@map` e `@map`). A migração inicial `prisma/migrations/20261115120000_inicial` é o script validado do MOD-03 e inclui as restrições que o Prisma não expressa (CHECK e EXCLUDE contra agendamentos sobrepostos).

```bash
npm run prisma:deploy     # aplica as migrações no banco do DATABASE_URL
npm run prisma:migrate    # cria uma migração nova a partir de mudanças no schema
npm run prisma:generate   # gera o Prisma Client em src/generated (roda também no npm install)
npm run prisma:studio     # abre o Prisma Studio
```

Mudanças no modelo: altere o MOD-03 e o `schema.prisma` juntos e gere a migração com `npm run prisma:migrate -- --name <descricao>`. Restrições CHECK e EXCLUDE novas vão escritas à mão no `migration.sql`.

## Dados de teste (seed)

```bash
npm run prisma:seed         # banco de desenvolvimento (DATABASE_URL)
npm run prisma:seed:teste   # banco de testes (DATABASE_URL_TESTE), depois das migrações
```

O seed apaga os dados do banco e insere dados fictícios: permissões e perfis de acesso, um administrador, três tutores com quatro pets (o Thor tem dois responsáveis), duas empresas com perfis, funcionários, serviços, recursos e horários, um cliente com pet compartilhado e os termos vigentes. Nenhum dado é real: e-mails no domínio `exemplo.com` e CPFs e CNPJs gerados com dígitos válidos. Não roda com `NODE_ENV=production`.

Todos os usuários entram com a senha `Jaguara@2026`.

| Perfil | E-mail |
|---|---|
| Administrador | `admin@jaguara.exemplo.com` |
| Tutores | `ana.tutora@exemplo.com`, `bruno.tutor@exemplo.com`, `carla.tutora@exemplo.com` |
| Empresas | `clinica.patas@exemplo.com`, `banho.cheiroso@exemplo.com` |
| Funcionários | `dra.julia@exemplo.com`, `recepcao.patas@exemplo.com`, `tosador.leo@exemplo.com` |

## Dependências

- Gerenciador: **npm** (versão 11 ou maior), com o `package-lock.json` versionado. Instale com `npm ci` para reproduzir exatamente as versões do lock.
- Node.js **24 LTS**, fixado no `.nvmrc` (`nvm use`). O `engine-strict` do `.npmrc` recusa versões abaixo disso.
- Atualizações: o Dependabot abre pull requests semanais para pacotes npm (correções e versões menores agrupadas) e mensais para as actions do GitHub.

## Integração e entrega contínuas

- **CI** (`.github/workflows/ci.yml`): em todo pull request, roda lint, verificação de tipos, testes e build, além da auditoria das dependências de produção. O pull request só entra com o CI verde (ADR-008).
- **CD** (`.github/workflows/cd.yml`): a cada merge na `main` publica a imagem `ghcr.io/jaguarapet/jaguara-backend` com a tag `homologacao` e, a cada tag `vX.Y.Z`, com a versão. Com as variáveis do CapRover configuradas no repositório, implanta a API e o worker (ENT-01).

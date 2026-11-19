# Jaguara · Backend

API REST e WebSocket e worker de filas do Jaguara, em NestJS (ADR-004), organizados como monólito modular.


Novo no projeto? O [guia do ambiente de desenvolvimento (ENT-05)](https://github.com/JaguaraPet/Jaguara_doc/blob/main/docs/07-entrega/ENT-05-guia-do-ambiente.md) mostra como subir API, web e app juntos, do zero.

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
npm run start:dev           # API em http://localhost:3000/v1
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

## Autenticação e camada de acesso

Rotas sob o prefixo `/v1` (OpenAPI). Senha em hash Argon2id, access token JWT de 15 minutos e refresh token opaco ligado a uma `Sessao` (ADR-009). O banco guarda só o hash do refresh token, que é trocado a cada renovação.

| Rota | Uso |
|---|---|
| `POST /v1/auth/login` | UC-02: e-mail e senha. Cinco falhas seguidas bloqueiam a conta por 5 minutos (RN03, resposta 423). Conta com e-mail não confirmado recebe 403 (RN02). |
| `POST /v1/auth/renovacao` | Novo access token e novo refresh token. Encerra a sessão depois de 4 horas sem atividade (RN04) e relê as permissões do perfil. |
| `POST /v1/auth/logout` | Apaga a sessão e coloca o `sid` na lista de sessões revogadas do Redis: o access token deixa de valer na requisição seguinte. |

A camada de acesso é única para todas as rotas (ADR-012) e roda nesta ordem:

1. Cabeçalhos de segurança (Helmet), CORS liberado só para a web Enterprise, identificador da requisição (`X-Request-Id`) e limite de requisições por IP.
2. `AutenticacaoGuard`: valida o access token sem consultar o banco e recusa sessões revogadas; se o Redis cair, consulta a sessão no banco.
3. `PermissoesGuard`: confere o tipo de conta e as permissões do token. Nega por padrão.

Cada rota declara o acesso com um destes decoradores, e um teste automatizado falha se alguma rota ficar sem:

| Decorador | Uso |
|---|---|
| `@Publica()` | Rota sem login (login, cadastro, health check) |
| `@Autenticado()` | Qualquer usuário logado (logout, dados da própria conta) |
| `@Permissoes('agenda:editar', ...)` | Exige as permissões do perfil (RBAC, catálogo em `modulos/acesso/dominio/catalogo-permissoes.ts`) |
| `@SomenteTutor()`, `@SomenteEnterprise()`, `@SomenteAdministrador()` | Separa os contextos Tutor, Enterprise e administração (ADR-002) |

Nos serviços, `garantirMesmaEmpresa(usuario, empresaId)` garante que empresa e funcionários só vejam dados da própria empresa. Erros saem em `application/problem+json` com o campo `codigo` (por exemplo, `RN03_CONTA_BLOQUEADA` ou `SEM_PERMISSAO`).

## Filas e e-mail

O worker (`src/worker.ts`) processa as filas BullMQ no Redis, fora da requisição HTTP (ADR-011). A API só coloca o trabalho na fila.

- **E-mail transacional:** `FilaEmailService.enviar(tipo, para, dados)` enfileira; o `EmailProcessor` monta a mensagem (`modulos/notificacao/dominio/email.ts`) e envia pela porta `EnvioEmail` (ARQ-03). Falhas são tentadas de novo até 5 vezes, com espera exponencial a partir de 30 s.
- **Provedor:** `EMAIL_PROVEDOR=smtp` envia por SMTP; no ambiente local o Mailpit recebe tudo e mostra em http://localhost:8025, sem mandar nada para fora. `EMAIL_PROVEDOR=api` usa a API HTTP do provedor de e-mail transacional (Brevo) com `EMAIL_API_KEY`, em homologação e produção.
- **Mensagens:** confirmação de cadastro (UC-01, RN02) e recuperação de senha (UC-03, RN05).

## Testes

Plano e convenções no TST-01: arquivos `*.spec.ts` ao lado do código, nomes no formato "deve ... quando ...".

```bash
npm test             # unitários e de integração
npm run test:unit    # só unitários (sem banco nem rede)
npm run test:cov     # unitários com cobertura
npm run test:e2e     # integração e API (Jest + Supertest)
```

- **Unitários** (`src/**/*.spec.ts`): regras de domínio, validações e funções puras.
- **Integração e API** (`test/**/*.e2e-spec.ts`): o `test/setup/global-setup.ts` sobe um PostgreSQL 16 e um Redis 7 descartáveis com Testcontainers, aplica as migrações e aponta `DATABASE_URL` e `REDIS_URL` para eles. Cada execução começa com um banco novo; `limparBanco` (`test/utils/banco.ts`) esvazia as tabelas entre arquivos. Precisa do Docker ligado.
- **Cobertura:** meta de 70% de linhas no domínio, na aplicação e no código compartilhado (RNF09). Abaixo disso o `test:cov` falha e o pull request não entra. O CI publica o resumo na página da execução e o relatório completo como artefato `cobertura`.

## Documentação da API e contrato

O contrato oficial da API é o `openapi.yaml` do Jaguara_doc. Uma cópia fica em `contrato/openapi.yaml`:

- `npm run contrato:atualizar` baixa a versão da `main` do Jaguara_doc.
- O teste `test/contrato.e2e-spec.ts` falha se a API tiver alguma rota que não está no contrato (JAG-95). O CI também avisa quando a cópia está desatualizada.
- Fora de produção, o Swagger UI gerado pelos controladores fica em http://localhost:3000/v1/docs.

## Problemas comuns

| Sintoma | Solução |
|---|---|
| "Variáveis de ambiente inválidas" ao subir a API | `cp .env.example .env` e confira os valores |
| Porta 5432, 6379, 8333, 1025 ou 3000 em uso | Pare o serviço que usa a porta ou mude-a no `docker-compose.yml` e no `.env` |
| `npm run test:e2e` não inicia | Ligue o Docker: os testes sobem PostgreSQL e Redis descartáveis |
| Aviso de "install scripts" no `npm install` | Os scripts aprovados estão em `allowScripts` no `package.json`; aprove um novo só se for necessário |

## Dependências

- Gerenciador: **npm** (versão 11 ou maior), com o `package-lock.json` versionado. Instale com `npm ci` para reproduzir exatamente as versões do lock.
- Node.js **24 LTS**, fixado no `.nvmrc` (`nvm use`). O `engine-strict` do `.npmrc` recusa versões abaixo disso.
- Atualizações: o Dependabot abre pull requests semanais para pacotes npm (correções e versões menores agrupadas) e mensais para as actions do GitHub.

## Integração e entrega contínuas

- **CI** (`.github/workflows/ci.yml`): em todo pull request, roda lint, verificação de tipos, testes e build, além da auditoria das dependências de produção. O pull request só entra com o CI verde (ADR-008).
- **CD** (`.github/workflows/cd.yml`): a cada merge na `main` publica a imagem `ghcr.io/jaguarapet/jaguara-backend` com a tag `homologacao` e, a cada tag `vX.Y.Z`, com a versão. Com as variáveis do CapRover configuradas no repositório, implanta a API e o worker (ENT-01).

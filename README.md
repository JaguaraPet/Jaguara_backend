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
| `POST /v1/auth/cadastro/tutor` | UC-01: cria o tutor com status pendente, guarda o CPF cifrado com índice cego, registra o aceite dos termos vigentes (RN42) e manda o link de confirmação por e-mail. CPF ou e-mail repetido recebe 409 (RN01). |
| `POST /v1/auth/cadastro/empresa` | UC-32: o mesmo para a empresa, com CNPJ validado e os perfis padrão Proprietário, Atendente e Profissional. |
| `POST /v1/auth/confirmacao` | RN02: o link vale 24 horas e uma única vez; ativa a conta. Link vencido, usado ou desconhecido recebe 410. |
| `POST /v1/auth/login` | UC-02: e-mail e senha. Cinco falhas seguidas bloqueiam a conta por 5 minutos (RN03, resposta 423). Conta com e-mail não confirmado recebe 403 (RN02). |
| `POST /v1/auth/renovacao` | Novo access token e novo refresh token. Encerra a sessão depois de 4 horas sem atividade (RN04) e relê as permissões do perfil. |
| `POST /v1/auth/logout` | Apaga a sessão e coloca o `sid` na lista de sessões revogadas do Redis: o access token deixa de valer na requisição seguinte. |

Na inicialização, a API sincroniza no banco o catálogo de permissões e os perfis globais Tutor, Administrador e Empresa (`CatalogoAcessoService`), sem apagar o que o administrador acrescentou. A senha precisa de pelo menos 8 caracteres, com letras e números.

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

## Pets (UC-04)

| Rota | Uso |
|---|---|
| `GET /v1/especies` | Espécies e raças cadastradas, para escolher na lista (RN07). |
| `GET` e `POST /v1/pets` | Pets do tutor, com filtro por situação e paginação. Quem cadastra vira responsável principal (RN09). |
| `GET` e `PATCH /v1/pets/{petId}` | Perfil e edição. Os responsáveis editam; empresas leem com compartilhamento ativo, agendamento ou cliente (RN24, RN26) e só editam pet de cliente sem conta delas (ADR-010, RN30). |
| `DELETE /v1/pets/{petId}` e `POST .../arquivamento` | Só o responsável principal. Com histórico clínico ou financeiro, a exclusão é recusada e o pet pode ser arquivado (RN08). |

A regra de acesso ao pet fica em um lugar só, a `PoliticaAcessoPet` (ADR-012, passo 5), e faz só a consulta que cada caso exige.

## Funcionários (UC-19)

| Rota | Uso |
|---|---|
| `GET /v1/empresas/{empresaId}/funcionarios` | Lista a equipe (permissão `funcionario:ler`). |
| `POST /v1/empresas/{empresaId}/funcionarios` | Cadastra com um perfil da própria empresa e envia o convite por e-mail. O funcionário confirma o e-mail e cria a senha em `POST /v1/auth/confirmacao` (campo `senha`). |
| `PATCH /v1/funcionarios/{funcionarioId}` | Troca o perfil de acesso (UC-16) e encerra as sessões abertas, para as permissões novas valerem na hora. |
| `DELETE /v1/funcionarios/{funcionarioId}` | Desliga o funcionário: conta inativa e todas as sessões revogadas na hora (RN23). |

## Catálogo de serviços e recursos (UC-33 e UC-38)

| Rota | Uso |
|---|---|
| `GET /v1/empresas/{empresaId}/servicos` | Catálogo da empresa. Tutores e outras empresas veem só os serviços ativos (UC-33); a própria empresa vê todos. |
| `GET /v1/empresas` e `GET /v1/empresas/{empresaId}` | Busca pública para o tutor (UC-33), por nome da empresa ou do serviço, tipo, categoria e cidade, com paginação. Só aparecem empresas ativas com serviços ativos, e só dados públicos (sem CNPJ nem e-mail). |
| `POST /v1/empresas/{empresaId}/servicos` e `PATCH /v1/servicos/{servicoId}` | Cadastra, edita e desativa serviços (`servico:editar`). O preço contratado fica no agendamento, então mudar o preço não altera o que já foi contratado (RN27). |
| `GET` e `POST /v1/empresas/{empresaId}/horarios-atuacao`, `DELETE /v1/horarios-atuacao/{horarioId}` | Horários de atuação de cada profissional ou recurso (UC-24): um dos dois por horário (RC-20) e sem sobreposição no mesmo dia (RN29). |
| `GET` e `POST /v1/empresas/{empresaId}/recursos`, `PATCH /v1/recursos/{recursoId}` | Salas, equipamentos, baias e veículos da empresa (`recurso:editar`). Rotas acrescentadas ao contrato na versão 1.4.0. |

## Solicitações de agendamento (UC-40, UC-41, UC-42)

| Rota | Uso |
|---|---|
| `GET /v1/servicos/{servicoId}/horarios-disponiveis?data=AAAA-MM-DD` | Horários livres no dia, de 30 em 30 minutos: o serviço inteiro precisa caber no turno de algum profissional ou recurso que não tenha agendamento no intervalo (RN40, RN29). Horários no fuso de Brasília. |
| `POST /v1/solicitacoes` | O tutor solicita para um dos seus pets. A API confere de novo a disponibilidade e o conflito com outro agendamento do pet (RN14, CT-40-02) e grava a solicitação pendente com a primeira entrada do histórico (RN38). |
| `GET /v1/solicitacoes` | As do tutor logado ou as da empresa, com filtro por situação. |

A regra de disponibilidade fica em `modulos/atendimento/dominio/disponibilidade.ts`, sem dependência de banco.

## Agendamentos e agenda (UC-39, UC-24)

| Rota | Uso |
|---|---|
| `POST /v1/agendamentos` | A empresa agenda direto para pet de cliente ou compartilhado com ela, com o preço do serviço congelado (RN27) e e-mail para o tutor. Pet, profissional e recurso não podem ter outro agendamento no intervalo (RN14, RN29). |
| `PATCH /v1/agendamentos/{agendamentoId}` | Remarca agendamento ativo, com a mesma checagem de conflito. |
| `POST /v1/agendamentos/{agendamentoId}/cancelamento` | Cancela, pela empresa ou por um responsável pelo pet. |
| `GET /v1/empresas/{empresaId}/agenda?semana=AAAA-MM-DD` | Agenda de 7 dias a partir da data, com filtro por profissional ou recurso, e as solicitações pendentes do período. |

Além da checagem na API, a restrição `EXCLUDE` do banco (MOD-03) impede dois agendamentos ativos simultâneos para o mesmo pet, profissional ou recurso.

## Chat em tempo real (UC-43)

| Rota | Uso |
|---|---|
| `GET` e `POST /v1/conversas` | O tutor lista as conversas dele e abre conversa com uma empresa em que é cliente ou tem agendamento (CT-43-01), ou com o assistente virtual, que exige o plano PANTERA ativo (402 `RN25_ASSINATURA_PANTERA`, CT-43-02). A empresa lista as conversas abertas com ela. |
| `GET` e `POST /v1/conversas/{conversaId}/mensagens` | Histórico (50 por página, `antes` para voltar) e envio. Ler marca como lidas as mensagens dos outros. |
| `POST /v1/conversas/{conversaId}/encerramento` | O tutor encerra e a conversa para de receber mensagens. |

O tempo real usa Socket.IO no namespace `/tempo-real` (ADR-011). O cliente conecta com `auth: { token: <access token> }`; o servidor confere o token, a sessão e a permissão `chat:usar` e coloca a conexão na sala do usuário e, para a empresa, na sala da empresa. Cada mensagem nova vai para as salas da conversa no evento `mensagem:nova`. Para enviar pelo WebSocket, use `mensagem:enviar` com `{ conversaId, conteudo }` e leia a confirmação.

```js
const socket = io('http://localhost:3000/tempo-real', { auth: { token } });
socket.on('mensagem:nova', (m) => console.log(m.conteudo));
const r = await socket.emitWithAck('mensagem:enviar', { conversaId, conteudo: 'Oi!' });
```

No CapRover, ligue o suporte a WebSocket no app da API (opção "Websocket Support").

### Assistente virtual (UC-43, ARQ-03 seção 3.5)

Ao abrir a conversa com o assistente, a primeira mensagem é o aviso fixo de que ele não substitui o veterinário (risco R08), com sugestões de perguntas. Cada mensagem do tutor recebe a resposta pelo evento `mensagem:nova`, com `remetenteId` nulo. O provedor é a API da Anthropic, pelo SDK oficial:

| Variável | Uso |
|---|---|
| `ANTHROPIC_API_KEY` | Chave da API. Sem ela, o assistente responde simulado, sem custo (desenvolvimento, testes e homologação). |
| `IA_MODELO` | ID do modelo no provedor. Sem chave ou sem modelo, as respostas são simuladas. |
| `IA_LIMITE_DIARIO` | Mensagens por assinante por dia, padrão 30 (429 `ASSISTENTE_LIMITE_DIARIO`). |

Só a espécie, a raça, a idade aproximada e as alergias do pet vão para o provedor, nunca CPF, endereço ou dados de outros usuários (ARQ-02). As instruções fixas proíbem diagnóstico e prescrição e ficam em cache no provedor. Se o modelo recusar por política, a API tenta no modelo reserva (`fallbacks: "default"`); recusa final ou falha do provedor viram uma mensagem segura na conversa.

## Pagamentos (UC-44)

| Rota | Uso |
|---|---|
| `POST /v1/pagamentos` | O tutor paga um serviço agendado. O pagamento nasce PENDENTE com o preço contratado (RN27). Com PIX, a resposta traz o QR code; com cartão, o app manda só o token do formulário seguro do gateway (sem dados de cartão na API). Cartão recusado volta com `motivoRecusa` para tentar outro meio (CT-44-02). |
| `POST /v1/webhooks/pagamentos` | Eventos do gateway. A assinatura `x-signature` é conferida antes de tudo (RN36) e o status vem de nova consulta ao gateway; eventos repetidos não mudam nada. |

O pagamento só fica ACEITO com a confirmação do gateway (RN39, DS-05). Na confirmação, o tutor recebe e-mail e o evento `pagamento:atualizado`, que também chega à empresa em tempo real. O worker confere de hora em hora os pendentes, caso um webhook se perca (ARQ-03, seção 3.1).

| Variável | Uso |
|---|---|
| `MP_ACCESS_TOKEN` | Token do Mercado Pago (use as credenciais de teste). Sem ele, o gateway é simulado: o PIX fica pendente e o cartão de teste `cartao-teste-recusado` é recusado. |
| `MP_WEBHOOK_SEGREDO` | Segredo da assinatura dos webhooks, do painel do Mercado Pago. Sem ele, todo webhook é recusado. |
| `URL_API_PUBLICA` | Endereço público da API, para o gateway chamar `/v1/webhooks/pagamentos`. |

## Atendimentos (UC-23)

| Rota | Uso |
|---|---|
| `POST /v1/agendamentos/{agendamentoId}/atendimento` | Registra e finaliza o atendimento de um agendamento que já começou. O serviço agendado é cobrado pelo preço contratado (RN27, CT-23-01) e serviços extras pelo preço atual; o agendamento vira REALIZADO. Exige `atendimento:editar`. |
| `GET /v1/agendamentos/{agendamentoId}/atendimento` | Consulta o atendimento com os itens e o total. |
| `PATCH /v1/atendimentos/{atendimentoId}` | Altera observações ou procedimentos só com `justificativa` (mínimo 10 caracteres). O antes, o depois e a justificativa vão para o log de auditoria com nível CRITICO (RN28, CT-23-02). |

## Clientes da empresa (UC-21)

| Rota | Uso |
|---|---|
| `GET` e `POST /v1/empresas/{empresaId}/clientes` | Lista e cadastra clientes. Com `ASSINATURA_PRESENCIAL`, a cópia do termo assinado é obrigatória e o consentimento já fica vigente. Com `LINK_DIGITAL`, o cadastro fica pendente só com nome e contato, e o cliente recebe o link do termo por e-mail (RN41). Se o e-mail ou o CPF são de um tutor, o cadastro fica ligado à conta dele (ADR-010). |
| `POST .../clientes/{clienteId}/pets` | Pet de cliente sem conta, só com consentimento vigente (CT-21-02). |
| `POST .../clientes/{clienteId}/consentimento/revogacao` | Revogação pedida à empresa: cliente inativado e dados anonimizados. |
| `GET /v1/consentimentos-clientes/{token}`, `.../aceite` e `.../revogacao` | Página pública do termo: o aceite grava data, hora, IP e versão e manda o comprovante; o link do comprovante revoga sem precisar de conta. |

Quando o cliente cria conta de tutor e confirma o e-mail, ele assume o cadastro e passa a ser o responsável principal dos pets cadastrados pela empresa (RC-33). Uma rotina diária do worker, às 3h, exclui pré-cadastros sem aceite há mais de 7 dias (CT-21-05).

## Auditoria e monitoramento (RN31, UC-25)

Ações críticas gravam `LogAuditoria` pelo decorador `@Auditar(...)` e pelo `AuditoriaInterceptor` global (ADR-012, passo 6): cadastro, troca de perfil e desligamento de funcionário, alteração de serviço, cadastro de cliente e revogação de consentimento, além do bloqueio de conta por tentativas (RN03). A gravação nunca derruba a requisição. `GET /v1/admin/logs` lista os registros para o administrador, com filtro por nível (`INFO`, `ALERTA`, `CRITICO`) e período (`de` e `ate`).

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

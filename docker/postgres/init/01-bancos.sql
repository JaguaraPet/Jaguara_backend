-- Executado só na primeira subida do contêiner (volume vazio).
-- Cria o banco de testes e as extensões exigidas pelo MOD-03 nos dois bancos:
--   pgcrypto   -> gen_random_uuid()
--   btree_gist -> restrições EXCLUDE de sobreposição de agendamentos (RN14, RN29)

CREATE DATABASE jaguara_teste OWNER jaguara;

\connect jaguara
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

\connect jaguara_teste
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

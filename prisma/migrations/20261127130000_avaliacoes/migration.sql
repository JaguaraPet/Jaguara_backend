-- Avaliação do atendimento pelo tutor (nota de 1 a 5, comentário e resposta da empresa).
-- CreateTable
CREATE TABLE "avaliacao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agendamento_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "autor_id" UUID NOT NULL,
    "nota" INTEGER NOT NULL,
    "comentario" VARCHAR(1000),
    "resposta" VARCHAR(1000),
    "respondida_em" TIMESTAMPTZ(6),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avaliacao_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_avaliacao_nota" CHECK ("nota" BETWEEN 1 AND 5)
);

-- CreateIndex
CREATE UNIQUE INDEX "avaliacao_agendamento_id_key" ON "avaliacao"("agendamento_id");

-- CreateIndex
CREATE INDEX "ix_avaliacao_empresa" ON "avaliacao"("empresa_id", "criado_em" DESC);

-- AddForeignKey
ALTER TABLE "avaliacao" ADD CONSTRAINT "fk_avaliacao_agendamento_id" FOREIGN KEY ("agendamento_id") REFERENCES "agendamento"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "avaliacao" ADD CONSTRAINT "fk_avaliacao_empresa_id" FOREIGN KEY ("empresa_id") REFERENCES "empresa_enterprise"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "avaliacao" ADD CONSTRAINT "fk_avaliacao_autor_id" FOREIGN KEY ("autor_id") REFERENCES "tutor"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

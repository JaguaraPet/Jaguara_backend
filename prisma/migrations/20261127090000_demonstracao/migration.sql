-- Clínica de demonstração por visitante (link enviado a veterinários e na homepage).
CREATE TABLE "demonstracao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "empresa_id" UUID NOT NULL,
    "tutor_id" UUID NOT NULL,
    "codigo_tutor" CHAR(64) NOT NULL,
    "ip_origem" VARCHAR(255),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_em" TIMESTAMPTZ(6) NOT NULL,
    "encerrada" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "demonstracao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "demonstracao_empresa_id_key" ON "demonstracao"("empresa_id");
CREATE UNIQUE INDEX "demonstracao_codigo_tutor_key" ON "demonstracao"("codigo_tutor");
CREATE INDEX "ix_demonstracao_expira" ON "demonstracao"("expira_em");

ALTER TABLE "demonstracao" ADD CONSTRAINT "fk_demonstracao_empresa_id" FOREIGN KEY ("empresa_id") REFERENCES "empresa_enterprise"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "demonstracao" ADD CONSTRAINT "fk_demonstracao_tutor_id" FOREIGN KEY ("tutor_id") REFERENCES "tutor"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Perfil público editado pela empresa: vitrine no app e página /e/{slug}.
ALTER TABLE "empresa_enterprise"
    ADD COLUMN "slug" VARCHAR(80),
    ADD COLUMN "descricao" TEXT,
    ADD COLUMN "telefone_publico" VARCHAR(20),
    ADD COLUMN "whatsapp" VARCHAR(20),
    ADD COLUMN "instagram" VARCHAR(60),
    ADD COLUMN "horario_funcionamento" VARCHAR(255),
    ADD COLUMN "formas_pagamento" TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "politica_cancelamento" TEXT;

CREATE UNIQUE INDEX "empresa_enterprise_slug_key" ON "empresa_enterprise"("slug");

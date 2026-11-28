-- Criador de rotinas, rotina do dia e registro de doses dadas (quem fez o quê, para a família).
-- CreateEnum
CREATE TYPE "tipo_rotina" AS ENUM ('PASSEIO', 'BANHO', 'ANTIPULGAS', 'VERMIFUGO', 'ESCOVACAO', 'AREIA', 'ALIMENTACAO', 'OUTRO');

-- CreateEnum
CREATE TYPE "frequencia_rotina" AS ENUM ('DIARIA', 'SEMANAL', 'MENSAL', 'INTERVALO_DIAS');

-- CreateTable
CREATE TABLE "rotina" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pet_id" UUID NOT NULL,
    "titulo" VARCHAR(120) NOT NULL,
    "tipo" "tipo_rotina" NOT NULL,
    "frequencia" "frequencia_rotina" NOT NULL,
    "intervalo_dias" INTEGER,
    "dias_semana" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "horarios" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "data_inicio" DATE NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rotina_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registro_rotina" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rotina_id" UUID NOT NULL,
    "data" DATE NOT NULL,
    "horario" VARCHAR(5) NOT NULL DEFAULT '',
    "feito_por_id" UUID NOT NULL,
    "feito_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registro_rotina_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dose_registrada" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tratamento_id" UUID NOT NULL,
    "prevista_para" TIMESTAMPTZ(6) NOT NULL,
    "feito_por_id" UUID NOT NULL,
    "feito_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dose_registrada_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_rotina_pet" ON "rotina"("pet_id", "ativa");

-- CreateIndex
CREATE UNIQUE INDEX "uq_registro_rotina" ON "registro_rotina"("rotina_id", "data", "horario");

-- CreateIndex
CREATE UNIQUE INDEX "uq_dose_registrada" ON "dose_registrada"("tratamento_id", "prevista_para");

-- AddForeignKey
ALTER TABLE "rotina" ADD CONSTRAINT "fk_rotina_pet_id" FOREIGN KEY ("pet_id") REFERENCES "pet"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rotina" ADD CONSTRAINT "fk_rotina_criado_por_id" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "registro_rotina" ADD CONSTRAINT "fk_registro_rotina_rotina_id" FOREIGN KEY ("rotina_id") REFERENCES "rotina"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "registro_rotina" ADD CONSTRAINT "fk_registro_rotina_feito_por_id" FOREIGN KEY ("feito_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dose_registrada" ADD CONSTRAINT "fk_dose_registrada_tratamento_id" FOREIGN KEY ("tratamento_id") REFERENCES "tratamento_medicamentoso"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dose_registrada" ADD CONSTRAINT "fk_dose_registrada_feito_por_id" FOREIGN KEY ("feito_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;


-- Hora da primeira dose do tratamento (antes só usada para programar os lembretes).
ALTER TABLE "tratamento_medicamentoso" ADD COLUMN "hora_primeira_dose" VARCHAR(5) NOT NULL DEFAULT '08:00';

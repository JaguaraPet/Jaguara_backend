-- Aparelhos do usuário para notificações push pelo Expo (JAG-157, UC-31).
CREATE TABLE "dispositivo_push" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token" VARCHAR(255) NOT NULL,
    "plataforma" VARCHAR(20) NOT NULL,
    "usuario_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispositivo_push_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dispositivo_push_token_key" ON "dispositivo_push"("token");

CREATE INDEX "ix_dispositivo_push_usuario" ON "dispositivo_push"("usuario_id");

ALTER TABLE "dispositivo_push" ADD CONSTRAINT "fk_dispositivo_push_usuario_id" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

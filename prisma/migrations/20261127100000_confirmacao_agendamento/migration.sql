-- Confirmação de presença pelo tutor a partir do lembrete do agendamento.
ALTER TABLE "agendamento" ADD COLUMN "confirmado_em" TIMESTAMPTZ(6);

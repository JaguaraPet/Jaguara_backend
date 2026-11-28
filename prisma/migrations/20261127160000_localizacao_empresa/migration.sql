-- Coordenadas do endereço da empresa, para a busca por perto no app.
ALTER TABLE "empresa_enterprise" ADD COLUMN "latitude" DECIMAL(9,6),
ADD COLUMN "longitude" DECIMAL(9,6);

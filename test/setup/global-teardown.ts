export default async function encerrarAmbienteDeTeste() {
  const conteineres = globalThis.__CONTEINERES_TESTE__ ?? [];
  await Promise.all(conteineres.map((conteiner) => conteiner.stop()));
}

/* Adaptador Netlify: liga a API ao Netlify Blobs.
 *
 * A loja entra por injeção para dar para testar sem o ambiente do Netlify.
 */

import { criarApi } from "./api.js";

const CHAVE = "estado";

/**
 * @param {object} cfg
 * @param {{get:Function, setJSON:Function}} cfg.loja   store do Netlify Blobs
 * @param {string} cfg.senhaHash
 * @param {string} cfg.segredo
 * @param {object} cfg.seed
 */
export function criarHandler(cfg) {
  const api = criarApi({
    seed: cfg.seed,
    senhaHash: cfg.senhaHash,
    segredo: cfg.segredo,
    seguro: true,                     // o Netlify serve sempre em https
    ler: () => cfg.loja.get(CHAVE, { type: "json" }),
    gravar: (estado) => cfg.loja.setJSON(CHAVE, estado)
  });

  return async function (request) {
    // Com rota própria da função o caminho já chega como /api/...; se algum dia
    // vier reescrito para /.netlify/functions/api/..., normaliza aqui.
    const url = new URL(request.url);
    const prefixo = "/.netlify/functions/api";
    if (url.pathname.startsWith(prefixo)) {
      url.pathname = "/api" + url.pathname.slice(prefixo.length);
      request = new Request(url, request);
    }

    const resposta = await api(request);
    return resposta || new Response("Não encontrado", { status: 404 });
  };
}

/* A API da gestão de viagens, rodando como função do Netlify.
 *
 * Estado no Netlify Blobs, com leitura forte — logo após uma gravação, a
 * próxima leitura já enxerga o valor novo (sem isso, duas pessoas lançando ao
 * mesmo tempo poderiam ver a base defasada).
 */

import { getStore } from "@netlify/blobs";
import { criarHandler } from "../../servidor/netlify.js";
import seed from "../../servidor/seed.json";

export default async function (request) {
  const { SENHA_HASH, SESSAO_SEGREDO } = process.env;

  if (!SENHA_HASH || !SESSAO_SEGREDO) {
    return new Response(
      JSON.stringify({
        erro: "Faltam as variáveis SENHA_HASH e SESSAO_SEGREDO. " +
              "Configure em Site configuration → Environment variables e publique de novo."
      }),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }

  const loja = getStore({ name: "viagens", consistency: "strong" });
  const handler = criarHandler({ loja, senhaHash: SENHA_HASH, segredo: SESSAO_SEGREDO, seed });
  return handler(request);
}

export const config = { path: "/api/*" };

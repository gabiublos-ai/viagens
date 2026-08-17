/* Cloudflare Worker — serve o site e a API na mesma origem.
 *
 * Precisa de:
 *   [assets]  directory = "./site"        (o site, gerado por tools/build_site.py)
 *   [[d1_databases]] binding = "DB"       (banco onde o estado é guardado)
 *   secrets: SENHA_HASH, SESSAO_SEGREDO
 */

import { criarApi } from "./api.js";
import seed from "./seed.json";

/** Uma linha só: o estado inteiro em JSON. A base é pequena e cabe folgado. */
async function garanteTabela(db) {
  await db.exec("CREATE TABLE IF NOT EXISTS estado (id INTEGER PRIMARY KEY, conteudo TEXT NOT NULL)");
}

export default {
  async fetch(request, env) {
    if (!env.SENHA_HASH || !env.SESSAO_SEGREDO) {
      return new Response(
        "Faltam os secrets SENHA_HASH e SESSAO_SEGREDO. Configure com:\n" +
        "  npx wrangler secret put SENHA_HASH\n" +
        "  npx wrangler secret put SESSAO_SEGREDO\n",
        { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    const api = criarApi({
      seed,
      senhaHash: env.SENHA_HASH,
      segredo: env.SESSAO_SEGREDO,
      seguro: true,
      async ler() {
        await garanteTabela(env.DB);
        const linha = await env.DB.prepare("SELECT conteudo FROM estado WHERE id = 1").first();
        return linha ? JSON.parse(linha.conteudo) : null;
      },
      async gravar(estado) {
        await garanteTabela(env.DB);
        await env.DB.prepare(
          "INSERT INTO estado (id, conteudo) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET conteudo = excluded.conteudo"
        ).bind(JSON.stringify(estado)).run();
      }
    });

    const resposta = await api(request);
    if (resposta) return resposta;

    // Não é rota da API — quem responde é o servidor de arquivos estáticos.
    return env.ASSETS.fetch(request);
  }
};

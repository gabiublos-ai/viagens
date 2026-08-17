/* Servidor local — roda o site e a API em qualquer máquina com Node 18+.
 *
 *   SENHA_HASH="pbkdf2$..." SESSAO_SEGREDO="..." node servidor/local.js
 *
 * Guarda o estado num arquivo JSON (padrão: dados/estado.json). Serve para
 * testar, para rodar numa máquina da empresa ou num VPS atrás de um proxy https.
 * Em produção na Cloudflare, quem responde é servidor/worker.js.
 */

import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { criarApi, hashSenha } from "./api.js";

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = process.env.SITE_DIR || path.join(RAIZ, "site");
const ARQUIVO = process.env.ESTADO_ARQUIVO || path.join(RAIZ, "dados", "estado.json");
const PORTA = Number(process.env.PORTA || 8787);

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

// ---------- armazenamento em arquivo ----------

let gravando = Promise.resolve();

async function ler() {
  try {
    return JSON.parse(await fs.readFile(ARQUIVO, "utf8"));
  } catch (e) {
    return null;
  }
}

/** Grava em série e por arquivo temporário, para nunca deixar um JSON pela metade. */
function gravar(estado) {
  gravando = gravando.then(async () => {
    await fs.mkdir(path.dirname(ARQUIVO), { recursive: true });
    const temp = ARQUIVO + ".tmp";
    await fs.writeFile(temp, JSON.stringify(estado), "utf8");
    await fs.rename(temp, ARQUIVO);
  }).catch((e) => console.error("Falha ao gravar o estado:", e));
  return gravando;
}

// ---------- configuração ----------

const senhaHash = process.env.SENHA_HASH || (process.env.SENHA ? await hashSenha(process.env.SENHA) : "");
const segredo = process.env.SESSAO_SEGREDO || "";

if (!senhaHash || !segredo) {
  console.error(
    "Faltam variáveis de ambiente.\n\n" +
    "  SENHA_HASH       gere com: node servidor/senha.js \"sua senha\"\n" +
    "  SESSAO_SEGREDO   qualquer texto longo e aleatório\n\n" +
    "Exemplo:\n" +
    "  SENHA_HASH='pbkdf2$...' SESSAO_SEGREDO='$(openssl rand -hex 32)' node servidor/local.js\n"
  );
  process.exit(1);
}

let seed = {};
try {
  seed = JSON.parse(fsSync.readFileSync(path.join(RAIZ, "servidor", "seed.json"), "utf8"));
} catch (e) {
  console.warn("servidor/seed.json não encontrado — a base começa vazia.");
}

const api = criarApi({ ler, gravar, senhaHash, segredo, seed, seguro: process.env.COOKIE_SEGURO === "1" });

// ---------- ponte node:http ↔ fetch ----------

function paraRequest(req) {
  const url = `http://${req.headers.host || "localhost"}${req.url}`;
  const init = { method: req.method, headers: req.headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req;
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function responder(res, resposta) {
  res.statusCode = resposta.status;
  for (const [k, v] of resposta.headers) res.setHeader(k, v);
  const corpo = Buffer.from(await resposta.arrayBuffer());
  res.end(corpo);
}

async function serveArquivo(res, caminho) {
  const relativo = caminho === "/" ? "/index.html" : caminho;
  const destino = path.join(SITE, path.normalize(relativo).replace(/^(\.\.[/\\])+/, ""));
  if (!destino.startsWith(SITE)) { res.statusCode = 403; res.end("Acesso negado"); return; }
  try {
    const conteudo = await fs.readFile(destino);
    res.setHeader("content-type", TIPOS[path.extname(destino)] || "application/octet-stream");
    res.setHeader("cache-control", path.extname(destino) === ".html" ? "no-cache" : "max-age=300");
    res.end(conteudo);
  } catch (e) {
    res.statusCode = 404;
    res.end("Não encontrado");
  }
}

http.createServer(async (req, res) => {
  try {
    const resposta = await api(paraRequest(req));
    if (resposta) return responder(res, resposta);
    await serveArquivo(res, new URL(req.url, "http://x").pathname);
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end("Erro interno");
  }
}).listen(PORTA, () => {
  console.log(`Gestão de Viagens em http://localhost:${PORTA}`);
  console.log(`Site: ${SITE}`);
  console.log(`Estado: ${ARQUIVO}`);
});

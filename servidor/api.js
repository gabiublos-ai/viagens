/* API da gestão de viagens — compartilhada entre o Cloudflare Worker e o servidor local.
 *
 * Usa só APIs web padrão (Request, Response, Web Crypto), então o mesmo arquivo
 * roda nos dois lugares. O armazenamento entra por injeção: quem chama passa
 * `ler()` e `gravar()`.
 *
 * Contrato:
 *   POST   /api/sessao            {senha, nome}   → entra; devolve o estado
 *   DELETE /api/sessao                            → sai
 *   GET    /api/sessao                            → quem está logado
 *   GET    /api/estado                            → {revisao, dados, ...}
 *   GET    /api/revisao                           → só a revisão (para o polling)
 *   PUT    /api/viagem            {viagem}        → cria ou atualiza
 *   DELETE /api/viagem/:id
 *   PUT    /api/colaborador       {colaborador, nomeOriginal?}
 *   DELETE /api/colaborador/:nome
 *   POST   /api/uber              {linhas:[]}     → importa, ignorando repetidas
 *   DELETE /api/uber              {linha}
 *   PUT    /api/params            {params}
 *   PUT    /api/estado            {dados}         → restaura um backup inteiro
 *   POST   /api/base-original                     → volta à base que veio da planilha
 *
 * Toda resposta de escrita devolve o estado inteiro já atualizado: a base é
 * pequena e assim nenhum cliente fica com uma versão parcial.
 */

const DIAS_SESSAO = 30;
const TENTATIVAS_MAX = 8;          // por janela, por IP
const JANELA_TENTATIVAS = 10 * 60 * 1000;

// ---------- utilidades de resposta ----------

function json(corpo, init) {
  return new Response(JSON.stringify(corpo), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...((init && init.headers) || {})
    }
  });
}

function erro(status, mensagem, extra) {
  return json({ erro: mensagem, ...(extra || {}) }, { status });
}

// ---------- senha e sessão ----------

const enc = new TextEncoder();

function paraBase64(bytes) {
  let s = "";
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

function deBase64(texto) {
  const bin = atob(texto);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64url(bytes) {
  return paraBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deBase64url(texto) {
  return deBase64(texto.replace(/-/g, "+").replace(/_/g, "/"));
}

/** Deriva o hash da senha. Formato: pbkdf2$<iteracoes>$<salt>$<hash> */
export async function hashSenha(senha, saltBytes, iteracoes = 310000) {
  const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
  const chave = await crypto.subtle.importKey("raw", enc.encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iteracoes }, chave, 256
  );
  return `pbkdf2$${iteracoes}$${paraBase64(salt)}$${paraBase64(bits)}`;
}

/** Comparação em tempo constante — não vaza quantos caracteres bateram. */
function iguais(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

async function senhaConfere(senha, guardado) {
  const partes = String(guardado || "").split("$");
  if (partes.length !== 4 || partes[0] !== "pbkdf2") return false;
  const calculado = await hashSenha(senha, deBase64(partes[2]), Number(partes[1]));
  return iguais(calculado, guardado);
}

async function assinar(texto, segredo) {
  const chave = await crypto.subtle.importKey(
    "raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return base64url(await crypto.subtle.sign("HMAC", chave, enc.encode(texto)));
}

async function criaSessao(nome, segredo) {
  const payload = base64url(enc.encode(JSON.stringify({
    nome: String(nome || "").slice(0, 60),
    exp: Date.now() + DIAS_SESSAO * 86400000
  })));
  return `v1.${payload}.${await assinar(payload, segredo)}`;
}

async function leSessao(token, segredo) {
  const partes = String(token || "").split(".");
  if (partes.length !== 3 || partes[0] !== "v1") return null;
  if (!iguais(await assinar(partes[1], segredo), partes[2])) return null;
  try {
    const dados = JSON.parse(new TextDecoder().decode(deBase64url(partes[1])));
    if (!dados.exp || dados.exp < Date.now()) return null;
    return dados;
  } catch (e) {
    return null;
  }
}

function leCookie(request, nome) {
  const bruto = request.headers.get("cookie") || "";
  for (const parte of bruto.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nome) return decodeURIComponent(v.join("="));
  }
  return "";
}

function cookieSessao(valor, seguro) {
  const base = `sessao=${encodeURIComponent(valor)}; Path=/; HttpOnly; SameSite=Strict`;
  const idade = valor ? `; Max-Age=${DIAS_SESSAO * 86400}` : "; Max-Age=0";
  return base + idade + (seguro ? "; Secure" : "");
}

// ---------- controle de tentativas ----------

const tentativas = new Map();

function excedeuTentativas(ip) {
  const agora = Date.now();
  const reg = tentativas.get(ip);
  if (!reg || agora - reg.desde > JANELA_TENTATIVAS) return false;
  return reg.n >= TENTATIVAS_MAX;
}

function registraFalha(ip) {
  const agora = Date.now();
  const reg = tentativas.get(ip);
  if (!reg || agora - reg.desde > JANELA_TENTATIVAS) tentativas.set(ip, { n: 1, desde: agora });
  else reg.n++;
  if (tentativas.size > 5000) tentativas.clear();
}

// ---------- regras de dados ----------

function normal(s) {
  return String(s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function proximoId(dados) {
  let max = 0;
  for (const v of dados.viagens) if (Number(v.id) > max) max = Number(v.id);
  return max + 1;
}

const CAMPOS_VIAGEM = ["tipo", "colaborador", "destino", "aeroportoOrigem", "dataIda", "dataVolta",
  "aereo", "diarias", "valorDiaria", "alimentacao", "transporte", "custoAlteracao",
  "status", "refId", "motivo", "pendencias", "obs"];

const CAMPOS_COLABORADOR = ["nome", "status", "area", "cargo", "nivel", "gestor", "contrato",
  "cidade", "uf", "aeroportoBase", "email", "emailAlt", "modelo"];

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function texto(v, limite = 500) {
  return String(v === undefined || v === null ? "" : v).slice(0, limite);
}

/** Aceita só os campos conhecidos, com os tipos certos. */
function limpaViagem(bruta) {
  const v = {};
  for (const campo of CAMPOS_VIAGEM) {
    if (["aereo", "diarias", "valorDiaria", "alimentacao", "transporte", "custoAlteracao"].includes(campo)) {
      v[campo] = numero(bruta[campo]);
    } else if (campo === "refId") {
      v[campo] = bruta[campo] ? Number(bruta[campo]) : null;
    } else {
      v[campo] = texto(bruta[campo], campo === "obs" ? 2000 : 200);
    }
  }
  return v;
}

function limpaColaborador(bruto) {
  const c = {};
  for (const campo of CAMPOS_COLABORADOR) c[campo] = texto(bruto[campo], 200);
  return c;
}

function estruturaValida(dados) {
  return dados && Array.isArray(dados.viagens) && Array.isArray(dados.colaboradores) &&
         Array.isArray(dados.uber) && dados.params && typeof dados.params === "object";
}

// ---------- API ----------

/**
 * Monta o handler.
 * @param {object} cfg
 * @param {() => Promise<object>} cfg.ler                 estado guardado (ou null na primeira vez)
 * @param {(estado) => Promise<void>} cfg.gravar
 * @param {string} cfg.senhaHash                          saída de hashSenha()
 * @param {string} cfg.segredo                            chave para assinar a sessão
 * @param {object} cfg.seed                               base original, da planilha
 * @param {boolean} [cfg.seguro]                          marca o cookie como Secure (https)
 */
export function criarApi(cfg) {
  const seed = cfg.seed || { colaboradores: [], viagens: [], uberRaw: [], parametros: {} };

  function estadoInicial() {
    return {
      revisao: 1,
      atualizadoEm: new Date().toISOString(),
      atualizadoPor: "base original",
      dados: {
        baseEquipeVersao: seed.baseEquipeVersao || 0,
        colaboradores: JSON.parse(JSON.stringify(seed.colaboradores || [])),
        viagens: JSON.parse(JSON.stringify(seed.viagens || [])),
        uber: (seed.uberRaw || []).map((linha) => ({ linha })),
        params: JSON.parse(JSON.stringify(seed.parametros || {}))
      }
    };
  }

  async function estadoAtual() {
    const guardado = await cfg.ler();
    if (guardado && estruturaValida(guardado.dados)) return guardado;
    const novo = estadoInicial();
    await cfg.gravar(novo);
    return novo;
  }

  async function grava(estado, nome) {
    estado.revisao = (estado.revisao || 0) + 1;
    estado.atualizadoEm = new Date().toISOString();
    estado.atualizadoPor = nome || "";
    await cfg.gravar(estado);
    return json(estado);
  }

  return async function handle(request) {
    const url = new URL(request.url);
    const caminho = url.pathname.replace(/\/+$/, "") || "/";
    if (!caminho.startsWith("/api")) return null;   // não é da API — quem chamou serve o site

    const seguro = cfg.seguro !== undefined ? cfg.seguro : url.protocol === "https:";
    const metodo = request.method.toUpperCase();

    // ---- entrar ----
    if (caminho === "/api/sessao" && metodo === "POST") {
      const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "local";
      if (excedeuTentativas(ip)) {
        return erro(429, "Muitas tentativas. Espere alguns minutos e tente de novo.");
      }
      let corpo = {};
      try { corpo = await request.json(); } catch (e) { /* corpo inválido cai no 401 */ }

      const confere = await senhaConfere(String(corpo.senha || ""), cfg.senhaHash);
      // Atrasa toda resposta de login, certa ou errada, para tornar a força bruta cara.
      await new Promise((r) => setTimeout(r, 350));
      if (!confere) {
        registraFalha(ip);
        return erro(401, "Senha incorreta.");
      }

      const nome = texto(corpo.nome, 60).trim();
      const token = await criaSessao(nome, cfg.segredo);
      const estado = await estadoAtual();
      return json({ nome, ...estado }, { headers: { "set-cookie": cookieSessao(token, seguro) } });
    }

    if (caminho === "/api/sessao" && metodo === "DELETE") {
      return json({ ok: true }, { headers: { "set-cookie": cookieSessao("", seguro) } });
    }

    // ---- daqui para baixo, só com sessão ----
    const sessao = await leSessao(leCookie(request, "sessao"), cfg.segredo);
    if (!sessao) return erro(401, "Entre com a senha de acesso.");

    if (caminho === "/api/sessao" && metodo === "GET") {
      return json({ nome: sessao.nome });
    }

    const estado = await estadoAtual();
    const dados = estado.dados;

    if (caminho === "/api/estado" && metodo === "GET") return json(estado);

    if (caminho === "/api/revisao" && metodo === "GET") {
      return json({
        revisao: estado.revisao,
        atualizadoEm: estado.atualizadoEm,
        atualizadoPor: estado.atualizadoPor
      });
    }

    let corpo = {};
    if (metodo !== "GET") {
      try { corpo = await request.json(); } catch (e) { corpo = {}; }
    }

    // ---- viagens ----
    if (caminho === "/api/viagem" && metodo === "PUT") {
      const entrada = corpo.viagem || {};
      const id = Number(entrada.id) || 0;
      const limpa = limpaViagem(entrada);
      if (!limpa.colaborador || !limpa.dataIda || !limpa.dataVolta) {
        return erro(400, "Informe colaborador e as datas de ida e volta.");
      }
      let alvo = id ? dados.viagens.find((v) => Number(v.id) === id) : null;
      if (alvo) Object.assign(alvo, limpa);
      else {
        alvo = { id: proximoId(dados), ...limpa };
        dados.viagens.push(alvo);
      }
      return grava(estado, sessao.nome);
    }

    const casaViagem = caminho.match(/^\/api\/viagem\/(\d+)$/);
    if (casaViagem && metodo === "DELETE") {
      const id = Number(casaViagem[1]);
      dados.viagens = dados.viagens.filter((v) => Number(v.id) !== id);
      // Alteração órfã vira lançamento comum, para nada sumir do total.
      for (const v of dados.viagens) {
        if (Number(v.refId) === id) { v.refId = null; v.tipo = "Viagem"; }
      }
      return grava(estado, sessao.nome);
    }

    // ---- colaboradores ----
    if (caminho === "/api/colaborador" && metodo === "PUT") {
      const limpo = limpaColaborador(corpo.colaborador || {});
      if (!limpo.nome.trim()) return erro(400, "Informe o nome do colaborador.");
      const anterior = texto(corpo.nomeOriginal, 200).trim();
      const chave = normal(anterior || limpo.nome);
      const alvo = dados.colaboradores.find((c) => normal(c.nome) === chave);
      if (alvo) {
        if (anterior && normal(anterior) !== normal(limpo.nome)) {
          for (const v of dados.viagens) if (normal(v.colaborador) === chave) v.colaborador = limpo.nome;
          for (const m of dados.params.dePara || []) if (normal(m.colaborador) === chave) m.colaborador = limpo.nome;
        }
        Object.assign(alvo, limpo);
      } else {
        dados.colaboradores.push(limpo);
      }
      dados.colaboradores.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
      return grava(estado, sessao.nome);
    }

    const casaColab = caminho.match(/^\/api\/colaborador\/(.+)$/);
    if (casaColab && metodo === "DELETE") {
      const chave = normal(decodeURIComponent(casaColab[1]));
      const usos = dados.viagens.filter((v) => normal(v.colaborador) === chave).length;
      if (usos) return erro(409, `Este colaborador tem ${usos} viagem(ns) lançada(s).`);
      dados.colaboradores = dados.colaboradores.filter((c) => normal(c.nome) !== chave);
      return grava(estado, sessao.nome);
    }

    // ---- uber ----
    if (caminho === "/api/uber" && metodo === "POST") {
      const existentes = new Set(dados.uber.map((r) => r.linha));
      let novas = 0, repetidas = 0;
      for (const bruta of (corpo.linhas || []).slice(0, 20000)) {
        const linha = texto(bruta, 2000).trim();
        if (!linha) continue;
        if (existentes.has(linha)) { repetidas++; continue; }
        existentes.add(linha);
        dados.uber.push({ linha });
        novas++;
      }
      estado.importacao = { novas, repetidas };
      return grava(estado, sessao.nome);
    }

    if (caminho === "/api/uber" && metodo === "DELETE") {
      const linha = texto(corpo.linha, 2000);
      dados.uber = dados.uber.filter((r) => r.linha !== linha);
      return grava(estado, sessao.nome);
    }

    if (caminho === "/api/uber/tudo" && metodo === "DELETE") {
      dados.uber = [];
      return grava(estado, sessao.nome);
    }

    // ---- parâmetros ----
    if (caminho === "/api/params" && metodo === "PUT") {
      if (!corpo.params || typeof corpo.params !== "object") return erro(400, "Parâmetros inválidos.");
      dados.params = corpo.params;
      return grava(estado, sessao.nome);
    }

    // ---- backup e base original ----
    if (caminho === "/api/estado" && metodo === "PUT") {
      if (!estruturaValida(corpo.dados)) return erro(400, "Backup fora do formato esperado.");
      estado.dados = corpo.dados;
      return grava(estado, sessao.nome);
    }

    if (caminho === "/api/base-original" && metodo === "POST") {
      const novo = estadoInicial();
      estado.dados = novo.dados;
      return grava(estado, sessao.nome);
    }

    return erro(404, "Rota não encontrada.");
  };
}

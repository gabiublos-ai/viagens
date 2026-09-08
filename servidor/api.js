/* API da gestão de viagens — compartilhada entre o Cloudflare Worker e o servidor local.
 *
 * Usa só APIs web padrão (Request, Response, Web Crypto), então o mesmo arquivo
 * roda nos dois lugares. O armazenamento entra por injeção: quem chama passa
 * `ler()` e `gravar()`.
 *
 * Contrato:
 *   POST   /api/sessao            {usuario, senha} → entra; devolve o estado
 *   DELETE /api/sessao                            → sai
 *   GET    /api/sessao                            → quem está logado
 *   PUT    /api/senha             {atual, nova}   → troca a própria senha
 *   GET    /api/usuarios                          → quem tem acesso (sem as senhas)
 *   PUT    /api/usuario           {usuario}       → cria ou atualiza (só admin)
 *   DELETE /api/usuario/:id                       → remove o acesso (só admin)
 *   POST   /api/usuario/:id/senha {nova}          → admin redefine a senha de alguém
 *   GET    /api/historico?limite=                 → registro de quem incluiu/alterou
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
const LIMITE_HISTORICO = 1200;     // entradas guardadas no registro de alterações
const PAPEIS = ["admin", "editor"];
const SENHA_MINIMA = 8;

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

/**
 * O token guarda só quem é (`id`) e até quando vale. O papel e o nome vêm da
 * base a cada requisição — assim tirar o acesso de alguém, ou rebaixar de
 * admin para editor, vale na hora e não daqui a trinta dias.
 */
async function criaSessao(id, nome, segredo) {
  const payload = base64url(enc.encode(JSON.stringify({
    id: String(id || "").slice(0, 40),
    // Só o acesso mestre carrega o nome no token: ele não tem cadastro de onde
    // buscá-lo, e sem isso o histórico registraria todo mundo como "mestre".
    nome: id === ID_MESTRE ? String(nome || "").slice(0, 60) : undefined,
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
  "status", "refId", "motivo", "pendencias", "obs", "conferencia",
  "hospedagem", "tipoAlteracao", "cafeIncluso"];

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
    if (campo === "hospedagem") {
      // Campo ausente não é zero: lançamento antigo guarda a hospedagem em
      // diárias × valor e só o `null` mantém esse cálculo de pé. Gravar zero
      // aqui apagaria o custo do hotel de quem foi salvo sem passar o campo.
      const bruto = bruta[campo];
      v[campo] = bruto === undefined || bruto === null || bruto === "" ? null : numero(bruto);
    } else if (["aereo", "diarias", "valorDiaria", "alimentacao", "transporte", "custoAlteracao"].includes(campo)) {
      v[campo] = numero(bruta[campo]);
    } else if (campo === "cafeIncluso") {
      v[campo] = bruta[campo] === true || bruta[campo] === "true" || bruta[campo] === 1;
    } else if (campo === "refId") {
      v[campo] = bruta[campo] ? Number(bruta[campo]) : null;
    } else if (campo === "conferencia") {
      // Quem validou, quando, e o que estava validando.
      const c = bruta[campo];
      v[campo] = c && typeof c === "object"
        ? { por: texto(c.por, 60), em: texto(c.em, 40), assinatura: texto(c.assinatura, 500) }
        : null;
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

// ---------- usuários ----------

/* Cada pessoa tem o seu acesso. O `id` nunca muda: é por ele que a sessão e o
 * histórico apontam para alguém, então trocar nome ou e-mail não quebra nada.
 *
 * O papel diz o que a pessoa pode fazer:
 *   admin   — tudo, inclusive criar e remover acessos
 *   editor  — lança e edita viagens, Uber e cadastros; não mexe em acessos
 *
 * A senha mestre (variável de ambiente) continua valendo como entrada de
 * emergência de quem administra o site, para o caso de ninguém mais conseguir
 * entrar. Ela abre uma sessão de admin marcada como mestre no histórico.
 */

const ID_MESTRE = "mestre";

function proximoIdUsuario(usuarios) {
  let max = 0;
  for (const u of usuarios) {
    const n = Number(String(u.id || "").replace(/^u/, ""));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return "u" + (max + 1);
}

/** Nome ou e-mail servem para entrar; a comparação ignora acento e maiúscula. */
function achaUsuario(usuarios, entrada) {
  const chave = normal(entrada);
  if (!chave) return null;
  return usuarios.find((u) => normal(u.email) === chave || normal(u.nome) === chave) || null;
}

/** O que vai para o navegador: tudo menos a senha. */
function semSenha(u) {
  const { senhaHash, ...resto } = u;
  return resto;
}

function limpaUsuario(bruto) {
  return {
    nome: texto(bruto.nome, 80).trim(),
    email: texto(bruto.email, 120).trim(),
    papel: PAPEIS.includes(bruto.papel) ? bruto.papel : "editor",
    ativo: bruto.ativo !== false
  };
}

// ---------- registro de alterações ----------

/* Toda escrita passa por `grava()`, e é lá que a linha do histórico é criada.
 * Guardamos o nome de quem fez, e não só o id, para a lista continuar legível
 * mesmo depois que o acesso da pessoa for removido.
 */

function registra(estado, sessao, registro) {
  if (!registro || !registro.acao) return;
  estado.historico.unshift({
    em: new Date().toISOString(),
    por: texto(sessao.nome, 80),
    porId: texto(sessao.id, 40),
    mestre: sessao.mestre ? true : undefined,
    acao: registro.acao,                     // incluiu | alterou | excluiu | importou | restaurou
    entidade: registro.entidade,             // viagem | colaborador | uber | acesso | parâmetros | base
    alvo: texto(registro.alvo, 140),
    resumo: texto(registro.resumo, 400)
  });
  if (estado.historico.length > LIMITE_HISTORICO) estado.historico.length = LIMITE_HISTORICO;
}

const ROTULO_CAMPO = {
  tipo: "tipo", colaborador: "colaborador", destino: "destino", aeroportoOrigem: "origem",
  dataIda: "ida", dataVolta: "volta", aereo: "aéreo", diarias: "diárias",
  valorDiaria: "valor da diária", alimentacao: "alimentação", transporte: "transporte",
  custoAlteracao: "custo da alteração", status: "status", motivo: "motivo",
  pendencias: "pendências", obs: "observações", hospedagem: "hospedagem",
  tipoAlteracao: "tipo de alteração", cafeIncluso: "café incluso", conferencia: "conferência",
  area: "área", cargo: "cargo", nivel: "nível", gestor: "gestor", contrato: "contrato",
  cidade: "cidade", uf: "UF", aeroportoBase: "aeroporto base", email: "e-mail",
  emailAlt: "e-mail alternativo", modelo: "modelo", nome: "nome", papel: "papel", ativo: "ativo"
};

function mostraValor(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (typeof v === "object") return "…";
  return texto(v, 60);
}

/** Resume o que mudou: "status: Cotado → Fechado · aéreo: 1200 → 1450". */
function diferencas(antes, depois, campos) {
  const partes = [];
  for (const campo of campos) {
    const a = antes ? antes[campo] : undefined;
    const b = depois[campo];
    if (a === b) continue;
    if ((a === undefined || a === null || a === "") && (b === undefined || b === null || b === "")) continue;
    if (typeof a === "object" || typeof b === "object") {
      if (JSON.stringify(a || null) === JSON.stringify(b || null)) continue;
    }
    partes.push(`${ROTULO_CAMPO[campo] || campo}: ${mostraValor(a)} → ${mostraValor(b)}`);
    if (partes.length >= 8) { partes.push("…"); break; }
  }
  return partes.join(" · ");
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
      usuarios: [],
      historico: [],
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
    if (guardado && estruturaValida(guardado.dados)) {
      // Base gravada antes dos acessos individuais existirem.
      if (!Array.isArray(guardado.usuarios)) guardado.usuarios = [];
      if (!Array.isArray(guardado.historico)) guardado.historico = [];
      return guardado;
    }
    const novo = estadoInicial();
    await cfg.gravar(novo);
    return novo;
  }

  /** Persiste, anota quem mexeu e devolve o estado já sem as senhas. */
  async function grava(estado, sessao, registro) {
    registra(estado, sessao, registro);
    estado.revisao = (estado.revisao || 0) + 1;
    estado.atualizadoEm = new Date().toISOString();
    estado.atualizadoPor = sessao.nome || "";
    await cfg.gravar(estado);
    return json(paraCliente(estado, sessao));
  }

  /**
   * O corpo que o navegador recebe. O histórico fica de fora — é grande e tem
   * rota própria — e os usuários vão sem o hash da senha.
   */
  function paraCliente(estado, sessao) {
    return {
      revisao: estado.revisao,
      atualizadoEm: estado.atualizadoEm,
      atualizadoPor: estado.atualizadoPor,
      importacao: estado.importacao,
      dados: estado.dados,
      usuarios: estado.usuarios.map(semSenha),
      sessao: sessao ? { id: sessao.id, nome: sessao.nome, papel: sessao.papel,
                         mestre: !!sessao.mestre, trocarSenha: !!sessao.trocarSenha } : null
    };
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

      const estado = await estadoAtual();
      const senha = String(corpo.senha || "");
      const identificador = texto(corpo.usuario || corpo.nome, 120).trim();
      const usuario = achaUsuario(estado.usuarios, identificador);

      // Quem tem acesso próprio entra pela sua senha; a senha mestre segue
      // valendo como porta de emergência de quem administra o site.
      let sessao = null;
      if (usuario && usuario.ativo && await senhaConfere(senha, usuario.senhaHash)) {
        sessao = { id: usuario.id, nome: usuario.nome, papel: usuario.papel, trocarSenha: !!usuario.trocarSenha };
      } else if (cfg.senhaHash && await senhaConfere(senha, cfg.senhaHash)) {
        // Entra como mestre com qualquer nome digitado — mas nunca com o nome de
        // alguém cadastrado, para o registro não parecer que foi a própria pessoa.
        sessao = { id: ID_MESTRE, papel: "admin", mestre: true,
                   nome: (usuario || !identificador) ? "Acesso mestre" : identificador };
      }

      // Atrasa toda resposta de login, certa ou errada, para tornar a força bruta cara.
      await new Promise((r) => setTimeout(r, 350));
      if (!sessao) {
        registraFalha(ip);
        return erro(401, usuario && !usuario.ativo
          ? "Este acesso está desativado. Fale com quem administra o sistema."
          : "Usuário ou senha incorretos.");
      }

      const token = await criaSessao(sessao.id, sessao.nome, cfg.segredo);
      if (usuario) {
        usuario.ultimoAcesso = new Date().toISOString();
        await cfg.gravar(estado);       // só carimba a entrada: não mexe na revisão
      }
      return json(paraCliente(estado, sessao), { headers: { "set-cookie": cookieSessao(token, seguro) } });
    }

    if (caminho === "/api/sessao" && metodo === "DELETE") {
      return json({ ok: true }, { headers: { "set-cookie": cookieSessao("", seguro) } });
    }

    // ---- daqui para baixo, só com sessão ----
    const token = await leSessao(leCookie(request, "sessao"), cfg.segredo);
    if (!token) return erro(401, "Entre com o seu usuário e senha.");

    const estado = await estadoAtual();
    const dados = estado.dados;

    // O papel vem da base agora, não do token: mudar o acesso de alguém vale
    // na hora, sem esperar a sessão dela expirar.
    let sessao;
    if (token.id === ID_MESTRE) {
      sessao = { id: ID_MESTRE, nome: token.nome || "Acesso mestre", papel: "admin", mestre: true };
    } else {
      const usuario = estado.usuarios.find((u) => u.id === token.id);
      if (!usuario || !usuario.ativo) return erro(401, "Seu acesso foi encerrado. Entre de novo.");
      sessao = { id: usuario.id, nome: usuario.nome, papel: usuario.papel, trocarSenha: !!usuario.trocarSenha };
    }
    const admin = sessao.papel === "admin";

    if (caminho === "/api/sessao" && metodo === "GET") {
      return json({ id: sessao.id, nome: sessao.nome, papel: sessao.papel,
                    mestre: !!sessao.mestre, trocarSenha: !!sessao.trocarSenha });
    }

    if (caminho === "/api/estado" && metodo === "GET") return json(paraCliente(estado, sessao));

    if (caminho === "/api/usuarios" && metodo === "GET") {
      return json({ usuarios: estado.usuarios.map(semSenha) });
    }

    // A senha provisória serve para entrar e escolher a definitiva, e nada mais:
    // enquanto não for trocada, a sessão só lê. Sem isso ela viraria uma senha
    // permanente para quem chamasse a API por fora da tela.
    if (sessao.trocarSenha && metodo !== "GET" && caminho !== "/api/senha") {
      return erro(403, "Defina a sua senha antes de lançar qualquer coisa.");
    }

    if (caminho === "/api/historico" && metodo === "GET") {
      const limite = Math.min(Math.max(Number(url.searchParams.get("limite")) || 200, 1), LIMITE_HISTORICO);
      return json({ total: estado.historico.length, historico: estado.historico.slice(0, limite) });
    }

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

    // ---- a própria senha ----
    if (caminho === "/api/senha" && metodo === "PUT") {
      if (sessao.mestre) {
        return erro(400, "O acesso mestre não tem senha própria: ela fica na configuração do site.");
      }
      const usuario = estado.usuarios.find((u) => u.id === sessao.id);
      if (!usuario) return erro(404, "Acesso não encontrado.");
      const nova = String(corpo.nova || "");
      if (nova.length < SENHA_MINIMA) return erro(400, `A senha nova precisa de pelo menos ${SENHA_MINIMA} caracteres.`);
      // Quem foi obrigado a trocar (acesso novo ou senha redefinida) já provou
      // quem é ao entrar com a senha provisória, então não pedimos de novo.
      if (!usuario.trocarSenha && !await senhaConfere(String(corpo.atual || ""), usuario.senhaHash)) {
        await new Promise((r) => setTimeout(r, 350));
        return erro(401, "A senha atual não confere.");
      }
      usuario.senhaHash = await hashSenha(nova);
      usuario.trocarSenha = false;
      sessao.trocarSenha = false;
      return grava(estado, sessao, { acao: "alterou", entidade: "acesso",
                                     alvo: usuario.nome, resumo: "trocou a própria senha" });
    }

    // ---- acessos (só admin) ----
    const soAdmin = () => erro(403, "Só quem administra o sistema pode mexer nos acessos.");

    /** Garante que a última pessoa com poder de administrar não se apague sozinha. */
    function sobraAdmin(usuarios, ignorarId) {
      return usuarios.some((u) => u.id !== ignorarId && u.ativo && u.papel === "admin");
    }

    if (caminho === "/api/usuario" && metodo === "PUT") {
      if (!admin) return soAdmin();
      const limpo = limpaUsuario(corpo.usuario || {});
      if (!limpo.nome) return erro(400, "Informe o nome de quem vai ter acesso.");
      if (limpo.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(limpo.email)) {
        return erro(400, "E-mail inválido.");
      }
      const id = texto(corpo.usuario && corpo.usuario.id, 40);
      const alvo = id ? estado.usuarios.find((u) => u.id === id) : null;
      if (id && !alvo) return erro(404, "Acesso não encontrado.");

      // Nome e e-mail servem para entrar, então não podem repetir.
      const repetido = estado.usuarios.find((u) => u.id !== id && (
        normal(u.nome) === normal(limpo.nome) ||
        (limpo.email && normal(u.email) === normal(limpo.email))
      ));
      if (repetido) return erro(409, `Já existe um acesso com esse nome ou e-mail (${repetido.nome}).`);

      let registro;
      if (alvo) {
        if ((!limpo.ativo || limpo.papel !== "admin") && alvo.papel === "admin" && alvo.ativo &&
            !sobraAdmin(estado.usuarios, alvo.id)) {
          return erro(409, "Este é o último acesso de administrador ativo. Promova outra pessoa antes.");
        }
        registro = { acao: "alterou", entidade: "acesso", alvo: limpo.nome,
                     resumo: diferencas(alvo, limpo, ["nome", "email", "papel", "ativo"]) };
        Object.assign(alvo, limpo);
      } else {
        const senha = String(corpo.senha || "");
        if (senha.length < SENHA_MINIMA) {
          return erro(400, `Defina uma senha inicial com pelo menos ${SENHA_MINIMA} caracteres.`);
        }
        const novo = {
          id: proximoIdUsuario(estado.usuarios),
          ...limpo,
          senhaHash: await hashSenha(senha),
          trocarSenha: true,          // a senha inicial vale uma vez; a pessoa escolhe a dela
          criadoEm: new Date().toISOString(),
          criadoPor: sessao.nome,
          ultimoAcesso: ""
        };
        estado.usuarios.push(novo);
        registro = { acao: "incluiu", entidade: "acesso", alvo: novo.nome,
                     resumo: `${novo.papel}${novo.email ? " · " + novo.email : ""}` };
      }
      estado.usuarios.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
      return grava(estado, sessao, registro);
    }

    const casaSenhaUsuario = caminho.match(/^\/api\/usuario\/([^/]+)\/senha$/);
    if (casaSenhaUsuario && metodo === "POST") {
      if (!admin) return soAdmin();
      const alvo = estado.usuarios.find((u) => u.id === decodeURIComponent(casaSenhaUsuario[1]));
      if (!alvo) return erro(404, "Acesso não encontrado.");
      const nova = String(corpo.nova || "");
      if (nova.length < SENHA_MINIMA) return erro(400, `A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`);
      alvo.senhaHash = await hashSenha(nova);
      alvo.trocarSenha = true;
      return grava(estado, sessao, { acao: "alterou", entidade: "acesso", alvo: alvo.nome,
                                     resumo: "senha redefinida; será trocada no próximo acesso" });
    }

    const casaUsuario = caminho.match(/^\/api\/usuario\/([^/]+)$/);
    if (casaUsuario && metodo === "DELETE") {
      if (!admin) return soAdmin();
      const alvoId = decodeURIComponent(casaUsuario[1]);
      const alvo = estado.usuarios.find((u) => u.id === alvoId);
      if (!alvo) return erro(404, "Acesso não encontrado.");
      if (alvo.papel === "admin" && alvo.ativo && !sobraAdmin(estado.usuarios, alvoId)) {
        return erro(409, "Este é o último acesso de administrador ativo. Promova outra pessoa antes.");
      }
      estado.usuarios = estado.usuarios.filter((u) => u.id !== alvoId);
      return grava(estado, sessao, { acao: "excluiu", entidade: "acesso", alvo: alvo.nome, resumo: "" });
    }

    // ---- viagens ----
    if (caminho === "/api/viagem" && metodo === "PUT") {
      const entrada = corpo.viagem || {};
      const id = Number(entrada.id) || 0;
      const limpa = limpaViagem(entrada);
      if (!limpa.colaborador || !limpa.dataIda || !limpa.dataVolta) {
        return erro(400, "Informe colaborador e as datas de ida e volta.");
      }
      const agora = new Date().toISOString();
      let alvo = id ? dados.viagens.find((v) => Number(v.id) === id) : null;
      let registro;
      if (alvo) {
        const mudou = diferencas(alvo, limpa, CAMPOS_VIAGEM);
        Object.assign(alvo, limpa);
        alvo.alteradoPor = sessao.nome;
        alvo.alteradoEm = agora;
        registro = { acao: "alterou", entidade: "viagem",
                     alvo: `#${alvo.id} · ${alvo.colaborador} · ${alvo.destino}`, resumo: mudou };
      } else {
        alvo = { id: proximoId(dados), ...limpa };
        alvo.criadoPor = sessao.nome;
        alvo.criadoEm = agora;
        dados.viagens.push(alvo);
        registro = { acao: "incluiu", entidade: "viagem",
                     alvo: `#${alvo.id} · ${alvo.colaborador} · ${alvo.destino}`,
                     resumo: `${alvo.dataIda} a ${alvo.dataVolta} · ${alvo.status || "sem status"}` };
      }
      return grava(estado, sessao, registro);
    }

    const casaViagem = caminho.match(/^\/api\/viagem\/(\d+)$/);
    if (casaViagem && metodo === "DELETE") {
      const id = Number(casaViagem[1]);
      const removida = dados.viagens.find((v) => Number(v.id) === id);
      dados.viagens = dados.viagens.filter((v) => Number(v.id) !== id);
      // Alteração órfã vira lançamento comum, para nada sumir do total.
      for (const v of dados.viagens) {
        if (Number(v.refId) === id) { v.refId = null; v.tipo = "Viagem"; }
      }
      return grava(estado, sessao, {
        acao: "excluiu", entidade: "viagem",
        alvo: removida ? `#${id} · ${removida.colaborador} · ${removida.destino}` : `#${id}`,
        resumo: removida ? `${removida.dataIda} a ${removida.dataVolta}` : ""
      });
    }

    // ---- colaboradores ----
    if (caminho === "/api/colaborador" && metodo === "PUT") {
      const limpo = limpaColaborador(corpo.colaborador || {});
      if (!limpo.nome.trim()) return erro(400, "Informe o nome do colaborador.");
      const anterior = texto(corpo.nomeOriginal, 200).trim();
      const chave = normal(anterior || limpo.nome);
      const alvo = dados.colaboradores.find((c) => normal(c.nome) === chave);
      let registro;
      if (alvo) {
        if (anterior && normal(anterior) !== normal(limpo.nome)) {
          for (const v of dados.viagens) if (normal(v.colaborador) === chave) v.colaborador = limpo.nome;
          for (const m of dados.params.dePara || []) if (normal(m.colaborador) === chave) m.colaborador = limpo.nome;
        }
        registro = { acao: "alterou", entidade: "colaborador", alvo: limpo.nome,
                     resumo: diferencas(alvo, limpo, CAMPOS_COLABORADOR) };
        Object.assign(alvo, limpo);
      } else {
        dados.colaboradores.push(limpo);
        registro = { acao: "incluiu", entidade: "colaborador", alvo: limpo.nome,
                     resumo: [limpo.area, limpo.cargo].filter(Boolean).join(" · ") };
      }
      dados.colaboradores.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
      return grava(estado, sessao, registro);
    }

    const casaColab = caminho.match(/^\/api\/colaborador\/(.+)$/);
    if (casaColab && metodo === "DELETE") {
      const chave = normal(decodeURIComponent(casaColab[1]));
      const usos = dados.viagens.filter((v) => normal(v.colaborador) === chave).length;
      if (usos) return erro(409, `Este colaborador tem ${usos} viagem(ns) lançada(s).`);
      const saiu = dados.colaboradores.find((c) => normal(c.nome) === chave);
      dados.colaboradores = dados.colaboradores.filter((c) => normal(c.nome) !== chave);
      return grava(estado, sessao, { acao: "excluiu", entidade: "colaborador",
                                     alvo: saiu ? saiu.nome : decodeURIComponent(casaColab[1]), resumo: "" });
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
      return grava(estado, sessao, { acao: "importou", entidade: "uber", alvo: "relatório do Uber",
                                     resumo: `${novas} corrida(s) nova(s), ${repetidas} repetida(s) ignorada(s)` });
    }

    if (caminho === "/api/uber" && metodo === "DELETE") {
      const linha = texto(corpo.linha, 2000);
      dados.uber = dados.uber.filter((r) => r.linha !== linha);
      return grava(estado, sessao, { acao: "excluiu", entidade: "uber", alvo: "corrida",
                                     resumo: linha.split(";").slice(0, 5).join(" · ") });
    }

    if (caminho === "/api/uber/tudo" && metodo === "DELETE") {
      const quantas = dados.uber.length;
      dados.uber = [];
      return grava(estado, sessao, { acao: "excluiu", entidade: "uber", alvo: "base inteira do Uber",
                                     resumo: `${quantas} linha(s) apagada(s)` });
    }

    // ---- parâmetros ----
    if (caminho === "/api/params" && metodo === "PUT") {
      if (!corpo.params || typeof corpo.params !== "object") return erro(400, "Parâmetros inválidos.");
      const antes = dados.params.regras || {};
      const depois = corpo.params.regras || {};
      dados.params = corpo.params;
      return grava(estado, sessao, {
        acao: "alterou", entidade: "parâmetros", alvo: "regras e vínculos",
        resumo: diferencas(antes, depois, ["jantar", "cafe", "toleranciaUber"])
      });
    }

    // ---- backup e base original ----
    if (caminho === "/api/estado" && metodo === "PUT") {
      if (!estruturaValida(corpo.dados)) return erro(400, "Backup fora do formato esperado.");
      estado.dados = corpo.dados;
      return grava(estado, sessao, {
        acao: "restaurou", entidade: "base", alvo: "backup",
        resumo: `${corpo.dados.viagens.length} viagens · ${corpo.dados.colaboradores.length} pessoas`
      });
    }

    if (caminho === "/api/base-original" && metodo === "POST") {
      const inicial = estadoInicial();
      estado.dados = inicial.dados;
      return grava(estado, sessao, { acao: "restaurou", entidade: "base",
                                     alvo: "base original da planilha", resumo: "" });
    }

    return erro(404, "Rota não encontrada.");
  };
}

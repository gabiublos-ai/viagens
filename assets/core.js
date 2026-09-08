/* Núcleo: estado, persistência e todas as regras de cálculo.
   As regras reproduzem exatamente as fórmulas da planilha original. */

(function () {
  "use strict";

  var STORAGE_KEY = "gvc.v1";

  // ---------- utilidades ----------

  var MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  var MESES_LONGOS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
                      "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

  function brl(v, casas) {
    var n = Number(v) || 0;
    return n.toLocaleString("pt-BR", {
      minimumFractionDigits: casas === undefined ? 2 : casas,
      maximumFractionDigits: casas === undefined ? 2 : casas
    });
  }

  /** Dinheiro como aparece na tela: "R$ 1.235", sem centavos. */
  function moeda(v) { return "R$ " + brl(v, 0); }

  var brlSigla = moeda;   // nome antigo, mantido para não quebrar chamadas

  /** Compacta valores altos para eixos de gráfico: 12.000 → "12 mil". */
  function brlCurto(v) {
    var n = Number(v) || 0;
    if (Math.abs(n) >= 1000) return brl(n / 1000, 0) + " mil";
    return brl(n, 0);
  }

  /** Aceita "1.234,56", "1234.56", "1234,5" ou vazio. */
  function parseNum(txt) {
    if (typeof txt === "number") return txt;
    if (!txt) return 0;
    var s = String(txt).trim().replace(/[R$\s]/g, "");
    if (!s) return 0;
    if (s.indexOf(",") > -1) s = s.replace(/\./g, "").replace(",", ".");
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  /** "2026-08-17" → Date local (sem deslocamento de fuso). */
  function toDate(iso) {
    if (!iso) return null;
    var p = String(iso).split("-");
    if (p.length !== 3) return null;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d.getTime()) ? null : d;
  }

  function toISO(d) {
    if (!d) return "";
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function fmtData(iso) {
    var d = toDate(iso);
    return d ? pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() : "—";
  }

  /** "17/08" — para colunas estreitas. */
  function fmtDataCurta(iso) {
    var d = toDate(iso);
    return d ? pad(d.getDate()) + "/" + pad(d.getMonth() + 1) : "—";
  }

  function diasEntre(isoA, isoB) {
    var a = toDate(isoA), b = toDate(isoB);
    if (!a || !b) return 0;
    return Math.round((b - a) / 86400000);
  }

  function addDias(iso, n) {
    var d = toDate(iso);
    if (!d) return "";
    d.setDate(d.getDate() + n);
    return toISO(d);
  }

  /** "2026-08-17" → "08/2026" */
  function mesRefDe(iso) {
    var d = toDate(iso);
    return d ? pad(d.getMonth() + 1) + "/" + d.getFullYear() : "";
  }

  /** "08/2026" → "Ago/26" */
  function mesRotulo(mesRef) {
    if (!mesRef) return "—";
    var p = mesRef.split("/");
    var m = +p[0];
    if (!m) return mesRef;
    var nome = MESES_CURTOS[m - 1];
    return nome.charAt(0).toUpperCase() + nome.slice(1) + "/" + String(p[1]).slice(-2);
  }

  function mesNome(mesRef) {
    var p = String(mesRef || "").split("/");
    return MESES_LONGOS[+p[0] - 1] ? MESES_LONGOS[+p[0] - 1] + " de " + p[1] : mesRef;
  }

  function anoDe(mesRef) { return String(mesRef || "").split("/")[1] || ""; }

  function iniciais(nome) {
    var p = String(nome || "").trim().split(/\s+/).filter(function (x) { return x.length > 2 || /^[A-ZÀ-Ú]/.test(x); });
    if (!p.length) return "?";
    var a = p[0].charAt(0);
    var b = p.length > 1 ? p[p.length - 1].charAt(0) : "";
    return (a + b).toUpperCase();
  }

  /** Comparação insensível a acento e caixa, para busca. */
  function normal(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function ordenaPt(a, b) { return String(a).localeCompare(String(b), "pt-BR"); }

  // ---------- estado ----------

  var db = null;
  var armazem = null;
  var meta = { revisao: 0, atualizadoEm: "", atualizadoPor: "", nome: "",
               id: "", papel: "editor", mestre: false, trocarSenha: false };
  var usuarios = [];          // quem tem acesso, sem as senhas (só no modo servidor)
  var equipeAtualizada = 0;   // nº de cadastros mexidos na última migração, para avisar na tela

  /** Usado só quando o estado guardado vem sem alguma lista (defesa). */
  var PARAMS_PADRAO = {
    meses: [], categorias: ["Aéreo", "Hospedagem", "Alimentação", "Transporte/Aux.", "Alterações", "Uber Corporativo"],
    statuses: ["Fechado", "Cotado", "Pendente", "Cancelado", "Alterada"],
    servicos: [], tiposTransacao: [],
    palavrasAeroporto: ["aeroport", "airport", "terminal", "linneu gomes", "confins", "rocha pombo"],
    regras: { jantar: 70, cafe: 30, toleranciaUber: 1 },
    dePara: [],
    conferenciasUber: {}
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function paramsBase() {
    return window.SEED && window.SEED.parametros ? window.SEED.parametros : PARAMS_PADRAO;
  }

  /** Base original da planilha — só existe quando o app roda sem servidor. */
  function estadoInicial() {
    var s = clone(window.SEED);
    return {
      versao: 1,
      baseEquipeVersao: s.baseEquipeVersao || 0,
      colaboradores: s.colaboradores,
      viagens: s.viagens,
      uber: s.uberRaw.map(function (linha) { return { linha: linha }; }),
      params: s.parametros,
      atualizadoEm: new Date().toISOString()
    };
  }

  /**
   * Abre a base. Devolve {autenticado} — no site com senha, `false` significa
   * que ainda falta entrar.
   */
  function iniciar() {
    armazem = window.Armazenamento.criar(function () { return db; });
    return armazem.iniciar().then(function (r) {
      if (!r.autenticado) return { autenticado: false };
      assume(r.estado);
      return { autenticado: true };
    });
  }

  function entrar(usuario, senha) {
    return armazem.entrar(usuario, senha).then(function (estado) {
      assume(estado);
      return estado;
    });
  }

  function sair() { return armazem.sair(); }

  /** Toda resposta do servidor traz quem está logado e quem tem acesso. */
  function adotaSessao(estado) {
    if (estado.sessao) {
      meta.id = estado.sessao.id || "";
      meta.nome = estado.sessao.nome || "";
      meta.papel = estado.sessao.papel || "editor";
      meta.mestre = !!estado.sessao.mestre;
      meta.trocarSenha = !!estado.sessao.trocarSenha;
    }
    if (Array.isArray(estado.usuarios)) usuarios = estado.usuarios;
  }

  function ehAdmin() { return meta.papel === "admin"; }

  function trocarPropriaSenha(atual, nova) {
    return armazem.trocarPropriaSenha(atual, nova).then(aplica);
  }

  function salvarUsuario(usuario, senha) {
    return armazem.salvarUsuario(usuario, senha).then(aplica);
  }

  function excluirUsuario(id) { return armazem.excluirUsuario(id).then(aplica); }

  function redefinirSenha(id, nova) { return armazem.redefinirSenha(id, nova).then(aplica); }

  /** Registro de quem incluiu, alterou ou excluiu — vem por rota própria. */
  function historico(limite) { return armazem.historico(limite); }

  /**
   * Senha inicial legível: fácil de ditar por telefone e de digitar uma vez.
   * Sem letra e número que se confundem (O/0, l/1) para não gerar retrabalho.
   */
  function senhaSugerida() {
    var palavras = ["viagem", "aereo", "hotel", "embarque", "destino", "bagagem",
                    "cidade", "roteiro", "diaria", "voo"];
    var letras = "abcdefghijkmnpqrstuvwxyz";
    var sorteio = crypto.getRandomValues(new Uint8Array(8));
    var sufixo = "";
    for (var i = 0; i < 4; i++) sufixo += letras[sorteio[i] % letras.length];
    var numero = 100 + (sorteio[4] % 90) * 10 + (sorteio[5] % 10);
    return palavras[sorteio[6] % palavras.length] + "-" + sufixo + "-" + numero;
  }

  /** Adota o estado que veio do servidor (ou do navegador, no modo local). */
  function assume(estado) {
    if (estado && estado.dados) {
      db = estado.dados;
      meta.revisao = estado.revisao || 0;
      meta.atualizadoEm = estado.atualizadoEm || "";
      meta.atualizadoPor = estado.atualizadoPor || "";
      adotaSessao(estado);
    } else if (window.SEED) {
      db = estadoInicial();
    } else {
      return;   // sem servidor e sem base local: nada a fazer
    }
    normalizaEstado();
    if (armazem.modo === "local") {
      var mexidos = atualizaBaseEquipe();
      if (mexidos) { equipeAtualizada = mexidos; armazem.salvarParams(); }
    }
    cacheUber = null;
    avisa();
  }

  /**
   * Traz a base de equipe nova para dentro de dados já salvos no navegador.
   * Atualiza quem já existe, inclui quem entrou, e nunca apaga o que a origem
   * deixou em branco (o gestor direto, por exemplo) nem quem foi cadastrado aqui.
   */
  function atualizaBaseEquipe() {
    if (!window.SEED) return 0;
    var versaoSeed = window.SEED.baseEquipeVersao || 0;
    if (!versaoSeed || (db.baseEquipeVersao || 0) >= versaoSeed) return 0;

    var porNome = {};
    db.colaboradores.forEach(function (c) { porNome[normal(c.nome)] = c; });

    var mexidos = 0;
    clone(window.SEED.colaboradores).forEach(function (novo) {
      var alvo = porNome[normal(novo.nome)];
      if (!alvo) { db.colaboradores.push(novo); mexidos++; return; }
      var mudou = false;
      Object.keys(novo).forEach(function (campo) {
        if (campo === "nome" || !novo[campo]) return;
        if (alvo[campo] !== novo[campo]) { alvo[campo] = novo[campo]; mudou = true; }
      });
      if (mudou) mexidos++;
    });

    db.colaboradores.sort(function (a, b) { return ordenaPt(a.nome, b.nome); });
    db.baseEquipeVersao = versaoSeed;
    return mexidos;
  }

  function normalizaEstado() {
    var base = paramsBase();
    db.params = db.params || {};
    ["meses", "categorias", "statuses", "servicos", "tiposTransacao", "palavrasAeroporto", "dePara"].forEach(function (k) {
      if (!db.params[k]) db.params[k] = clone(base[k] || PARAMS_PADRAO[k] || []);
    });
    db.params.regras = Object.assign({}, PARAMS_PADRAO.regras, base.regras || {}, db.params.regras || {});
    if (!db.params.conferenciasUber || typeof db.params.conferenciasUber !== "object") db.params.conferenciasUber = {};
    db.uber = db.uber || [];
    db.viagens = db.viagens || [];
    db.colaboradores = db.colaboradores || [];
  }

  var ouvintes = [];
  function aoMudar(fn) { ouvintes.push(fn); }
  function avisa() { ouvintes.forEach(function (fn) { fn(); }); }

  /** Recebe a resposta de uma escrita e passa a valer o que o servidor devolveu. */
  function aplica(estado) {
    if (estado && estado.dados && armazem.modo === "servidor") {
      db = estado.dados;
      meta.revisao = estado.revisao || 0;
      meta.atualizadoEm = estado.atualizadoEm || "";
      meta.atualizadoPor = estado.atualizadoPor || "";
      adotaSessao(estado);
      normalizaEstado();
    } else if (estado) {
      meta.atualizadoEm = estado.atualizadoEm || meta.atualizadoEm;
    }
    cacheUber = null;
    avisa();
    return estado;
  }

  /** Busca o estado no servidor — usado quando outra pessoa alterou a base. */
  function recarregar() {
    return armazem.estado().then(aplica);
  }

  /** Só a revisão, para saber se alguém mexeu. */
  function revisaoRemota() { return armazem.revisao(); }

  function substituirEstado(dados) {
    if (armazem.modo === "servidor") return armazem.restaurarEstado(dados).then(aplica);
    db = dados;
    normalizaEstado();
    return armazem.restaurarEstado(dados).then(aplica);
  }

  function restaurarBase() {
    if (armazem.modo === "servidor") return armazem.restaurarBase().then(aplica);
    db = estadoInicial();
    normalizaEstado();
    return armazem.restaurarBase().then(aplica);
  }

  /** Persiste uma mudança feita direto no objeto (parâmetros, De-Para). */
  function salvarParams() {
    return armazem.salvarParams(db.params).then(aplica);
  }

  // ---------- colaboradores ----------

  function colaborador(nome) {
    if (!nome) return null;
    var alvo = normal(nome);
    for (var i = 0; i < db.colaboradores.length; i++) {
      if (normal(db.colaboradores[i].nome) === alvo) return db.colaboradores[i];
    }
    return null;
  }

  function areaDe(nome) { var c = colaborador(nome); return c ? c.area : "—"; }
  function gestorDe(nome) { var c = colaborador(nome); return c && c.gestor ? c.gestor : "—"; }

  function areas() {
    var set = {};
    db.colaboradores.forEach(function (c) { if (c.area) set[c.area] = 1; });
    return Object.keys(set).sort(ordenaPt);
  }

  function colaboradoresOrdenados() {
    return db.colaboradores.slice().sort(function (a, b) { return ordenaPt(a.nome, b.nome); });
  }

  /** Cria ou atualiza um cadastro. Renomear leva junto as viagens e o De-Para. */
  function salvarColaborador(dados, nomeOriginal) {
    var limpo = Object.assign({}, dados);
    limpo.nome = String(limpo.nome || "").trim();
    if (!limpo.nome) return Promise.reject(new Error("Informe o nome do colaborador."));

    if (armazem.modo === "servidor") {
      return armazem.salvarColaborador(limpo, nomeOriginal || "").then(aplica);
    }

    var chave = normal(nomeOriginal || limpo.nome);
    var alvo = null;
    db.colaboradores.forEach(function (c) { if (normal(c.nome) === chave) alvo = c; });
    if (alvo) {
      if (nomeOriginal && normal(nomeOriginal) !== normal(limpo.nome)) {
        db.viagens.forEach(function (v) { if (normal(v.colaborador) === chave) v.colaborador = limpo.nome; });
        db.params.dePara.forEach(function (m) { if (normal(m.colaborador) === chave) m.colaborador = limpo.nome; });
      }
      Object.assign(alvo, limpo);
    } else {
      db.colaboradores.push(limpo);
    }
    db.colaboradores.sort(function (a, b) { return ordenaPt(a.nome, b.nome); });
    return armazem.salvarColaborador(limpo, nomeOriginal || "").then(aplica);
  }

  function excluirColaborador(nome) {
    var chave = normal(nome);
    var usos = db.viagens.filter(function (v) { return normal(v.colaborador) === chave; }).length;
    if (usos) {
      return Promise.reject(new Error("Este colaborador tem " + usos + " viagem(ns) lançada(s)."));
    }
    if (armazem.modo === "servidor") return armazem.excluirColaborador(nome).then(aplica);
    db.colaboradores = db.colaboradores.filter(function (c) { return normal(c.nome) !== chave; });
    return armazem.excluirColaborador(nome).then(aplica);
  }

  // ---------- regras de viagem ----------

  /** O que pode ter acontecido com uma viagem já aprovada. */
  var TIPOS_ALTERACAO = [
    { v: "Remarcação de voo", cancela: false, periodo: true },
    { v: "Extensão do período", cancela: false, periodo: true },
    { v: "Antecipação do retorno", cancela: false, periodo: true },
    { v: "Cancelamento da viagem", cancela: true, periodo: false },
    { v: "No-show", cancela: true, periodo: false },
    { v: "Troca de hotel", cancela: false, periodo: false },
    { v: "Outro", cancela: false, periodo: true }
  ];

  function tipoAlteracao(nome) {
    for (var i = 0; i < TIPOS_ALTERACAO.length; i++) {
      if (TIPOS_ALTERACAO[i].v === nome) return TIPOS_ALTERACAO[i];
    }
    return TIPOS_ALTERACAO[0];
  }

  /**
   * Valor devido de alimentação por pernoite. Quando o hotel serve café da
   * manhã, só o jantar é devido — o café sai da conta.
   */
  function porPernoite(cafeIncluso) {
    var r = db.params.regras;
    return (Number(r.jantar) || 0) + (cafeIncluso ? 0 : (Number(r.cafe) || 0));
  }

  /**
   * Calcula os campos derivados de uma viagem — espelha as fórmulas da aba Viagens.
   * Entrada: registro cru. Saída: objeto com os derivados.
   */
  function calc(v) {
    var noites = Math.max(0, diasEntre(v.dataIda, v.dataVolta));

    // A hospedagem passou a ser lançada pelo total. Lançamentos antigos, feitos
    // por diárias × valor, continuam valendo pelo cálculo antigo.
    var hospedagem = v.hospedagem === undefined || v.hospedagem === null || v.hospedagem === ""
      ? round2((Number(v.diarias) || 0) * (Number(v.valorDiaria) || 0))
      : round2(Number(v.hospedagem) || 0);
    var porNoite = noites ? round2(hospedagem / noites) : 0;
    var total = round2((Number(v.aereo) || 0) + hospedagem + (Number(v.alimentacao) || 0) +
                       (Number(v.transporte) || 0) + (Number(v.custoAlteracao) || 0));
    // Viagem cancelada não gera diária de alimentação.
    var cancelada = v.status === "Cancelado";
    var alimDevida = cancelada ? 0 : round2(noites * porPernoite(v.cafeIncluso));
    var difAlim = round2((Number(v.alimentacao) || 0) - alimDevida);

    var avisos = [];
    if (v.pendencias) avisos.push({ nivel: "crit", curto: "Pendente", texto: "Pendente: " + v.pendencias });
    if (hospedagem > 0 && noites === 0) {
      avisos.push({ nivel: "warn", curto: "Hospedagem sem noite",
                    texto: "Tem hospedagem lançada, mas o período não tem pernoite" });
    }
    if (difAlim !== 0) {
      avisos.push({ nivel: "warn", curto: "Alimentação",
                    texto: "Alimentação " + (difAlim < 0 ? "a menor" : "a maior") + ": " +
                           brlSigla(Math.abs(difAlim)) + " ante a regra de " + brlSigla(alimDevida) });
    }

    // Assinatura do que foi conferido: se algum valor mudar, o aviso volta.
    var assinatura = avisos.map(function (a) { return a.texto; }).join(" | ");
    var conferido = !!(v.conferencia && v.conferencia.assinatura === assinatura && avisos.length);

    return {
      mesRef: mesRefDe(v.dataIda),
      area: areaDe(v.colaborador),
      gestor: gestorDe(v.colaborador),
      noites: noites,
      // A viagem cancelada não aconteceu: não conta pernoite nem entra no calendário.
      noitesEfetivas: cancelada ? 0 : noites,
      cancelada: cancelada,
      hospedagem: hospedagem,
      porNoite: porNoite,
      total: total,
      alimDevida: alimDevida,
      difAlim: difAlim,
      avisos: avisos,
      assinatura: assinatura,
      conferido: conferido,
      ok: avisos.length === 0,
      // O que ainda pede atenção: tem aviso e ninguém validou.
      precisaConferir: avisos.length > 0 && !conferido
    };
  }

  /** Viagem + derivados num único objeto (usado por todas as telas). */
  function viagemCompleta(v) { return Object.assign({}, v, calc(v)); }

  function viagens() { return db.viagens.map(viagemCompleta); }

  function viagemPorId(id) {
    id = Number(id);
    for (var i = 0; i < db.viagens.length; i++) if (db.viagens[i].id === id) return db.viagens[i];
    return null;
  }

  function proximoId() {
    var max = 0;
    db.viagens.forEach(function (v) { if (v.id > max) max = v.id; });
    return max + 1;
  }

  var CAMPOS_VIAGEM = ["tipo", "colaborador", "destino", "aeroportoOrigem", "dataIda", "dataVolta",
                       "aereo", "diarias", "valorDiaria", "alimentacao", "transporte", "custoAlteracao",
                       "status", "refId", "motivo", "pendencias", "obs", "conferencia",
                       "hospedagem", "tipoAlteracao", "cafeIncluso"];

  function viagemVazia() {
    return {
      id: 0, tipo: "Viagem", colaborador: "", destino: "São Paulo/SP", aeroportoOrigem: "",
      dataIda: "", dataVolta: "", aereo: 0, hospedagem: 0, diarias: 0, valorDiaria: 0, alimentacao: 0,
      transporte: 0, custoAlteracao: 0, status: "Fechado", refId: null,
      motivo: "", pendencias: "", obs: "", conferencia: null, tipoAlteracao: "",
      cafeIncluso: false
    };
  }

  /** Cria ou atualiza. Devolve uma promessa com a viagem já gravada. */
  function salvarViagem(dados) {
    var base = dados.id ? clone(viagemPorId(dados.id) || viagemVazia()) : viagemVazia();
    CAMPOS_VIAGEM.forEach(function (k) {
      if (dados[k] !== undefined) base[k] = dados[k];
    });
    base.id = Number(dados.id) || 0;

    // Lançamento antigo, feito por diárias × valor, ainda sem o campo de total:
    // materializa a hospedagem antes de gravar. Sem isso, um salvamento que não
    // passa pelo formulário (validar conferência, cancelar mantendo custos)
    // enviaria o campo vazio e o hotel viraria zero.
    if (base.hospedagem === undefined || base.hospedagem === null || base.hospedagem === "") {
      base.hospedagem = round2((Number(base.diarias) || 0) * (Number(base.valorDiaria) || 0));
    }

    if (armazem.modo === "servidor") {
      return armazem.salvarViagem(base).then(aplica).then(function (estado) {
        return viagemPorId(base.id || (estado && estado.viagemSalva) || maiorId());
      });
    }

    var alvo = base.id ? viagemPorId(base.id) : null;
    if (!alvo) {
      alvo = viagemVazia();
      alvo.id = proximoId();
      db.viagens.push(alvo);
    }
    CAMPOS_VIAGEM.forEach(function (k) { alvo[k] = base[k]; });
    return armazem.salvarViagem(alvo).then(aplica).then(function () { return alvo; });
  }

  function maiorId() {
    var max = 0;
    db.viagens.forEach(function (v) { if (v.id > max) max = v.id; });
    return max;
  }

  function excluirViagem(id) {
    id = Number(id);
    if (armazem.modo === "servidor") return armazem.excluirViagem(id).then(aplica);

    db.viagens = db.viagens.filter(function (v) { return v.id !== id; });
    // Alterações órfãs voltam a ser viagens comuns, para nada sumir do total.
    db.viagens.forEach(function (v) {
      if (v.refId === id) { v.refId = null; v.tipo = "Viagem"; }
    });
    return armazem.excluirViagem(id).then(aplica);
  }

  function duplicarViagem(id) {
    var v = viagemPorId(id);
    if (!v) return Promise.resolve(null);
    var copia = clone(v);
    copia.id = 0;
    copia.refId = null;
    copia.tipo = "Viagem";
    return salvarViagem(copia);
  }

  /**
   * Marca (ou desmarca) a conferência de uma viagem. Guarda quem validou e o
   * que estava sendo validado — se um valor mudar depois, o aviso reaparece.
   */
  function validarConferencia(id, quem) {
    var v = viagemPorId(id);
    if (!v) return Promise.resolve(null);
    var c = calc(v);
    var nova = c.conferido ? null : {
      por: quem || meta.nome || "",
      em: new Date().toISOString(),
      assinatura: c.assinatura
    };
    return salvarViagem(Object.assign({}, v, { conferencia: nova }));
  }

  /**
   * Cancela uma viagem, guardando o motivo. Os custos já lançados podem ser
   * zerados, trocados por uma multa, ou mantidos como estão.
   * @param {string} tratamento  "zerar" | "multa" | "manter"
   */
  /**
   * Cancela a viagem. Em "multa", `custos` diz o que ficou efetivamente cobrado
   * — aéreo não reembolsado, hospedagem de no-show e a taxa/multa. Um número no
   * lugar do objeto continua valendo como a multa (chamadas antigas).
   */
  function cancelarViagem(id, motivo, tratamento, custos) {
    var v = viagemPorId(id);
    if (!v) return Promise.resolve(null);

    var novo = { status: "Cancelado", motivo: motivo || "" };
    if (tratamento === "zerar" || tratamento === "multa") {
      var c = custos && typeof custos === "object" ? custos : { multa: custos };
      var cobrado = tratamento === "multa";
      novo.aereo = cobrado ? (Number(c.aereo) || 0) : 0;
      novo.hospedagem = cobrado ? (Number(c.hospedagem) || 0) : 0;
      novo.diarias = 0;
      novo.valorDiaria = 0;
      novo.alimentacao = 0;
      novo.transporte = 0;
      novo.custoAlteracao = cobrado ? (Number(c.multa) || 0) : 0;
    }
    return salvarViagem(Object.assign({}, v, novo));
  }

  /** Alterações ligadas a uma viagem. */
  function alteracoesDe(id) {
    return db.viagens.filter(function (v) { return v.refId === Number(id); });
  }

  // ---------- Uber ----------

  var cacheUber = null;

  /**
   * Interpreta uma linha do relatório do Uber Business.
   * Formato: data;hora;nome;sobrenome;--;Travel | Serviço;cidade;origem;destino;tipo;valor;valor
   */
  function parseLinhaUber(linha) {
    var p = String(linha).split(";").map(function (x) { return x.trim(); });
    while (p.length < 12) p.push("");

    var data = "";
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(p[0]);
    if (m) data = m[3] + "-" + pad(+m[1]) + "-" + pad(+m[2]); // relatório vem em MM/DD/AAAA

    var nomeRelatorio = (p[2] + " " + p[3]).replace(/\s+/g, " ").trim();
    if (nomeRelatorio === "-- --" || nomeRelatorio === "--") nomeRelatorio = "";

    return {
      linha: linha,
      data: data,
      hora: p[1] === "--" ? "" : p[1],
      nomeRelatorio: nomeRelatorio,
      servico: p[5] === "--" ? "" : p[5].replace(/^Travel \|\s*/, "").trim(),
      cidade: p[6] === "--" ? "" : p[6],
      origem: p[7] === "--" ? "" : p[7],
      destino: p[8] === "--" ? "" : p[8],
      tipo: p[9],
      valor: parseFloat(p[10]) || 0
    };
  }

  /** Nome do relatório → colaborador oficial (De-Para, depois base). */
  function resolveNome(nomeRelatorio) {
    if (!nomeRelatorio) return "";
    var alvo = normal(nomeRelatorio);
    var dp = db.params.dePara;
    for (var i = 0; i < dp.length; i++) {
      if (normal(dp[i].uber) === alvo) return dp[i].colaborador;
    }
    var c = colaborador(nomeRelatorio);
    return c ? c.nome : "";
  }

  function ehAeroporto(origem, destino) {
    var texto = normal(origem + " " + destino);
    return db.params.palavrasAeroporto.some(function (k) { return k && texto.indexOf(normal(k)) > -1; });
  }

  /** Confronta a corrida com as datas de viagem do colaborador. */
  function auditaCorrida(c, viagensPorPessoa) {
    if (!c.data) return { situacao: "sem-data", texto: "Sem data" };
    if (c.tipo !== "Fare") return { situacao: "na", texto: "n/a" };
    if (!c.colaborador) return { situacao: "sem-viagem", texto: "Sem viagem registrada" };

    var lista = viagensPorPessoa[c.colaborador];
    if (!lista || !lista.length) return { situacao: "sem-viagem", texto: "Sem viagem registrada" };

    var tol = Number(db.params.regras.toleranciaUber) || 0;
    for (var i = 0; i < lista.length; i++) {
      var v = lista[i];
      if (!v.dataIda || !v.dataVolta) continue;
      if (diasEntre(addDias(v.dataIda, -tol), c.data) >= 0 && diasEntre(c.data, addDias(v.dataVolta, tol)) >= 0) {
        return { situacao: "ok", texto: "OK", viagemId: v.id };
      }
    }
    return { situacao: "fora", texto: "Fora do período" };
  }

  /**
   * Chave curta e estável da corrida, usada para guardar a validação. A linha
   * inteira é a chave do banco, mas é longa demais para virar nome de campo.
   */
  function chaveCorrida(linha) {
    var p = String(linha).split(";");
    return [p[0], p[1], p[2], p[3], p[9], p[10]].join("|").slice(0, 120);
  }

  /** O que fazer diante de cada motivo — aparece em "Pontos de atenção". */
  var COMENTARIO_MOTIVO = {
    "Nome fora do De-Para": "Cadastrar o vínculo em Ajustes para o custo cair na pessoa certa.",
    "Sem viagem registrada": "Lançar a viagem ou confirmar que é deslocamento urbano.",
    "Fora do período": "Conferir as datas da viagem ou ampliar a tolerância da auditoria.",
    "Sem data": "Encargo da fatura sem data no relatório — conferir na fatura do Uber.",
    "Origem igual ao destino": "Normalmente corrida cancelada após o embarque — cabe contestação.",
    "Acima de R$ 150": "Revisar necessidade, alternativa de transfer e possibilidade de carona."
  };

  /**
   * Tudo que pede atenção numa corrida, numa lista só. A tela mostra uma
   * legenda única ("Atenção") e detalha os motivos aqui embaixo.
   */
  function avisosDaCorrida(c, viagensPorPessoa) {
    var avisos = [];
    if (c.desconhecido) {
      avisos.push({ curto: "Nome fora do De-Para",
        texto: 'O relatório traz "' + c.nomeRelatorio + '", que não bate com nenhum colaborador. Cadastre o vínculo para a corrida entrar no custo da pessoa.' });
    }
    if (c.auditoria.situacao === "sem-viagem") {
      avisos.push({ curto: "Sem viagem registrada",
        texto: c.colaborador
          ? "Não existe viagem lançada para " + c.colaborador + " nessa data. Pode ser deslocamento urbano, ou a viagem ainda não foi lançada."
          : "Sem colaborador identificado, não dá para confrontar com viagem nenhuma." });
    }
    if (c.auditoria.situacao === "fora") {
      var lista = (viagensPorPessoa && viagensPorPessoa[c.colaborador]) || [];
      var perto = lista.filter(function (v) { return v.dataIda && v.dataVolta; })
        .map(function (v) { return "#" + v.id + " " + fmtData(v.dataIda) + " a " + fmtData(v.dataVolta); })
        .slice(0, 3).join(" · ");
      avisos.push({ curto: "Fora do período",
        texto: "A corrida é de " + fmtData(c.data) + " e não cai dentro de nenhuma viagem de " + c.colaborador + "." +
               (perto ? " Viagens da pessoa: " + perto + "." : "") });
    }
    if (c.auditoria.situacao === "sem-data" && c.considerar) {
      avisos.push({ curto: "Sem data",
        texto: "O relatório não traz data para esse lançamento" + (c.mesRef ? ", que foi atribuído a " + mesRotulo(c.mesRef) + " pelo lote em que veio." : ".") });
    }
    if (c.origem && c.origem === c.destino) {
      avisos.push({ curto: "Origem igual ao destino",
        texto: "Partida e chegada no mesmo endereço — normalmente corrida cancelada depois do embarque ou erro do app." });
    }
    // Traslado de aeroporto dentro do período da viagem é caro por natureza —
    // não vira ponto de atenção só por passar do teto.
    var trasladoLegitimo = c.aeroporto && c.auditoria.situacao === "ok";
    if (c.valor > 150 && !trasladoLegitimo) {
      avisos.push({ curto: "Acima de R$ 150",
        texto: "Corrida de " + moeda(c.valor) + ", acima do teto de R$ 150. Vale conferir se havia alternativa ou carona." });
    }
    return avisos;
  }

  /** Todas as corridas com seus campos derivados (memoizado até o próximo salvar). */
  function corridas() {
    if (cacheUber) return cacheUber;

    var porPessoa = {};
    db.viagens.forEach(function (v) {
      if (!porPessoa[v.colaborador]) porPessoa[v.colaborador] = [];
      porPessoa[v.colaborador].push(v);
    });

    cacheUber = db.uber.map(function (reg, i) {
      var c = parseLinhaUber(reg.linha);
      c.indice = i;
      c.chave = chaveCorrida(reg.linha);
      c.colaborador = resolveNome(c.nomeRelatorio);
      c.desconhecido = !!c.nomeRelatorio && !c.colaborador;
      c.area = c.colaborador ? areaDe(c.colaborador) : "—";
      c.mesRef = c.data ? mesRefDe(c.data) : "";
      c.aeroporto = ehAeroporto(c.origem, c.destino);
      c.considerar = c.tipo !== "Payment";      // pagamentos da fatura não são despesa nova
      c.viagem = null;
      c.auditoria = auditaCorrida(c, porPessoa);
      if (c.auditoria.viagemId) c.viagem = viagemPorId(c.auditoria.viagemId);
      return c;
    });

    // Encargos (multa de atraso, ajuste) vêm sem data no relatório. Para não
    // ficarem de fora do painel, herdam o mês do lançamento datado mais
    // próximo: a base guarda os relatórios na ordem em que foram importados.
    cacheUber.forEach(function (c, i) {
      if (c.mesRef || !c.considerar) return;
      for (var d = 1; d < cacheUber.length; d++) {
        var vizinho = (cacheUber[i - d] && cacheUber[i - d].mesRef) ? cacheUber[i - d]
                    : (cacheUber[i + d] && cacheUber[i + d].mesRef) ? cacheUber[i + d] : null;
        if (vizinho) { c.mesRef = vizinho.mesRef; c.mesEstimado = true; break; }
      }
    });

    var validadas = db.params.conferenciasUber || {};
    cacheUber.forEach(function (c) {
      c.avisos = avisosDaCorrida(c, porPessoa);
      c.assinatura = c.avisos.map(function (a) { return a.curto; }).join(" | ");
      var conf = validadas[c.chave];
      c.conferencia = conf && conf.assinatura === c.assinatura ? conf : null;
      c.conferido = !!(c.conferencia && c.avisos.length);
      // Lançamentos validados antes desse campo existir contam como devidos.
      c.devida = c.conferido ? c.conferencia.devida !== false : null;
      c.precisaConferir = c.avisos.length > 0 && !c.conferido;
      // Mantido para quem lia o campo antigo de alerta em texto.
      c.alerta = c.avisos.map(function (a) { return a.curto; }).join(" · ");
    });
    return cacheUber;
  }

  /**
   * Registra a validação de uma corrida sinalizada: se a despesa é devida,
   * a justificativa (obrigatória quando não é devida) e um comentário livre.
   * Sem `dados`, desfaz a validação.
   */
  function validarCorrida(chave, dados) {
    var c = corridaPorChave(chave);
    if (!c || !c.avisos.length) return Promise.resolve(null);

    if (!db.params.conferenciasUber) db.params.conferenciasUber = {};
    if (!dados) delete db.params.conferenciasUber[chave];
    else {
      var devida = dados.devida !== false;
      var justificativa = String(dados.justificativa || "").trim().slice(0, 300);
      if (!devida && !justificativa) return Promise.reject(new Error("Corrida não devida precisa de justificativa."));
      db.params.conferenciasUber[chave] = {
        por: dados.por || meta.nome || "",
        em: new Date().toISOString(),
        assinatura: c.assinatura,
        devida: devida,
        justificativa: justificativa,
        comentario: String(dados.comentario || "").trim().slice(0, 300)
      };
    }
    return salvarParams();
  }

  /** Importa linhas cruas do relatório, ignorando as que já estão na base. */
  function adicionarCorridas(linhas) {
    if (armazem.modo === "servidor") {
      return armazem.importarUber(linhas).then(function (estado) {
        aplica(estado);
        return estado.importacao || { novas: 0, repetidas: 0 };
      });
    }

    var existentes = {};
    db.uber.forEach(function (r) { existentes[r.linha] = 1; });
    var novas = 0, repetidas = 0;
    linhas.forEach(function (l) {
      l = l.trim();
      if (!l) return;
      if (existentes[l]) { repetidas++; return; }
      existentes[l] = 1;
      db.uber.push({ linha: l });
      novas++;
    });
    var resultado = { novas: novas, repetidas: repetidas };
    if (!novas) return Promise.resolve(resultado);
    return armazem.importarUber(linhas).then(aplica).then(function () { return resultado; });
  }

  function corridaPorChave(chave) {
    var achou = null;
    corridas().forEach(function (c) { if (c.chave === chave) achou = c; });
    return achou;
  }

  function excluirCorrida(indice) {
    var registro = db.uber[indice];
    if (!registro) return Promise.resolve();
    if (armazem.modo === "servidor") return armazem.excluirCorrida(registro.linha).then(aplica);
    db.uber.splice(indice, 1);
    return armazem.excluirCorrida(registro.linha).then(aplica);
  }

  function limparUber() {
    if (armazem.modo === "servidor") return armazem.limparUber().then(aplica);
    db.uber = [];
    return armazem.limparUber().then(aplica);
  }

  // ---------- agregações ----------

  var CATEGORIAS = ["Aéreo", "Hospedagem", "Alimentação", "Transporte/Aux.", "Alterações", "Uber Corporativo"];

  function categoriasDaViagem(v) {
    return {
      "Aéreo": Number(v.aereo) || 0,
      "Hospedagem": v.hospedagem,
      "Alimentação": Number(v.alimentacao) || 0,
      "Transporte/Aux.": Number(v.transporte) || 0,
      "Alterações": Number(v.custoAlteracao) || 0,
      "Uber Corporativo": 0
    };
  }

  /** Meses com movimento (viagens ou Uber), em ordem cronológica. */
  function mesesComDados() {
    var set = {};
    db.viagens.forEach(function (v) { var m = mesRefDe(v.dataIda); if (m) set[m] = 1; });
    corridas().forEach(function (c) { if (c.mesRef && c.considerar) set[c.mesRef] = 1; });
    return Object.keys(set).sort(function (a, b) {
      return (anoDe(a) + a.slice(0, 2)).localeCompare(anoDe(b) + b.slice(0, 2));
    });
  }

  function anosComDados() {
    var set = {};
    mesesComDados().forEach(function (m) { set[anoDe(m)] = 1; });
    var lista = Object.keys(set).sort();
    return lista.length ? lista : [String(new Date().getFullYear())];
  }

  /** Painel anual: matriz categoria × mês, área × mês e indicadores. */
  function resumoAnual(ano) {
    var meses = [];
    for (var m = 1; m <= 12; m++) meses.push(pad(m) + "/" + ano);

    var porCategoria = {}, porArea = {}, pessoasMes = {}, totalMes = {}, viagensMes = {}, custoViagensMes = {};
    CATEGORIAS.forEach(function (c) { porCategoria[c] = {}; meses.forEach(function (m) { porCategoria[c][m] = 0; }); });
    areas().forEach(function (a) { porArea[a] = {}; meses.forEach(function (m) { porArea[a][m] = 0; }); });
    meses.forEach(function (m) { totalMes[m] = 0; pessoasMes[m] = {}; viagensMes[m] = 0; custoViagensMes[m] = 0; });

    // `pessoas` = quem teve qualquer despesa (viagem ou Uber) — vale para o KPI.
    // `pessoasMes` e `pessoasViagem` contam só quem viajou: é o que a tabela
    // de composição mostra, e a média ali é por viagem, não por pessoa.
    var pessoas = {}, pessoasViagem = {}, nViagens = 0, noites = 0;

    viagens().forEach(function (v) {
      var m = v.mesRef;
      if (!m || anoDe(m) !== String(ano)) return;
      var cats = categoriasDaViagem(v);
      CATEGORIAS.forEach(function (c) {
        if (!cats[c]) return;
        porCategoria[c][m] += cats[c];
        totalMes[m] += cats[c];
      });
      if (porArea[v.area]) porArea[v.area][m] += v.total;
      else if (v.total) { porArea[v.area] = porArea[v.area] || {}; porArea[v.area][m] = (porArea[v.area][m] || 0) + v.total; }
      // Conta quem viajou, mesmo que ainda não tenha custo lançado.
      pessoas[v.colaborador] = 1;
      pessoasViagem[v.colaborador] = 1;
      pessoasMes[m][v.colaborador] = 1;
      custoViagensMes[m] += v.total;
      if (v.tipo !== "Alteração") { nViagens++; viagensMes[m]++; }
      noites += v.noitesEfetivas;
    });

    corridas().forEach(function (c) {
      if (!c.considerar || !c.mesRef || anoDe(c.mesRef) !== String(ano)) return;
      porCategoria["Uber Corporativo"][c.mesRef] += c.valor;
      totalMes[c.mesRef] += c.valor;
      if (porArea[c.area]) porArea[c.area][c.mesRef] += c.valor;
      if (c.colaborador) pessoas[c.colaborador] = 1;
    });

    var totalAno = 0;
    meses.forEach(function (m) { totalMes[m] = round2(totalMes[m]); totalAno += totalMes[m]; });

    var totalUber = 0;
    meses.forEach(function (m) { totalUber += porCategoria["Uber Corporativo"][m]; });

    return {
      ano: String(ano),
      meses: meses,
      categorias: CATEGORIAS,
      porCategoria: porCategoria,
      porArea: porArea,
      totalMes: totalMes,
      totalAno: round2(totalAno),
      totalUber: round2(totalUber),
      totalViagens: round2(totalAno - totalUber),
      pessoas: Object.keys(pessoas).length,
      pessoasViagem: Object.keys(pessoasViagem).length,
      pessoasMes: pessoasMes,
      viagensMes: viagensMes,
      custoViagensMes: custoViagensMes,
      nViagens: nViagens,
      noites: noites
    };
  }

  /** Uma linha por colaborador com despesa no ano. */
  function porColaborador(ano) {
    var mapa = {};
    function linha(nome) {
      if (!mapa[nome]) {
        mapa[nome] = { nome: nome, area: areaDe(nome), aereo: 0, hospedagem: 0, alimentacao: 0,
                       transporte: 0, alteracoes: 0, uber: 0, total: 0, viagens: 0, noites: 0 };
      }
      return mapa[nome];
    }
    viagens().forEach(function (v) {
      if (anoDe(v.mesRef) !== String(ano)) return;
      var l = linha(v.colaborador);
      l.aereo += Number(v.aereo) || 0;
      l.hospedagem += v.hospedagem;
      l.alimentacao += Number(v.alimentacao) || 0;
      l.transporte += Number(v.transporte) || 0;
      l.alteracoes += Number(v.custoAlteracao) || 0;
      l.total += v.total;
      l.noites += v.noitesEfetivas;
      if (v.tipo !== "Alteração") l.viagens++;
    });
    corridas().forEach(function (c) {
      if (!c.considerar || !c.colaborador || anoDe(c.mesRef) !== String(ano)) return;
      var l = linha(c.colaborador);
      l.uber += c.valor;
      l.total += c.valor;
    });
    return Object.keys(mapa).map(function (k) {
      var l = mapa[k];
      ["aereo", "hospedagem", "alimentacao", "transporte", "alteracoes", "uber", "total"].forEach(function (c) {
        l[c] = round2(l[c]);
      });
      return l;
    }).sort(function (a, b) { return b.total - a.total; });
  }

  /**
   * Indicadores da aba Análise Uber.
   * Contagem de "corridas" considera só transações do tipo Fare — gorjeta, multa e
   * estorno entram no valor, mas não são uma corrida a mais (mesma convenção da planilha).
   */
  /** Uma corrida validada como devida está resolvida: sai dos pontos de atenção. */
  function emAberto(c) { return !(c.conferido && c.devida); }

  function resumoUber(ano) {
    var lista = corridas().filter(function (c) {
      return c.considerar && (!ano || !c.mesRef || anoDe(c.mesRef) === String(ano));
    });
    var comData = lista.filter(function (c) { return c.data; });
    var total = 0, aeroporto = 0, maiorValor = 0, acima150 = 0, valorAcima150 = 0, nCorridas = 0;
    var porMes = {}, porServico = {}, porCidade = {}, porArea = {}, porPessoa = {};
    var gorjetas = 0, multas = 0, ajustes = 0;
    var nGorjetas = 0, nMultas = 0, nAjustes = 0;

    lista.forEach(function (c) {
      var corrida = c.tipo === "Fare";
      total += c.valor;
      if (corrida) {
        nCorridas++;
        if (c.aeroporto) aeroporto++;
        if (c.valor > maiorValor) maiorValor = c.valor;
        if (c.valor > 150) { acima150++; valorAcima150 += c.valor; }
      }
      if (c.tipo === "Tip") { gorjetas += c.valor; nGorjetas++; }
      if (c.tipo === "Late Payment Fee") { multas += c.valor; nMultas++; }
      if (c.tipo === "Adjustment") { ajustes += c.valor; nAjustes++; }
      if (c.mesRef) {
        porMes[c.mesRef] = porMes[c.mesRef] || { n: 0, valor: 0, aeroporto: 0, indevidas: 0, nIndevidas: 0 };
        porMes[c.mesRef].valor += c.valor;
        if (corrida) {
          porMes[c.mesRef].n++;
          if (c.aeroporto) porMes[c.mesRef].aeroporto++;
        }
        if (c.conferido && !c.devida) {
          porMes[c.mesRef].indevidas += c.valor;
          porMes[c.mesRef].nIndevidas++;
        }
      }
      if (c.servico) {
        porServico[c.servico] = porServico[c.servico] || { n: 0, valor: 0 };
        porServico[c.servico].valor += c.valor;
        if (corrida) porServico[c.servico].n++;
      }
      if (c.cidade) {
        porCidade[c.cidade] = porCidade[c.cidade] || { n: 0, valor: 0 };
        porCidade[c.cidade].n++; porCidade[c.cidade].valor += c.valor;
      }
      if (c.colaborador) {
        porPessoa[c.colaborador] = porPessoa[c.colaborador] || { n: 0, valor: 0, area: c.area };
        porPessoa[c.colaborador].valor += c.valor;
        if (corrida) porPessoa[c.colaborador].n++;
      }
      var area = c.colaborador ? (c.area || "Sem área") : "Encargos da fatura";
      porArea[area] = porArea[area] || { n: 0, valor: 0, aeroporto: 0, pessoas: {}, atencao: 0 };
      porArea[area].valor += c.valor;
      if (corrida) {
        porArea[area].n++;
        if (c.aeroporto) porArea[area].aeroporto++;
        if (c.colaborador) porArea[area].pessoas[c.colaborador] = 1;
        if (c.precisaConferir) porArea[area].atencao++;
      }
    });

    function ordenaArea(obj) {
      return Object.keys(obj).map(function (k) {
        var a = obj[k];
        return { nome: k, n: a.n, valor: round2(a.valor), aeroporto: a.aeroporto,
                 pessoas: Object.keys(a.pessoas).length, atencao: a.atencao,
                 ticket: a.n ? round2(a.valor / a.n) : 0 };
      }).sort(function (a, b) { return b.valor - a.valor; });
    }

    function ordena(obj) {
      return Object.keys(obj).map(function (k) {
        return { nome: k, n: obj[k].n, valor: round2(obj[k].valor), aeroporto: obj[k].aeroporto || 0 };
      }).sort(function (a, b) { return b.valor - a.valor; });
    }

    var alertas = corridas().filter(function (c) { return c.precisaConferir; });
    var validadas = corridas().filter(function (c) { return c.conferido; });

    // Cada motivo apontado pela auditoria, com quantas vezes apareceu e quanto
    // custou. Uma corrida com dois motivos entra nos dois — a soma das linhas
    // não é o total da base, e a tela diz isso. O que já foi validado como
    // despesa devida sai da conta: o motivo foi analisado e resolvido.
    var motivos = {};
    lista.filter(emAberto).forEach(function (c) {
      c.avisos.forEach(function (a) {
        motivos[a.curto] = motivos[a.curto] || { motivo: a.curto, n: 0, valor: 0, comentario: COMENTARIO_MOTIVO[a.curto] || "" };
        motivos[a.curto].n++;
        motivos[a.curto].valor += c.valor;
      });
    });
    var porMotivo = Object.keys(motivos).map(function (k) {
      motivos[k].valor = round2(motivos[k].valor);
      return motivos[k];
    }).sort(function (a, b) { return b.valor - a.valor || b.n - a.n; });
    var desconhecidos = {};
    corridas().forEach(function (c) { if (c.desconhecido) desconhecidos[c.nomeRelatorio] = (desconhecidos[c.nomeRelatorio] || 0) + 1; });

    return {
      n: nCorridas,
      lancamentos: lista.length,
      total: round2(total),
      ticket: nCorridas ? round2(total / nCorridas) : 0,
      aeroporto: aeroporto,
      pctAeroporto: nCorridas ? aeroporto / nCorridas : 0,
      maiorValor: round2(maiorValor),
      acima150: acima150,
      valorAcima150: round2(valorAcima150),
      gorjetas: round2(gorjetas),
      multas: round2(multas),
      ajustes: round2(ajustes),
      nGorjetas: nGorjetas,
      nMultas: nMultas,
      nAjustes: nAjustes,
      urbanas: lista.filter(function (c) { return c.tipo === "Fare" && !c.aeroporto && emAberto(c); }).length,
      valorUrbanas: round2(lista.reduce(function (t, c) {
        return c.tipo === "Fare" && !c.aeroporto && emAberto(c) ? t + c.valor : t;
      }, 0)),
      porMes: porMes,
      porServico: ordena(porServico),
      porCidade: ordena(porCidade),
      alertas: alertas,
      validadas: validadas.length,
      naoDevidas: validadas.filter(function (c) { return !c.devida; }).length,
      valorNaoDevidas: round2(validadas.reduce(function (t, c) { return c.devida ? t : t + c.valor; }, 0)),
      indevidas: lista.filter(function (c) { return c.conferido && !c.devida; })
        .sort(function (a, b) { return (b.data || "").localeCompare(a.data || ""); }),
      porMotivo: porMotivo,
      porArea: ordenaArea(porArea),
      porPessoa: Object.keys(porPessoa).map(function (k) {
        return { nome: k, area: porPessoa[k].area, n: porPessoa[k].n, valor: round2(porPessoa[k].valor) };
      }).sort(function (a, b) { return b.valor - a.valor; }),
      desconhecidos: Object.keys(desconhecidos).map(function (k) { return { nome: k, n: desconhecidos[k] }; }),
      periodo: comData.length
        ? { de: comData.map(function (c) { return c.data; }).sort()[0],
            ate: comData.map(function (c) { return c.data; }).sort().slice(-1)[0] }
        : null
    };
  }

  /** Ocupação diária de um mês: uma linha por colaborador em viagem. */
  function calendario(mesRef) {
    var p = String(mesRef).split("/");
    var mes = +p[0], ano = +p[1];
    var nDias = new Date(ano, mes, 0).getDate();
    var linhas = {};

    viagens().forEach(function (v) {
      if (!v.dataIda || !v.dataVolta || v.cancelada) return;
      for (var d = 1; d <= nDias; d++) {
        var iso = ano + "-" + pad(mes) + "-" + pad(d);
        if (diasEntre(v.dataIda, iso) < 0 || diasEntre(iso, v.dataVolta) < 0) continue;
        if (!linhas[v.colaborador]) {
          linhas[v.colaborador] = { nome: v.colaborador, area: v.area, dias: {}, destino: v.destino };
        }
        var marca = iso === v.dataIda ? "go" : (iso === v.dataVolta ? "back" : "stay");
        // Ida e volta no mesmo dia (viagens encadeadas) mantêm a marca de ida.
        if (!linhas[v.colaborador].dias[d] || linhas[v.colaborador].dias[d] === "stay") {
          linhas[v.colaborador].dias[d] = marca;
        }
      }
    });

    return {
      mesRef: mesRef, nDias: nDias, ano: ano, mes: mes,
      linhas: Object.keys(linhas).sort(ordenaPt).map(function (k) { return linhas[k]; })
    };
  }

  // ---------- exportação ----------

  function csvViagens() {
    var cab = ["ID", "Tipo", "Mês ref.", "Colaborador", "Área", "Gestor direto", "Destino",
               "Aeroporto origem", "Data ida", "Data volta", "Noites", "Aéreo (R$)",
               "Hospedagem (R$)", "Hospedagem por noite (R$)", "Alimentação (R$)", "Transporte/Aux. (R$)",
               "Custo de alteração (R$)", "TOTAL (R$)", "Alimentação devida (regra)", "Diferença alim.",
               "Conferência", "Status", "Tipo de alteração", "Ref. ID alterado", "Motivo da alteração",
               "Pendências em aberto", "Observação"];
    var linhas = viagens().sort(function (a, b) { return a.id - b.id; }).map(function (v) {
      return [v.id, v.tipo, v.mesRef, v.colaborador, v.area, v.gestor, v.destino, v.aeroportoOrigem,
              fmtData(v.dataIda), fmtData(v.dataVolta), v.noites, v.aereo,
              v.hospedagem, v.porNoite, v.alimentacao, v.transporte, v.custoAlteracao, v.total, v.alimDevida,
              v.difAlim,
              v.ok ? "OK" : (v.conferido ? "Conferido: " : "") + v.avisos.map(function (a) { return a.texto; }).join(" · "),
              v.status, v.tipoAlteracao || "", v.refId || "", v.motivo, v.pendencias, v.obs];
    });
    return montaCSV(cab, linhas);
  }

  function csvUber() {
    var cab = ["Data", "Mês ref.", "Hora", "Nome no relatório", "Colaborador", "Área", "Serviço",
               "Cidade", "Origem", "Destino", "Tipo de transação", "Valor (R$)", "Aeroporto?",
               "Considerar", "Auditoria", "Alerta"];
    var linhas = corridas().map(function (c) {
      return [fmtData(c.data), c.mesRef, c.hora, c.nomeRelatorio, c.colaborador || "⚠ incluir no De-Para",
              c.area, c.servico, c.cidade, c.origem, c.destino, c.tipo, c.valor,
              c.aeroporto ? "Sim" : "Não", c.considerar ? "Sim" : "Não", c.auditoria.texto, c.alerta];
    });
    return montaCSV(cab, linhas);
  }

  function csvColaborador(ano) {
    var cab = ["Colaborador", "Área", "Viagens", "Pernoites", "Aéreo", "Hospedagem", "Alimentação",
               "Transporte/Aux.", "Alterações", "Uber", "TOTAL"];
    var linhas = porColaborador(ano).map(function (l) {
      return [l.nome, l.area, l.viagens, l.noites, l.aereo, l.hospedagem, l.alimentacao,
              l.transporte, l.alteracoes, l.uber, l.total];
    });
    return montaCSV(cab, linhas);
  }

  /** CSV com ; e vírgula decimal — abre direto no Excel em português. */
  function montaCSV(cabecalho, linhas) {
    function celula(v) {
      if (v === null || v === undefined) return "";
      if (typeof v === "number") return String(v).replace(".", ",");
      var s = String(v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    return [cabecalho.join(";")]
      .concat(linhas.map(function (l) { return l.map(celula).join(";"); }))
      .join("\r\n");
  }

  // ---------- API ----------

  window.Core = {
    // estado
    iniciar: iniciar, entrar: entrar, sair: sair, aoMudar: aoMudar,
    recarregar: recarregar, revisaoRemota: revisaoRemota,
    ehAdmin: ehAdmin, trocarPropriaSenha: trocarPropriaSenha,
    salvarUsuario: salvarUsuario, excluirUsuario: excluirUsuario,
    redefinirSenha: redefinirSenha, historico: historico, senhaSugerida: senhaSugerida,
    get usuarios() { return usuarios; },
    restaurarBase: restaurarBase, substituirEstado: substituirEstado, salvarParams: salvarParams,
    get equipeAtualizada() { return equipeAtualizada; },
    get meta() { return meta; },
    get modo() { return armazem ? armazem.modo : "local"; },
    get db() { return db; },

    // formatação
    brl: brl, moeda: moeda, brlSigla: brlSigla, brlCurto: brlCurto, parseNum: parseNum, round2: round2,
    fmtData: fmtData, fmtDataCurta: fmtDataCurta, mesRefDe: mesRefDe, mesRotulo: mesRotulo,
    mesNome: mesNome, anoDe: anoDe, iniciais: iniciais, normal: normal, ordenaPt: ordenaPt,
    diasEntre: diasEntre, addDias: addDias, toISO: toISO, toDate: toDate, pad: pad,

    // colaboradores
    colaborador: colaborador, areaDe: areaDe, gestorDe: gestorDe, areas: areas,
    colaboradoresOrdenados: colaboradoresOrdenados,
    salvarColaborador: salvarColaborador, excluirColaborador: excluirColaborador,

    // viagens
    calc: calc, viagens: viagens, viagemPorId: viagemPorId, viagemCompleta: viagemCompleta,
    viagemVazia: viagemVazia, salvarViagem: salvarViagem, excluirViagem: excluirViagem,
    duplicarViagem: duplicarViagem, alteracoesDe: alteracoesDe, porPernoite: porPernoite,
    validarConferencia: validarConferencia, cancelarViagem: cancelarViagem,
    TIPOS_ALTERACAO: TIPOS_ALTERACAO, tipoAlteracao: tipoAlteracao,
    proximoId: proximoId,

    // uber
    corridas: corridas, parseLinhaUber: parseLinhaUber, adicionarCorridas: adicionarCorridas,
    excluirCorrida: excluirCorrida, limparUber: limparUber, resolveNome: resolveNome,
    validarCorrida: validarCorrida, corridaPorChave: corridaPorChave,

    // análises
    CATEGORIAS: CATEGORIAS, resumoAnual: resumoAnual, porColaborador: porColaborador,
    resumoUber: resumoUber, calendario: calendario, mesesComDados: mesesComDados, anosComDados: anosComDados,

    // exportação
    csvViagens: csvViagens, csvUber: csvUber, csvColaborador: csvColaborador
  };
})();

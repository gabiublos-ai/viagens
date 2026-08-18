/* Aplicação: navegação, formulários e ações. */

(function () {
  "use strict";

  var C = window.Core, V = window.Views;
  var esc = V.esc;

  var estado = {
    aba: "painel",
    ano: null,
    mesCal: null,
    filtros: { busca: "", mes: "", area: "", status: "", tipo: "", avisos: false, ordem: "data-desc" },
    uberFiltros: { busca: "", mes: "", situacao: "" },
    equipeFiltros: { busca: "", area: "" },
    custoOrdem: { campo: "total", desc: true }
  };

  var ABAS = [
    { id: "painel", rotulo: "Painel" },
    { id: "viagens", rotulo: "Viagens" },
    { id: "calendario", rotulo: "Calendário" },
    { id: "uber", rotulo: "Uber" },
    { id: "equipe", rotulo: "Equipe" },
    { id: "ajustes", rotulo: "Ajustes" }
  ];

  var $view, $tabs, $anoSel;

  // ---------- inicialização ----------

  function iniciar() {
    $view = document.getElementById("view");
    $tabs = document.getElementById("tabs");
    $anoSel = document.getElementById("ano");

    aplicaTema(localStorage.getItem("gvc.tema") || "auto");

    document.addEventListener("click", aoClicar);
    document.addEventListener("change", aoMudarCampo);
    document.addEventListener("input", aoDigitar);
    document.addEventListener("mouseover", aoPassarMouse);
    document.addEventListener("mouseout", escondeTip);

    C.iniciar().then(function (r) {
      if (!r.autenticado) { telaDeEntrada(); return; }
      montar();
    }, function (e) {
      telaDeEntrada(e.message || "Não consegui falar com o servidor.");
    });
  }

  /** Liga a aplicação depois que a base está na mão. */
  function montar() {
    document.body.classList.remove("trancado");
    estado.ano = C.anosComDados().slice(-1)[0];

    $tabs.innerHTML = ABAS.map(function (a) {
      return '<button class="tab" role="tab" data-aba="' + a.id + '" aria-selected="false">' + a.rotulo + "</button>";
    }).join("");

    atualizaAnos();
    C.aoMudar(function () { atualizaAnos(); render(); });

    var hash = (location.hash || "").replace("#", "");
    if (ABAS.some(function (a) { return a.id === hash; })) estado.aba = hash;

    render();
    mostraQuemEstaDentro();

    if (C.equipeAtualizada) {
      toast("Base de equipe atualizada: " + C.equipeAtualizada + " cadastros · " +
            C.db.colaboradores.length + " pessoas");
    }
    if (C.modo === "servidor") vigiarMudancas();
  }

  // ---------- entrada com senha ----------

  function telaDeEntrada(mensagem) {
    document.body.classList.add("trancado");
    document.getElementById("view").innerHTML =
      '<form class="entrada" id="form-entrada">' +
      '<div class="entrada-marca" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M17.8 19.2 16 11l3.5-3.5a2.1 2.1 0 0 0-3-3L13 8 4.8 6.2a.5.5 0 0 0-.5.8l3.4 3.9-2 2-2.2-.6a.5.5 0 0 0-.5.8L5 15.5 6.4 18l1.4-1.5.6 2.2a.5.5 0 0 0 .8.2l2-2 3.9 3.4a.5.5 0 0 0 .8-.5Z"/></svg></div>' +
      "<h1>Gestão de Viagens</h1>" +
      '<p class="entrada-sub">Ace Gaming · apostou.bet.br</p>' +
      '<div class="field"><label for="e-nome">Seu nome</label>' +
      '<input type="text" id="e-nome" name="nome" autocomplete="name" placeholder="Como aparecer nas alterações" ' +
      'value="' + esc(localStorage.getItem("gvc.nome") || "") + '"></div>' +
      '<div class="field"><label for="e-senha">Senha de acesso</label>' +
      '<input type="password" id="e-senha" name="senha" autocomplete="current-password" required></div>' +
      '<button class="btn btn-primary" type="submit">Entrar</button>' +
      '<p class="entrada-erro" data-erro>' + esc(mensagem || "") + "</p>" +
      "</form>";

    var form = document.getElementById("form-entrada");
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var fd = new FormData(form);
      var botao = form.querySelector("button");
      var aviso = form.querySelector("[data-erro]");
      botao.disabled = true;
      botao.textContent = "Entrando…";
      aviso.textContent = "";

      C.entrar(fd.get("senha"), (fd.get("nome") || "").trim()).then(function () {
        localStorage.setItem("gvc.nome", (fd.get("nome") || "").trim());
        montar();
      }, function (e) {
        botao.disabled = false;
        botao.textContent = "Entrar";
        aviso.textContent = e.message || "Não consegui entrar.";
        form.querySelector('[name="senha"]').select();
      });
    });
    form.querySelector((localStorage.getItem("gvc.nome") ? '[name="senha"]' : '[name="nome"]')).focus();
  }

  function mostraQuemEstaDentro() {
    var alvo = document.getElementById("sessao");
    if (!alvo) return;
    if (C.modo !== "servidor") { alvo.hidden = true; return; }
    alvo.hidden = false;
    var nome = C.meta.nome || localStorage.getItem("gvc.nome") || "";
    alvo.innerHTML =
      (nome ? '<span class="chip accent" title="Sessão aberta">' + esc(nome) + "</span>" : "") +
      '<button class="btn btn-ghost btn-sm" data-acao="sair">Sair</button>';
  }

  // ---------- sincronização entre pessoas ----------

  var vigiando = false;

  function vigiarMudancas() {
    if (vigiando) return;
    vigiando = true;

    function conferir() {
      if (document.hidden || document.querySelector("dialog[open]")) return;
      C.revisaoRemota().then(function (r) {
        if (!r || r.revisao === C.meta.revisao) return;
        var quem = r.atualizadoPor;
        C.recarregar().then(function () {
          toast(quem ? "Base atualizada por " + quem : "Base atualizada");
        });
      }, function () { /* sem rede agora; tenta de novo no próximo ciclo */ });
    }

    setInterval(conferir, 20000);
    window.addEventListener("focus", conferir);
  }

  function atualizaAnos() {
    var anos = C.anosComDados();
    if (anos.indexOf(estado.ano) === -1) estado.ano = anos[anos.length - 1];
    $anoSel.innerHTML = anos.map(function (a) {
      return '<option value="' + a + '"' + (a === estado.ano ? " selected" : "") + ">" + a + "</option>";
    }).join("");
  }

  function render() {
    Array.prototype.forEach.call($tabs.children, function (b) {
      b.setAttribute("aria-selected", b.dataset.aba === estado.aba ? "true" : "false");
    });
    location.hash = estado.aba;

    var conteudo = "";
    switch (estado.aba) {
      case "viagens": conteudo = V.viagens(estado); break;
      case "calendario": conteudo = V.calendario(estado); break;
      case "uber": conteudo = V.uber(estado); break;
      case "equipe": conteudo = V.equipe(estado); break;
      case "ajustes": conteudo = V.ajustes(estado); break;
      default: conteudo = V.painel(estado);
    }
    $view.innerHTML = conteudo;
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  }

  function irPara(aba) { estado.aba = aba; render(); }

  // ---------- eventos ----------

  function aoClicar(ev) {
    var tab = ev.target.closest("[data-aba]");
    if (tab) { irPara(tab.dataset.aba); return; }

    var atalho = ev.target.closest("[data-ir]");
    if (atalho) {
      ev.preventDefault();
      if (atalho.dataset.filtro === "avisos") estado.filtros.avisos = true;
      irPara(atalho.dataset.ir);
      return;
    }

    var coluna = ev.target.closest("[data-ordenar]");
    if (coluna) {
      var campo = coluna.dataset.ordenar;
      var atual = estado.custoOrdem || { campo: "total", desc: true };
      // Mesmo título: inverte. Título novo: começa do maior para o menor.
      estado.custoOrdem = { campo: campo, desc: atual.campo === campo ? !atual.desc : true };
      render();
      return;
    }

    var botao = ev.target.closest("[data-acao]");
    if (!botao) return;
    var acao = botao.dataset.acao;
    var id = botao.dataset.id;

    switch (acao) {
      case "nova-viagem": abrirViagem(null); break;
      case "nova-viagem-para": abrirViagem(null, { colaborador: botao.dataset.nome }); break;
      case "editar": abrirViagem(C.viagemPorId(id)); break;
      case "duplicar":
        C.duplicarViagem(id).then(function (novo) {
          if (novo) { toast("Viagem duplicada como #" + novo.id); abrirViagem(novo); }
        }, falhou);
        break;
      case "alteracao": abrirAlteracao(C.viagemPorId(id)); break;
      case "registrar-alteracao": escolherViagemParaAlterar(); break;
      case "validar":
      case "desvalidar":
        C.validarConferencia(id).then(function () {
          toast(acao === "validar" ? "Conferência validada — sai dos alertas" : "Conferência desfeita");
        }, falhou);
        break;
      case "excluir": excluirViagem(id); break;
      case "excluir-corrida":
        if (confirm("Excluir esta corrida da base do Uber?")) {
          C.excluirCorrida(Number(id)).then(function () { toast("Corrida excluída"); }, falhou);
        }
        break;
      case "importar-uber": importarUber(); break;
      case "limpar-uber":
        if (confirm("Remover todas as " + C.corridas().length + " corridas da base do Uber?")) {
          C.limparUber().then(function () { toast("Base do Uber limpa"); }, falhou);
        }
        break;
      case "mapear": abrirDePara(botao.dataset.nome || ""); break;
      case "excluir-depara":
        C.db.params.dePara.splice(Number(id), 1);
        C.salvarParams().then(function () { toast("Vínculo removido"); }, falhou);
        break;
      case "novo-colaborador": abrirColaborador(null); break;
      case "editar-colaborador": abrirColaborador(C.colaborador(botao.dataset.nome)); break;
      case "salvar-regras": salvarRegras(); break;
      case "limpar-filtros":
        estado.filtros = { busca: "", mes: "", area: "", status: "", tipo: "", avisos: false, ordem: estado.filtros.ordem };
        render(); break;
      case "exportar-viagens": baixar("viagens.csv", C.csvViagens(), "text/csv"); break;
      case "importar-viagens": abrirImportacao(); break;
      case "baixar-modelo": baixarModelo(); break;
      case "exportar-uber": baixar("uber.csv", C.csvUber(), "text/csv"); break;
      case "exportar-colaborador": baixar("por-colaborador-" + estado.ano + ".csv", C.csvColaborador(estado.ano), "text/csv"); break;
      case "backup-baixar": baixar("backup-viagens-" + hoje() + ".json", JSON.stringify(C.db, null, 1), "application/json"); break;
      case "backup-copiar": copiar(JSON.stringify(C.db)); break;
      case "backup-restaurar": abrirRestaurar(); break;
      case "restaurar-base":
        if (confirm("Isso descarta tudo que foi lançado aqui e volta à base original da planilha. Continuar?")) {
          C.restaurarBase().then(function () { toast("Base original restaurada"); }, falhou);
        }
        break;
      case "sair":
        C.sair().then(function () { location.reload(); });
        break;
      case "tema": alternarTema(); break;
      case "usar-regra": aplicarRegraAlimentacao(botao.closest("form")); break;
      case "fechar": botao.closest("dialog").close(); break;
    }
  }

  function aoMudarCampo(ev) {
    var alvo = ev.target;
    if (alvo.id === "ano") { estado.ano = alvo.value; render(); return; }
    if (alvo.name === "mesCal") { estado.mesCal = alvo.value; render(); return; }

    var mapa = {
      mes: ["filtros", "mes"], area: ["filtros", "area"], status: ["filtros", "status"],
      tipo: ["filtros", "tipo"], ordem: ["filtros", "ordem"],
      "mes-uber": ["uberFiltros", "mes"], "situacao-uber": ["uberFiltros", "situacao"],
      "area-equipe": ["equipeFiltros", "area"]
    };
    if (mapa[alvo.name]) {
      estado[mapa[alvo.name][0]][mapa[alvo.name][1]] = alvo.value;
      render(); return;
    }
    if (alvo.name === "avisos") { estado.filtros.avisos = alvo.checked; render(); return; }

    if (alvo.closest && alvo.closest("#form-viagem")) recalcular(alvo.closest("form"), alvo);
  }

  var timerBusca;
  function aoDigitar(ev) {
    var alvo = ev.target;
    var buscas = { busca: "filtros", "busca-uber": "uberFiltros", "busca-equipe": "equipeFiltros" };
    if (buscas[alvo.name]) {
      var texto = alvo.value;
      var chave = buscas[alvo.name];
      clearTimeout(timerBusca);
      timerBusca = setTimeout(function () {
        estado[chave].busca = texto;
        render();
        var campo = document.querySelector('[name="' + alvo.name + '"]');
        if (campo) { campo.focus(); campo.setSelectionRange(campo.value.length, campo.value.length); }
      }, 220);
      return;
    }
    if (alvo.closest && alvo.closest("#form-viagem")) recalcular(alvo.closest("form"), alvo);
  }

  // ---------- formulário de viagem ----------

  var CAMPOS_MOEDA = ["aereo", "hospedagem", "alimentacao", "transporte", "custoAlteracao"];

  function abrirViagem(viagem, pre) {
    var novo = !viagem;
    var v = viagem ? Object.assign({}, viagem) : C.viagemVazia();
    if (pre) Object.assign(v, pre);
    if (novo && !v.dataIda) v.dataIda = "";
    // Lançamento antigo guardava diárias × valor; o campo agora é o total.
    var inicial = { hospedagem: C.calc(v).hospedagem };

    var ehAlteracao = v.tipo === "Alteração";
    var colabs = C.colaboradoresOrdenados();
    var destinos = destinosConhecidos();

    var corpo =
      (novo ? '<label class="chip accent" style="cursor:pointer;gap:7px;margin-bottom:14px">' +
        '<input type="checkbox" name="lote" style="width:auto"> Lançar para vários colaboradores</label>' : "") +
      '<div class="form-grid">' +

      '<div class="field c6" data-bloco="pessoa"><label>Colaborador</label>' +
      V.selectHTML("colaborador", [{ v: "", r: "Selecione…" }].concat(colabs.map(function (c) {
        return { v: c.nome, r: c.nome + " · " + c.area };
      })), v.colaborador, 'required') +
      '<span class="hint" data-info="pessoa"></span></div>' +

      '<div class="field c6" data-bloco="lote" hidden><label>Colaboradores</label>' +
      '<input type="search" name="filtro-lote" placeholder="Filtrar pela lista…" style="margin-bottom:6px">' +
      '<div class="picker" data-lista-lote>' + colabs.map(function (c) {
        return '<label data-nome="' + esc(C.normal(c.nome + " " + c.area)) + '"><input type="checkbox" name="lote-nome" value="' +
          esc(c.nome) + '"> ' + esc(c.nome) + '<span class="p-area">' + esc(c.area) + "</span></label>";
      }).join("") + "</div>" +
      '<span class="hint">Mesmo destino e mesmas datas para todos. Uma linha por pessoa.</span></div>' +

      V.campo("Destino", '<input type="text" name="destino" list="destinos" value="' + esc(v.destino) + '" required>', "c3") +
      V.campo("Aeroporto de origem",
              '<input type="text" name="aeroportoOrigem" list="aeroportos" autocomplete="off" value="' +
              esc(v.aeroportoOrigem) + '" placeholder="Selecione ou digite">', "c3") +

      '<div class="section-label"><span class="eyebrow">Período</span></div>' +
      V.campo("Data de ida", '<input type="date" name="dataIda" value="' + esc(v.dataIda) + '" required>', "c3") +
      V.campo("Data de volta", '<input type="date" name="dataVolta" value="' + esc(v.dataVolta) + '" required>', "c3") +
      '<div class="field c3"><label>Noites</label><input type="text" name="noites" readonly value="0"></div>' +
      V.campo("Status", V.selectHTML("status", C.db.params.statuses, v.status), "c3") +

      '<div class="section-label"><span class="eyebrow">Custos</span></div>' +
      V.campo("Aéreo (R$)", '<input type="text" class="money" name="aereo" value="' + C.brl(v.aereo) + '">', "c3") +

      '<div class="field c3"><label>Hospedagem — total (R$)</label>' +
      '<input type="text" class="money" name="hospedagem" value="' + C.brl(inicial.hospedagem) + '">' +
      '<span class="hint" data-info="hospedagem"></span></div>' +

      '<div class="field c3"><label>Alimentação (R$)</label>' +
      '<input type="text" class="money" name="alimentacao" value="' + C.brl(v.alimentacao) + '">' +
      '<span class="hint"><button type="button" class="btn btn-ghost btn-sm" data-acao="usar-regra" style="padding:0">usar a regra</button> ' +
      "<span data-info='regra'></span></span></div>" +
      V.campo("Transporte / Auxílio (R$)", '<input type="text" class="money" name="transporte" value="' + C.brl(v.transporte) + '">', "c3") +

      (ehAlteracao ?
        V.campo("Custo da alteração (R$)", '<input type="text" class="money" name="custoAlteracao" value="' + C.brl(v.custoAlteracao) + '">', "c3") +
        V.campo("Viagem original", '<input type="text" readonly value="#' + esc(v.refId || "") + '">', "c3") +
        '<div class="section-label"><span class="eyebrow">O que aconteceu</span></div>' +
        V.campo("Tipo de alteração",
                V.selectHTML("tipoAlteracao", C.TIPOS_ALTERACAO.map(function (t) { return t.v; }),
                             v.tipoAlteracao || C.TIPOS_ALTERACAO[0].v), "c4",
                "Cancelamento e no-show marcam a viagem original como Cancelada.") +
        V.campo("Motivo / detalhe", '<input type="text" name="motivo" value="' + esc(v.motivo) + '" placeholder="Remarcação do retorno de 21/08 para 28/08">', "c8") +
        V.campo("Pendências em aberto", '<input type="text" name="pendencias" value="' + esc(v.pendencias) + '" placeholder="Hospedagem + Alimentação">', "c12",
                "Deixe vazio quando tudo estiver contratado — o aviso some sozinho.")
        : "") +

      V.campo("Observação", '<textarea name="obs" rows="2">' + esc(v.obs) + "</textarea>", "c12") +
      "</div>" +

      '<div class="summary" style="margin-top:16px" data-resumo></div>' +
      '<datalist id="destinos">' + destinos.map(function (d) { return '<option value="' + esc(d) + '">'; }).join("") + "</datalist>" +
      '<datalist id="aeroportos">' + window.BR.opcoesAeroporto() + "</datalist>";

    var dialogo = abrirModal({
      titulo: novo ? "Nova viagem" : (ehAlteracao ? "Alteração da viagem #" + v.refId : "Viagem #" + v.id),
      corpo: '<form id="form-viagem" method="dialog">' + corpo + "</form>",
      rodape:
        '<span class="grow t-sub" data-status-form></span>' +
        '<button class="btn" data-acao="fechar">Cancelar</button>' +
        (novo ? '<button class="btn" type="submit" form="form-viagem" name="acao" value="novo">Salvar e lançar outra</button>' : "") +
        '<button class="btn btn-primary" type="submit" form="form-viagem" name="acao" value="fechar">Salvar</button>'
    });

    var form = dialogo.querySelector("form");
    form.dataset.id = v.id || "";
    form.dataset.tipo = v.tipo;
    form.dataset.refid = v.refId || "";
    if (!novo || v.alimentacao) form.dataset.alimTocada = "1";

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      salvarFormulario(form, (ev.submitter && ev.submitter.value) === "novo", dialogo);
    });

    form.querySelectorAll('[name="lote-nome"]').forEach(function (chk) {
      chk.addEventListener("change", function () { recalcular(form); });
    });

    // Filtro do seletor em lote
    var filtroLote = form.querySelector('[name="filtro-lote"]');
    if (filtroLote) {
      filtroLote.addEventListener("input", function () {
        var q = C.normal(filtroLote.value);
        form.querySelectorAll("[data-lista-lote] label").forEach(function (l) {
          l.hidden = q && l.dataset.nome.indexOf(q) === -1;
        });
      });
    }

    recalcular(form);
    var primeiro = form.querySelector('[name="colaborador"]');
    if (primeiro) primeiro.focus();
  }

  /**
   * Ponto de entrada visível para registrar uma alteração: escolhe a viagem
   * primeiro, para quem não conhece o botão ↻ da linha.
   */
  function escolherViagemParaAlterar() {
    var candidatas = C.viagens()
      .filter(function (v) { return v.tipo !== "Alteração"; })
      .sort(function (a, b) { return (b.dataIda || "").localeCompare(a.dataIda || ""); });

    if (!candidatas.length) { toast("Não há viagem lançada para alterar"); return; }

    var dialogo = abrirModal({
      titulo: "Registrar alteração de viagem",
      estreito: true,
      corpo: '<form id="form-escolhe" method="dialog"><div class="grid" style="gap:12px">' +
        '<div class="note">Cancelamento, remarcação de voo, extensão do período, troca de hotel — ' +
        "a viagem original continua como está, e a alteração entra como um lançamento ligado a ela, " +
        "com o próprio custo. Assim dá para medir quanto as mudanças custaram no ano.</div>" +
        V.campo("Viagem a alterar", V.selectHTML("id", candidatas.map(function (v) {
          return { v: v.id, r: "#" + v.id + " · " + v.colaborador + " · " +
                   C.fmtDataCurta(v.dataIda) + "→" + C.fmtDataCurta(v.dataVolta) + " · " + v.destino };
        }), String(candidatas[0].id), "required"), "c12") +
        "</div></form>",
      rodape: '<span class="grow"></span><button class="btn" data-acao="fechar">Cancelar</button>' +
        '<button class="btn btn-primary" type="submit" form="form-escolhe">Continuar</button>'
    });

    dialogo.querySelector("form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var id = new FormData(ev.target).get("id");
      dialogo.close();
      abrirAlteracao(C.viagemPorId(id));
    });
  }

  function abrirAlteracao(original) {
    if (!original) return;
    var v = C.viagemVazia();
    v.tipo = "Alteração";
    v.refId = original.id;
    v.colaborador = original.colaborador;
    v.destino = original.destino;
    v.aeroportoOrigem = original.aeroportoOrigem;
    v.dataIda = original.dataVolta;      // a extensão começa onde a viagem terminava
    v.dataVolta = original.dataVolta;
    v.status = "Pendente";
    v.tipoAlteracao = C.TIPOS_ALTERACAO[0].v;
    v.obs = "Alteração da viagem #" + original.id;
    abrirViagem(null, v);
    var form = document.querySelector("#form-viagem");
    form.dataset.tipo = "Alteração";
    form.dataset.refid = original.id;
    form.dataset.originalId = original.id;
  }

  /** Recalcula os derivados enquanto o formulário é preenchido. */
  function recalcular(form, alvo) {
    if (!form) return;
    var d = dadosDoFormulario(form);

    if (alvo) {
      if (alvo.name === "alimentacao") form.dataset.alimTocada = "1";

      if (alvo.name === "colaborador") {
        var c = C.colaborador(alvo.value);
        var campoAero = form.querySelector('[name="aeroportoOrigem"]');
        if (c && campoAero && !campoAero.value) campoAero.value = c.aeroportoBase || "";
      }
      if (alvo.name === "lote") {
        form.querySelector('[data-bloco="pessoa"]').hidden = alvo.checked;
        form.querySelector('[data-bloco="lote"]').hidden = !alvo.checked;
        form.querySelector('[name="colaborador"]').required = !alvo.checked;
      }
    }

    var noites = Math.max(0, C.diasEntre(d.dataIda, d.dataVolta));

    // Preenchimento automático da alimentação, até o usuário assumir o campo
    if (!form.dataset.alimTocada && noites) {
      form.querySelector('[name="alimentacao"]').value = C.brl(noites * C.porPernoite());
    }

    d = dadosDoFormulario(form);
    var calc = C.calc(d);

    form.querySelector('[name="noites"]').value = noites + (noites === 1 ? " noite" : " noites");
    form.querySelector('[name="hospedagem"]').value = C.brl(calc.hospedagem);

    var infoHosp = form.querySelector("[data-info='hospedagem']");
    if (infoHosp) {
      var hosp = C.parseNum(form.querySelector('[name="hospedagem"]').value);
      infoHosp.textContent = !hosp ? "Valor cheio do hotel no período"
        : noites ? C.moeda(hosp / noites) + " por noite · " + noites + " noite(s)"
        : "Período sem pernoite";
    }

    var infoRegra = form.querySelector("[data-info='regra']");
    if (infoRegra) {
      infoRegra.textContent = "devido: " + C.brlSigla(calc.alimDevida) +
        (calc.difAlim ? " (" + (calc.difAlim > 0 ? "+" : "") + C.brl(calc.difAlim) + ")" : "");
    }

    var infoPessoa = form.querySelector("[data-info='pessoa']");
    if (infoPessoa) {
      var col = C.colaborador(d.colaborador);
      infoPessoa.textContent = col
        ? col.area + " · gestor: " + (col.gestor || "—") + " · base: " + (col.cidade || "—")
        : "Área e gestor vêm do cadastro da equipe.";
    }

    var emLote = !!form.querySelector('[name="lote"]:checked');
    var quantos = emLote ? form.querySelectorAll('[name="lote-nome"]:checked').length : 1;

    var dicaAero = form.querySelector('[name="aeroportoOrigem"]');
    if (dicaAero) dicaAero.placeholder = emLote ? "vazio = aeroporto base de cada um" : "CNF - Confins";

    var resumo = form.querySelector("[data-resumo]");
    if (resumo) {
      var linhas = [
        ["Aéreo", d.aereo],
        ["Hospedagem" + (calc.porNoite ? " (" + C.moeda(calc.porNoite) + "/noite)" : ""), calc.hospedagem],
        ["Alimentação", d.alimentacao], ["Transporte / Auxílio", d.transporte]
      ];
      if (form.dataset.tipo === "Alteração") linhas.push(["Custo da alteração", d.custoAlteracao]);
      resumo.innerHTML = linhas.filter(function (l) { return l[1]; }).map(function (l) {
        return '<div class="summary-line"><span>' + l[0] + '</span><span class="num">' + C.brl(l[1]) + "</span></div>";
      }).join("") +
        '<div class="summary-line summary-total"><span>' + (quantos > 1 ? "Total por pessoa" : "Total da viagem") +
          '</span><span class="num">' + C.brlSigla(calc.total) + "</span></div>" +
        (quantos > 1
          ? '<div class="summary-line"><span>' + quantos + " colaboradores selecionados</span>" +
            '<span class="num">' + C.brlSigla(calc.total * quantos) + "</span></div>"
          : "") +
        (calc.avisos.length
          ? '<div style="display:flex;gap:6px;flex-wrap:wrap;padding-top:4px">' + calc.avisos.map(function (a) {
              return '<span class="chip ' + a.nivel + '">⚠ ' + esc(a.texto) + "</span>";
            }).join("") + "</div>"
          : '<div style="padding-top:4px"><span class="chip ok">OK — período, hospedagem e alimentação batem</span></div>');
    }
  }

  function aplicarRegraAlimentacao(form) {
    var d = dadosDoFormulario(form);
    var noites = Math.max(0, C.diasEntre(d.dataIda, d.dataVolta));
    form.querySelector('[name="alimentacao"]').value = C.brl(noites * C.porPernoite());
    form.dataset.alimTocada = "1";
    recalcular(form);
  }

  function dadosDoFormulario(form) {
    var fd = new FormData(form);
    var d = {
      id: Number(form.dataset.id) || 0,
      tipo: form.dataset.tipo || "Viagem",
      refId: form.dataset.refid ? Number(form.dataset.refid) : null,
      tipoAlteracao: fd.get("tipoAlteracao") || "",
      colaborador: fd.get("colaborador") || "",
      destino: (fd.get("destino") || "").trim(),
      aeroportoOrigem: (fd.get("aeroportoOrigem") || "").trim(),
      dataIda: fd.get("dataIda") || "",
      dataVolta: fd.get("dataVolta") || "",
      status: fd.get("status") || "Fechado",
      motivo: (fd.get("motivo") || "").trim(),
      pendencias: (fd.get("pendencias") || "").trim(),
      obs: (fd.get("obs") || "").trim()
    };
    CAMPOS_MOEDA.forEach(function (k) { d[k] = C.parseNum(fd.get(k)); });
    return d;
  }

  function salvarFormulario(form, manterAberto, dialogo) {
    var d = dadosDoFormulario(form);
    var fd = new FormData(form);
    var emLote = !!fd.get("lote");
    var nomes = emLote ? fd.getAll("lote-nome") : (d.colaborador ? [d.colaborador] : []);

    if (!nomes.length) { avisaForm(form, "Escolha ao menos um colaborador."); return false; }
    if (!d.dataIda || !d.dataVolta) { avisaForm(form, "Informe as datas de ida e volta."); return false; }
    if (C.diasEntre(d.dataIda, d.dataVolta) < 0) { avisaForm(form, "A data de volta é anterior à de ida."); return false; }

    var botoes = form.closest("dialog").querySelectorAll("button[type=submit]");
    botoes.forEach(function (b) { b.disabled = true; });

    // Um de cada vez: no servidor, dois lançamentos simultâneos disputariam o mesmo ID.
    var salvos = [];
    var fila = nomes.reduce(function (anterior, nome) {
      return anterior.then(function () {
        var aeroporto = d.aeroportoOrigem;
        if (!aeroporto && emLote) {
          var col = C.colaborador(nome);
          aeroporto = col ? col.aeroportoBase : "";   // cada um sai da sua própria base
        }
        return C.salvarViagem(Object.assign({}, d, {
          colaborador: nome, aeroportoOrigem: aeroporto, id: nomes.length > 1 ? 0 : d.id
        })).then(function (v) { salvos.push(v); });
      });
    }, Promise.resolve());

    fila.then(function () {
      // A viagem original passa a "Alterada" — ou "Cancelado", num cancelamento.
      if (!form.dataset.originalId) return;
      var orig = C.viagemPorId(form.dataset.originalId);
      if (!orig) return;
      var novoStatus = C.tipoAlteracao(d.tipoAlteracao).cancela ? "Cancelado" : "Alterada";
      if (orig.status !== novoStatus) {
        return C.salvarViagem(Object.assign({}, orig, { status: novoStatus }));
      }
    }).then(function () {
      botoes.forEach(function (b) { b.disabled = false; });
      toast(salvos.length > 1
        ? salvos.length + " viagens lançadas"
        : (d.id ? "Viagem #" + d.id + " atualizada"
                : "Viagem #" + ((salvos[0] && salvos[0].id) || "") + " lançada"));
      if (!manterAberto) dialogo.close();
      else limpaParaProxima(form);
    }, function (e) {
      botoes.forEach(function (b) { b.disabled = false; });
      avisaForm(form, (e && e.message) || "Não consegui salvar.");
    });

    return true;
  }

  /** Depois de 'Salvar e lançar outra': mantém destino e datas, zera o resto. */
  function limpaParaProxima(form) {
    {
      // Mantém destino e datas, limpa pessoa e valores — o padrão de quem lança em série.
      form.dataset.id = "";
      form.dataset.originalId = "";
      ["aereo", "hospedagem", "transporte", "custoAlteracao"].forEach(function (k) {
        var campo = form.querySelector('[name="' + k + '"]');
        if (campo) campo.value = "0,00";
      });
      var sel = form.querySelector('[name="colaborador"]');
      if (sel) { sel.value = ""; sel.focus(); }
      form.querySelectorAll('[name="lote-nome"]').forEach(function (c) { c.checked = false; });
      form.dataset.alimTocada = "";
      recalcular(form);
    }
  }

  function avisaForm(form, texto) {
    var alvo = form.closest("dialog").querySelector("[data-status-form]");
    if (alvo) {
      alvo.textContent = texto;
      alvo.style.color = "var(--critical)";
      setTimeout(function () { alvo.textContent = ""; }, 4000);
    }
  }

  function excluirViagem(id) {
    var v = C.viagemPorId(id);
    if (!v) return;
    var filhas = C.alteracoesDe(id);
    var texto = "Excluir a viagem #" + id + " de " + v.colaborador + "?" +
      (filhas.length ? "\n\n" + filhas.length + " alteração(ões) ligada(s) a ela viram lançamentos independentes." : "");
    if (confirm(texto)) {
      C.excluirViagem(id).then(function () { toast("Viagem #" + id + " excluída"); }, falhou);
    }
  }

  function destinosConhecidos() {
    var set = {};
    C.db.viagens.forEach(function (v) { if (v.destino) set[v.destino] = 1; });
    return Object.keys(set).sort(C.ordenaPt);
  }


  // ---------- importar viagens de planilha ----------

  /** Coluna do modelo → campo da viagem. A comparação ignora acento e caixa. */
  var COLUNAS_MODELO = [
    { titulo: "Colaborador", campo: "colaborador", largura: 34, obrigatorio: true,
      exemplo: "", aliases: ["colaborador", "nome", "nome completo"] },
    { titulo: "Destino", campo: "destino", largura: 20, obrigatorio: true,
      exemplo: "São Paulo/SP", aliases: ["destino", "cidade destino"] },
    { titulo: "Aeroporto de origem", campo: "aeroportoOrigem", largura: 24,
      exemplo: "CNF - Confins", aliases: ["aeroporto de origem", "aeroporto", "origem"] },
    { titulo: "Data de ida", campo: "dataIda", largura: 13, obrigatorio: true, tipo: "data",
      exemplo: "05/10/2026", aliases: ["data de ida", "data ida", "ida", "inicio"] },
    { titulo: "Data de volta", campo: "dataVolta", largura: 13, obrigatorio: true, tipo: "data",
      exemplo: "09/10/2026", aliases: ["data de volta", "data volta", "volta", "retorno", "fim"] },
    { titulo: "Aéreo (R$)", campo: "aereo", largura: 12, tipo: "numero",
      exemplo: 1234.56, aliases: ["aereo (r$)", "aereo", "passagem", "aereo r$"] },
    { titulo: "Hospedagem — total (R$)", campo: "hospedagem", largura: 22, tipo: "numero",
      exemplo: 1120, aliases: ["hospedagem - total (r$)", "hospedagem — total (r$)", "hospedagem (r$)", "hospedagem", "hotel"] },
    { titulo: "Alimentação (R$)", campo: "alimentacao", largura: 17, tipo: "numero",
      exemplo: 400, aliases: ["alimentacao (r$)", "alimentacao"] },
    { titulo: "Transporte/Auxílio (R$)", campo: "transporte", largura: 21, tipo: "numero",
      exemplo: 0, aliases: ["transporte/auxilio (r$)", "transporte/auxilio", "transporte", "auxilio"] },
    { titulo: "Status", campo: "status", largura: 12,
      exemplo: "Fechado", aliases: ["status", "situacao"] },
    { titulo: "Observação", campo: "obs", largura: 34,
      exemplo: "aereo + hosp", aliases: ["observacao", "obs", "comentario"] }
  ];

  function baixarModelo() {
    var exemplo = C.colaboradoresOrdenados().filter(function (c) { return c.status === "Ativo"; })[0];
    var linhaExemplo = COLUNAS_MODELO.map(function (c) {
      return c.campo === "colaborador" ? (exemplo ? exemplo.nome : "") : c.exemplo;
    });

    var abas = [
      { nome: "Viagens",
        larguras: COLUNAS_MODELO.map(function (c) { return c.largura; }),
        linhas: [COLUNAS_MODELO.map(function (c) { return c.titulo; }), linhaExemplo] },

      { nome: "Como preencher", larguras: [30, 70],
        linhas: [
          ["Coluna", "O que preencher"]
        ].concat(COLUNAS_MODELO.map(function (c) {
          return [c.titulo + (c.obrigatorio ? " (obrigatório)" : ""), textoAjuda(c)];
        })).concat([
          ["", ""],
          ["Datas", "No formato dia/mês/ano. Célula formatada como data também funciona."],
          ["Valores", "Só números. 1234,56 ou 1234.56 — sem o R$."],
          ["Alimentação", "Se deixar vazio, entra a regra: " + C.brlSigla(C.porPernoite()) + " por pernoite."],
          ["Hospedagem", "Lance o total do período. O valor por noite sai da divisão pelas noites."],
          ["Linha de exemplo", "Apague a linha 2 da aba Viagens antes de importar, ou deixe — ela é conferida como qualquer outra."]
        ]) },

      { nome: "Colaboradores", larguras: [34, 30, 26],
        linhas: [["Nome (use exatamente assim)", "Área", "Aeroporto base"]].concat(
          C.colaboradoresOrdenados().filter(function (c) { return c.status !== "Desligado"; })
            .map(function (c) { return [c.nome, c.area, c.aeroportoBase]; })) },

      { nome: "Aeroportos", larguras: [26, 26, 6],
        linhas: [["Aeroporto", "Cidade", "UF"]].concat(
          window.BR.AEROPORTOS.map(function (a) { return [a.valor, a.cidade, a.uf]; })) }
    ];

    baixar("modelo-importacao-viagens.xlsx", window.XLSX.criar(abas),
           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }

  function textoAjuda(c) {
    if (c.campo === "colaborador") return "Nome como está no cadastro — veja a aba Colaboradores.";
    if (c.campo === "status") return "Um destes: " + C.db.params.statuses.join(", ") + ".";
    if (c.tipo === "data") return "Dia/mês/ano, por exemplo 05/10/2026.";
    if (c.tipo === "numero") return "Número, sem o R$.";
    if (c.campo === "aeroportoOrigem") return "Opcional. Veja a aba Aeroportos; vazio usa o aeroporto base da pessoa.";
    if (c.campo === "hospedagem") return "Valor cheio do hotel no período. O app divide pelas noites sozinho.";
    return "Texto livre.";
  }

  function normalizaCabecalho(v) {
    return C.normal(String(v || "").replace(/\s+/g, " ").trim());
  }

  /** Data vinda do Excel: texto dd/mm/aaaa, ISO ou número de série. */
  function dataDaCelula(valor) {
    if (typeof valor === "number" && valor > 20000 && valor < 80000) return window.XLSX.dataDeSerie(valor);
    var texto = String(valor || "").trim();
    if (!texto) return "";
    var br = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(texto);
    if (br) {
      var ano = br[3].length === 2 ? "20" + br[3] : br[3];
      return ano + "-" + C.pad(+br[2]) + "-" + C.pad(+br[1]);
    }
    var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
    return iso ? iso[0] : "";
  }

  /** Lê o arquivo escolhido e devolve as linhas como matriz. */
  function lerPlanilha(arquivo) {
    if (/\.csv$/i.test(arquivo.name)) {
      return arquivo.text().then(function (texto) {
        var sep = (texto.split("\n")[0].match(/;/g) || []).length >= (texto.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
        return texto.replace(/^﻿/, "").split(/\r?\n/).filter(function (l) { return l.trim(); })
          .map(function (linha) {
            return linha.split(sep).map(function (c) { return c.replace(/^"|"$/g, "").trim(); });
          });
      });
    }
    return arquivo.arrayBuffer().then(window.XLSX.ler);
  }

  /** Converte a matriz em viagens, com o motivo de cada linha recusada. */
  function interpretaPlanilha(linhas) {
    var cabecalho = -1, mapa = {};
    for (var i = 0; i < Math.min(linhas.length, 15); i++) {
      var atual = {};
      (linhas[i] || []).forEach(function (celula, j) {
        var chave = normalizaCabecalho(celula);
        COLUNAS_MODELO.forEach(function (c) {
          if (atual[c.campo] === undefined && c.aliases.indexOf(chave) > -1) atual[c.campo] = j;
        });
      });
      if (atual.colaborador !== undefined && atual.dataIda !== undefined) { cabecalho = i; mapa = atual; break; }
    }
    if (cabecalho < 0) {
      throw new Error("Não achei o cabeçalho. A planilha precisa ter as colunas Colaborador, Data de ida e Data de volta — baixe o modelo.");
    }

    var pessoas = C.colaboradoresOrdenados();
    var resultado = [];

    for (var l = cabecalho + 1; l < linhas.length; l++) {
      var linha = linhas[l] || [];
      var bruto = function (campo) { return mapa[campo] === undefined ? "" : linha[mapa[campo]]; };
      if (!COLUNAS_MODELO.some(function (c) { return String(bruto(c.campo) || "").trim(); })) continue;   // linha vazia

      var erros = [];
      var nome = String(bruto("colaborador") || "").trim();
      var pessoa = null;
      if (!nome) erros.push("sem colaborador");
      else {
        pessoa = pessoas.filter(function (p) { return C.normal(p.nome) === C.normal(nome); })[0] ||
                 pessoas.filter(function (p) { return C.normal(p.nome).indexOf(C.normal(nome)) === 0; })[0];
        if (!pessoa) erros.push("colaborador não cadastrado: " + nome);
        else if (pessoa.status === "Desligado") erros.push(pessoa.nome + " está desligado");
      }

      var ida = dataDaCelula(bruto("dataIda"));
      var volta = dataDaCelula(bruto("dataVolta"));
      if (!ida) erros.push("data de ida inválida");
      if (!volta) erros.push("data de volta inválida");
      if (ida && volta && C.diasEntre(ida, volta) < 0) erros.push("volta antes da ida");

      var noites = ida && volta ? Math.max(0, C.diasEntre(ida, volta)) : 0;
      var status = String(bruto("status") || "").trim();
      if (status && C.db.params.statuses.indexOf(status) === -1) {
        erros.push("status desconhecido: " + status);
        status = "";
      }

      var temAlim = String(bruto("alimentacao") || "").trim() !== "";
      // Planilha antiga, com diárias e valor da diária, ainda é aceita.
      var hospedagem = String(bruto("hospedagem") || "").trim() !== ""
        ? C.parseNum(bruto("hospedagem"))
        : C.parseNum(bruto("diarias")) * C.parseNum(bruto("valorDiaria"));

      var viagem = {
        tipo: "Viagem",
        colaborador: pessoa ? pessoa.nome : nome,
        destino: String(bruto("destino") || "").trim(),
        aeroportoOrigem: String(bruto("aeroportoOrigem") || "").trim() || (pessoa ? pessoa.aeroportoBase : ""),
        dataIda: ida,
        dataVolta: volta,
        aereo: C.parseNum(bruto("aereo")),
        hospedagem: hospedagem,
        alimentacao: temAlim ? C.parseNum(bruto("alimentacao")) : noites * C.porPernoite(),
        transporte: C.parseNum(bruto("transporte")),
        custoAlteracao: 0,
        status: status || "Fechado",
        refId: null, motivo: "", pendencias: "",
        obs: String(bruto("obs") || "").trim()
      };
      if (!viagem.destino) erros.push("sem destino");

      resultado.push({ linhaPlanilha: l + 1, viagem: viagem, erros: erros, calc: C.calc(viagem) });
    }
    return resultado;
  }

  function abrirImportacao() {
    var dialogo = abrirModal({
      titulo: "Importar viagens de uma planilha",
      corpo:
        '<div class="grid" style="gap:14px">' +
        '<div class="note">Baixe o modelo, preencha uma linha por viagem e traga de volta. ' +
        "Cada coluna diz o que espera, e o arquivo já vem com a lista de colaboradores e de aeroportos " +
        "para copiar. Também aceito <strong>.csv</strong>.</div>" +
        '<div class="row"><button class="btn btn-primary" data-acao="baixar-modelo">Baixar modelo (.xlsx)</button></div>' +
        '<div class="field"><label for="arquivo-import">Planilha preenchida</label>' +
        '<input type="file" id="arquivo-import" name="arquivo" accept=".xlsx,.csv"></div>' +
        '<div data-previa></div></div>',
      rodape: '<span class="grow t-sub" data-status-import></span>' +
        '<button class="btn" data-acao="fechar">Cancelar</button>' +
        '<button class="btn btn-primary" data-importar disabled>Importar</button>'
    });

    var entrada = dialogo.querySelector("#arquivo-import");
    var previa = dialogo.querySelector("[data-previa]");
    var aviso = dialogo.querySelector("[data-status-import]");
    var botao = dialogo.querySelector("[data-importar]");
    var validas = [];

    entrada.addEventListener("change", function () {
      var arquivo = entrada.files && entrada.files[0];
      previa.innerHTML = "";
      botao.disabled = true;
      validas = [];
      if (!arquivo) return;

      aviso.textContent = "Lendo…";
      lerPlanilha(arquivo).then(function (linhas) {
        var itens = interpretaPlanilha(linhas);
        validas = itens.filter(function (i) { return !i.erros.length; });
        aviso.textContent = "";
        botao.disabled = !validas.length;
        botao.textContent = validas.length ? "Importar " + validas.length + " viagem(ns)" : "Importar";
        previa.innerHTML = montaPrevia(itens);
      }, function (e) {
        aviso.textContent = "";
        previa.innerHTML = '<div class="note warn">' + esc(e.message || "Não consegui ler o arquivo.") + "</div>";
      });
    });

    botao.addEventListener("click", function () {
      botao.disabled = true;
      botao.textContent = "Importando…";
      var feitas = 0;
      // Uma de cada vez: no servidor, lançamentos simultâneos disputariam o mesmo ID.
      validas.reduce(function (anterior, item) {
        return anterior.then(function () {
          return C.salvarViagem(item.viagem).then(function () { feitas++; });
        });
      }, Promise.resolve()).then(function () {
        toast(feitas + " viagem(ns) importada(s)");
        dialogo.close();
      }, function (e) {
        botao.disabled = false;
        botao.textContent = "Importar";
        aviso.textContent = (e && e.message) || "Falhou no meio da importação.";
        aviso.style.color = "var(--critical)";
        if (feitas) toast(feitas + " viagem(ns) importada(s) antes da falha");
      });
    });
  }

  function montaPrevia(itens) {
    if (!itens.length) return '<div class="note warn">Nenhuma linha preenchida na planilha.</div>';
    var comErro = itens.filter(function (i) { return i.erros.length; }).length;

    return '<div class="row" style="gap:8px">' +
      '<span class="chip ok">' + (itens.length - comErro) + " prontas</span>" +
      (comErro ? '<span class="chip crit">' + comErro + " com problema</span>" : "") +
      "</div>" +
      '<div class="table-wrap" style="max-height:260px;margin-top:10px"><table><thead><tr>' +
      '<th>Linha</th><th>Colaborador</th><th>Período</th><th class="n">Total</th><th>Situação</th>' +
      "</tr></thead><tbody>" +
      itens.map(function (i) {
        return "<tr><td class='num t-sub'>" + i.linhaPlanilha + "</td>" +
          "<td>" + esc(i.viagem.colaborador || "—") + "</td>" +
          '<td class="nowrap num">' + C.fmtDataCurta(i.viagem.dataIda) + " → " + C.fmtDataCurta(i.viagem.dataVolta) + "</td>" +
          '<td class="n">' + C.moeda(i.calc.total) + "</td>" +
          "<td>" + (i.erros.length
            ? '<span class="chip crit">' + esc(i.erros.join(" · ")) + "</span>"
            : '<span class="chip ok">pronta</span>') + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  // ---------- colaborador ----------

  function abrirColaborador(c) {
    var novo = !c;
    var d = c || { nome: "", area: "", cargo: "", nivel: "", gestor: "", contrato: "PJ", cidade: "", uf: "",
                   aeroportoBase: "", email: "", emailAlt: "", modelo: "Remoto", status: "Ativo" };
    var nomes = C.colaboradoresOrdenados().map(function (x) { return x.nome; });

    var dialogo = abrirModal({
      titulo: novo ? "Novo colaborador" : d.nome,
      classe: "",
      corpo: '<form id="form-colab" method="dialog"><div class="form-grid">' +
        V.campo("Nome completo", '<input type="text" name="nome" value="' + esc(d.nome) + '" required>', "c6") +
        V.campo("Área", '<input type="text" name="area" list="areas" value="' + esc(d.area) + '">', "c6") +
        V.campo("Cargo", '<input type="text" name="cargo" value="' + esc(d.cargo) + '">', "c6") +
        V.campo("Gestor direto", '<input type="text" name="gestor" list="nomes" value="' + esc(d.gestor) + '">', "c6") +
        V.campo("Cidade", '<input type="text" name="cidade" value="' + esc(d.cidade) + '">', "c4") +
        V.campo("UF", '<select name="uf">' + window.BR.opcoesUF(d.uf) + "</select>", "c3") +
        V.campo("Aeroporto base",
                '<input type="text" name="aeroportoBase" list="aeroportos" autocomplete="off" value="' +
                esc(d.aeroportoBase) + '" placeholder="Selecione ou digite">', "c4") +
        V.campo("Contrato", V.selectHTML("contrato", ["PJ", "CLT"], d.contrato), "c3") +
        V.campo("Modelo", V.selectHTML("modelo", ["Remoto", "Híbrido", "Presencial"], d.modelo), "c3") +
        V.campo("E-mail", '<input type="text" name="email" value="' + esc(d.email) + '">', "c6") +
        "</div>" +
        '<datalist id="areas">' + C.areas().map(function (a) { return '<option value="' + esc(a) + '">'; }).join("") + "</datalist>" +
        '<datalist id="nomes">' + nomes.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist>" +
        '<datalist id="aeroportos">' + window.BR.opcoesAeroporto() + "</datalist>" +
        "</form>",
      rodape: '<span class="grow"></span>' +
        (novo ? "" : '<button class="btn btn-danger" data-acao="excluir-colab">Excluir</button>') +
        '<button class="btn" data-acao="fechar">Cancelar</button>' +
        '<button class="btn btn-primary" type="submit" form="form-colab">Salvar</button>',
      estreito: true
    });

    var form = dialogo.querySelector("form");
    var nomeAntigo = d.nome;

    // Cidade preenchida e aeroporto vazio: sugere o aeroporto da própria cidade.
    form.cidade.addEventListener("blur", function () {
      if (form.aeroportoBase.value) return;
      var achado = window.BR.aeroportoDaCidade(form.cidade.value, form.uf.value);
      if (achado) form.aeroportoBase.value = achado.valor;
    });

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var fd = new FormData(form);
      var nome = (fd.get("nome") || "").trim();
      if (!nome) return;
      var alvo = Object.assign({}, novo ? { status: "Ativo" } : c);
      ["nome", "area", "cargo", "gestor", "cidade", "uf", "aeroportoBase", "contrato", "modelo", "email"].forEach(function (k) {
        alvo[k] = (fd.get(k) || "").trim();
      });
      C.salvarColaborador(alvo, novo ? "" : nomeAntigo).then(function () {
        toast(novo ? "Colaborador cadastrado" : "Cadastro atualizado");
        dialogo.close();
      }, falhou);
    });

    var btnExcluir = dialogo.querySelector('[data-acao="excluir-colab"]');
    if (btnExcluir) {
      btnExcluir.addEventListener("click", function () {
        if (!confirm("Remover " + d.nome + " do cadastro?")) return;
        C.excluirColaborador(d.nome).then(function () {
          toast("Colaborador removido");
          dialogo.close();
        }, function (e) {
          alert((e && e.message) || "Não consegui remover.");
        });
      });
    }
  }

  // ---------- De-Para do Uber ----------

  function abrirDePara(nomeUber) {
    var dialogo = abrirModal({
      titulo: "Vincular nome do Uber",
      corpo: '<form id="form-depara" method="dialog"><div class="form-grid">' +
        V.campo("Nome como aparece no relatório do Uber",
                '<input type="text" name="uber" value="' + esc(nomeUber) + '" required>', "c12") +
        V.campo("Colaborador", V.selectHTML("colaborador",
                [{ v: "", r: "Selecione…" }].concat(C.colaboradoresOrdenados().map(function (c) {
                  return { v: c.nome, r: c.nome + " · " + c.area };
                })), sugereColaborador(nomeUber), "required"), "c12") +
        "</div></form>",
      rodape: '<span class="grow"></span><button class="btn" data-acao="fechar">Cancelar</button>' +
        '<button class="btn btn-primary" type="submit" form="form-depara">Vincular</button>',
      estreito: true
    });

    dialogo.querySelector("form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var fd = new FormData(ev.target);
      var uber = (fd.get("uber") || "").trim();
      var colab = fd.get("colaborador");
      if (!uber || !colab) return;
      var existente = C.db.params.dePara.filter(function (m) { return C.normal(m.uber) === C.normal(uber); })[0];
      if (existente) existente.colaborador = colab;
      else C.db.params.dePara.push({ uber: uber, colaborador: colab });
      C.salvarParams().then(function () {
        toast("Vínculo salvo — corridas reauditadas");
        dialogo.close();
      }, falhou);
    });
  }

  /** Palpite pelo primeiro nome, para o De-Para já vir preenchido. */
  function sugereColaborador(nomeUber) {
    if (!nomeUber) return "";
    var primeiro = C.normal(nomeUber).split(" ")[0];
    var achado = C.colaboradoresOrdenados().filter(function (c) {
      return C.normal(c.nome).split(" ")[0] === primeiro;
    });
    return achado.length === 1 ? achado[0].nome : "";
  }

  // ---------- Uber: importação ----------

  function importarUber() {
    var caixa = document.querySelector('[name="colar-uber"]');
    if (!caixa || !caixa.value.trim()) { toast("Cole as linhas do relatório antes de importar"); return; }

    var linhas = caixa.value.split(/\r?\n/).filter(function (l) { return l.trim(); });
    var validas = linhas.filter(function (l) { return l.split(";").length >= 10; });
    if (!validas.length) {
      alert("Nenhuma linha reconhecida.\n\nO relatório do Uber Business vem separado por ponto e vírgula, " +
            "com pelo menos 10 campos por linha. Abra o CSV no Bloco de Notas e copie as linhas de transação " +
            "(sem o cabeçalho do relatório).");
      return;
    }

    var ignoradas = linhas.length - validas.length;
    caixa.value = "";
    C.adicionarCorridas(validas).then(function (r) {
      toast(r.novas + " corrida(s) importada(s)" +
            (r.repetidas ? " · " + r.repetidas + " repetida(s) ignorada(s)" : "") +
            (ignoradas ? " · " + ignoradas + " linha(s) fora do formato" : ""));
    }, falhou);
  }

  // ---------- regras ----------

  function salvarRegras() {
    var r = C.db.params.regras;
    r.jantar = C.parseNum(document.querySelector('[name="regra-jantar"]').value);
    r.cafe = C.parseNum(document.querySelector('[name="regra-cafe"]').value);
    r.toleranciaUber = Math.max(0, Math.round(C.parseNum(document.querySelector('[name="regra-tol"]').value)));
    C.salvarParams().then(function () { toast("Regras salvas — base recalculada"); }, falhou);
  }

  /** Mensagem única para qualquer falha vinda do servidor. */
  function falhou(e) {
    toast((e && e.message) || "Não consegui salvar. Confira a conexão.");
  }

  // ---------- backup ----------

  function abrirRestaurar() {
    var dialogo = abrirModal({
      titulo: "Restaurar backup",
      corpo: '<form id="form-restaurar" method="dialog"><div class="grid" style="gap:12px">' +
        '<div class="note">Escolha um arquivo <strong>.json</strong> gerado aqui, ou cole o conteúdo do backup. ' +
        "Tudo que está no navegador agora será substituído.</div>" +
        '<input type="file" name="arquivo" accept="application/json,.json">' +
        '<textarea name="colado" rows="5" placeholder="…ou cole aqui o JSON do backup"></textarea>' +
        "</div></form>",
      rodape: '<span class="grow"></span><button class="btn" data-acao="fechar">Cancelar</button>' +
        '<button class="btn btn-primary" type="submit" form="form-restaurar">Restaurar</button>',
      estreito: true
    });

    dialogo.querySelector("form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var fd = new FormData(ev.target);
      var arquivo = fd.get("arquivo");
      var colado = (fd.get("colado") || "").trim();

      function aplica(texto) {
        var novo;
        try {
          novo = JSON.parse(texto);
          if (!novo.viagens || !novo.colaboradores) throw new Error("formato");
        } catch (e) {
          alert("Não consegui ler esse backup. Confira se é o arquivo .json gerado por este app.");
          return;
        }
        C.substituirEstado(novo).then(function () {
          toast("Backup restaurado");
          dialogo.close();
        }, falhou);
      }

      if (arquivo && arquivo.size) {
        var leitor = new FileReader();
        leitor.onload = function () { aplica(String(leitor.result)); };
        leitor.readAsText(arquivo);
      } else if (colado) {
        aplica(colado);
      }
    });
  }

  /** Em página incorporada (iframe), o navegador bloqueia downloads. */
  function emIframe() {
    try { return window.self !== window.top; } catch (e) { return true; }
  }

  /**
   * Salva um arquivo. Na página publicada usa o canal de download do próprio
   * visualizador; localmente, um link comum; se nada disso servir, mostra o
   * conteúdo para copiar.
   */
  function baixar(nome, conteudo, tipo) {
    var binario = conteudo instanceof Blob;
    var dados = binario ? conteudo : (tipo === "text/csv" ? "\ufeff" : "") + conteudo;

    if (window.claude && typeof window.claude.use === "function") {
      window.claude.use("downloads").then(function (downloads) {
        if (!downloads) { baixarLocal(nome, dados, tipo); return; }
        downloads.save({ filename: nome, data: dados }).then(
          function () { toast(nome + " salvo"); },
          function (e) {
            if (e && e.code === "declined") return;
            if (binario) toast("Este navegador não deixou salvar o arquivo.");
            else modalTexto(nome, conteudo);
          }
        );
      }, function () { baixarLocal(nome, dados, tipo); });
      return;
    }

    baixarLocal(nome, dados, tipo);
  }

  function baixarLocal(nome, conteudo, tipo) {
    if (emIframe()) {
      if (conteudo instanceof Blob) { toast("Página incorporada: abra o app em aba própria para baixar."); return; }
      modalTexto(nome, conteudo.replace(/^\ufeff/, ""));
      return;
    }
    var blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo + ";charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast(nome + " gerado");
  }

  /** Mostra o conteúdo pronto para copiar, quando não dá para baixar o arquivo. */
  function modalTexto(nome, conteudo) {
    var d = abrirModal({
      titulo: nome,
      corpo: '<div class="grid" style="gap:10px">' +
        '<div class="note">Esta página está incorporada e o navegador bloqueia o download. ' +
        "Copie o conteúdo abaixo e cole num arquivo <strong>" + esc(nome) + "</strong>.</div>" +
        '<textarea rows="12" readonly style="font-family:var(--mono);font-size:12px">' + esc(conteudo) + "</textarea></div>",
      rodape: '<span class="grow"></span><button class="btn" data-acao="fechar">Fechar</button>' +
        '<button class="btn btn-primary" data-copiar>Copiar tudo</button>'
    });
    d.querySelector("[data-copiar]").addEventListener("click", function () { copiar(conteudo); });
    d.querySelector("textarea").select();
  }

  function copiar(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(
        function () { toast("Backup copiado para a área de transferência"); },
        function () { toast("Não foi possível copiar"); }
      );
    } else {
      var t = document.createElement("textarea");
      t.value = texto;
      document.body.appendChild(t);
      t.select();
      try { document.execCommand("copy"); toast("Backup copiado"); } catch (e) { toast("Não foi possível copiar"); }
      t.remove();
    }
  }

  function hoje() {
    var d = new Date();
    return d.getFullYear() + "-" + C.pad(d.getMonth() + 1) + "-" + C.pad(d.getDate());
  }

  // ---------- modal, toast, tooltip, tema ----------

  function abrirModal(opcoes) {
    var d = document.createElement("dialog");
    d.className = "modal" + (opcoes.estreito ? " narrow" : "");
    d.innerHTML =
      '<div class="modal-head"><h2>' + esc(opcoes.titulo) + "</h2><span style='flex:1'></span>" +
      '<button class="icon-btn" data-acao="fechar" aria-label="Fechar">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>' +
      '<div class="modal-body">' + opcoes.corpo + "</div>" +
      '<div class="modal-foot">' + opcoes.rodape + "</div>";
    document.body.appendChild(d);
    d.addEventListener("close", function () { d.remove(); });
    d.showModal();
    return d;
  }

  function toast(texto) {
    var caixa = document.getElementById("toasts");
    var t = document.createElement("div");
    t.className = "toast";
    t.textContent = texto;
    caixa.appendChild(t);
    setTimeout(function () { t.remove(); }, 3400);
  }

  var $tip;
  function aoPassarMouse(ev) {
    var alvo = ev.target.closest && ev.target.closest("[data-tip]");
    if (!alvo) return;
    if (!$tip) {
      $tip = document.createElement("div");
      $tip.className = "tip";
      document.body.appendChild($tip);
    }
    var partes = alvo.dataset.tip.split("|");
    $tip.innerHTML = esc(partes[0]) + (partes[1] ? "<br><b>" + esc(partes[1]) + "</b>" : "");
    var r = alvo.getBoundingClientRect();
    $tip.classList.add("on");
    var largura = $tip.offsetWidth;
    $tip.style.left = Math.max(8, Math.min(window.innerWidth - largura - 8, r.left + r.width / 2 - largura / 2)) + "px";
    $tip.style.top = Math.max(8, r.top - $tip.offsetHeight - 8) + "px";
  }

  function escondeTip(ev) {
    if ($tip && (!ev.relatedTarget || !ev.relatedTarget.closest || !ev.relatedTarget.closest("[data-tip]"))) {
      $tip.classList.remove("on");
    }
  }

  function aplicaTema(tema) {
    if (tema === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", tema);
    localStorage.setItem("gvc.tema", tema);
    var b = document.getElementById("btn-tema");
    if (b) b.title = "Tema: " + ({ auto: "automático", light: "claro", dark: "escuro" })[tema];
  }

  function alternarTema() {
    var atual = localStorage.getItem("gvc.tema") || "auto";
    aplicaTema(atual === "auto" ? "light" : atual === "light" ? "dark" : "auto");
    toast("Tema: " + ({ auto: "automático", light: "claro", dark: "escuro" })[localStorage.getItem("gvc.tema")]);
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();

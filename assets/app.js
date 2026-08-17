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
    equipeFiltros: { busca: "", area: "" }
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
    C.carregar();
    estado.ano = C.anosComDados().slice(-1)[0];

    $view = document.getElementById("view");
    $tabs = document.getElementById("tabs");
    $anoSel = document.getElementById("ano");

    $tabs.innerHTML = ABAS.map(function (a) {
      return '<button class="tab" role="tab" data-aba="' + a.id + '" aria-selected="false">' + a.rotulo + "</button>";
    }).join("");

    atualizaAnos();
    aplicaTema(localStorage.getItem("gvc.tema") || "auto");

    document.addEventListener("click", aoClicar);
    document.addEventListener("change", aoMudarCampo);
    document.addEventListener("input", aoDigitar);
    document.addEventListener("mouseover", aoPassarMouse);
    document.addEventListener("mouseout", escondeTip);

    C.aoMudar(function () { atualizaAnos(); render(); });

    var hash = (location.hash || "").replace("#", "");
    if (ABAS.some(function (a) { return a.id === hash; })) estado.aba = hash;

    render();

    if (C.equipeAtualizada) {
      toast("Base de equipe atualizada: " + C.equipeAtualizada + " cadastros · " +
            C.db.colaboradores.length + " pessoas");
    }
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

    var botao = ev.target.closest("[data-acao]");
    if (!botao) return;
    var acao = botao.dataset.acao;
    var id = botao.dataset.id;

    switch (acao) {
      case "nova-viagem": abrirViagem(null); break;
      case "nova-viagem-para": abrirViagem(null, { colaborador: botao.dataset.nome }); break;
      case "editar": abrirViagem(C.viagemPorId(id)); break;
      case "duplicar":
        var novo = C.duplicarViagem(id);
        if (novo) { toast("Viagem duplicada como #" + novo.id); abrirViagem(novo); }
        break;
      case "alteracao": abrirAlteracao(C.viagemPorId(id)); break;
      case "excluir": excluirViagem(id); break;
      case "excluir-corrida":
        if (confirm("Excluir esta corrida da base do Uber?")) { C.excluirCorrida(Number(id)); toast("Corrida excluída"); }
        break;
      case "importar-uber": importarUber(); break;
      case "limpar-uber":
        if (confirm("Remover todas as " + C.corridas().length + " corridas da base do Uber?")) { C.limparUber(); toast("Base do Uber limpa"); }
        break;
      case "mapear": abrirDePara(botao.dataset.nome || ""); break;
      case "excluir-depara":
        C.db.params.dePara.splice(Number(id), 1); C.salvar(); toast("Vínculo removido");
        break;
      case "novo-colaborador": abrirColaborador(null); break;
      case "editar-colaborador": abrirColaborador(C.colaborador(botao.dataset.nome)); break;
      case "salvar-regras": salvarRegras(); break;
      case "limpar-filtros":
        estado.filtros = { busca: "", mes: "", area: "", status: "", tipo: "", avisos: false, ordem: estado.filtros.ordem };
        render(); break;
      case "exportar-viagens": baixar("viagens.csv", C.csvViagens(), "text/csv"); break;
      case "exportar-uber": baixar("uber.csv", C.csvUber(), "text/csv"); break;
      case "exportar-colaborador": baixar("por-colaborador-" + estado.ano + ".csv", C.csvColaborador(estado.ano), "text/csv"); break;
      case "backup-baixar": baixar("backup-viagens-" + hoje() + ".json", JSON.stringify(C.db, null, 1), "application/json"); break;
      case "backup-copiar": copiar(JSON.stringify(C.db)); break;
      case "backup-restaurar": abrirRestaurar(); break;
      case "restaurar-base":
        if (confirm("Isso descarta tudo que foi lançado aqui e volta à base original da planilha. Continuar?")) {
          C.restaurarBase(); toast("Base original restaurada");
        }
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

  var CAMPOS_MOEDA = ["aereo", "valorDiaria", "alimentacao", "transporte", "custoAlteracao"];

  function abrirViagem(viagem, pre) {
    var novo = !viagem;
    var v = viagem ? Object.assign({}, viagem) : C.viagemVazia();
    if (pre) Object.assign(v, pre);
    if (novo && !v.dataIda) v.dataIda = "";

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
      V.campo("Aeroporto de origem", '<input type="text" name="aeroportoOrigem" value="' + esc(v.aeroportoOrigem) + '" placeholder="CNF - Confins">', "c3") +

      '<div class="section-label"><span class="eyebrow">Período</span></div>' +
      V.campo("Data de ida", '<input type="date" name="dataIda" value="' + esc(v.dataIda) + '" required>', "c3") +
      V.campo("Data de volta", '<input type="date" name="dataVolta" value="' + esc(v.dataVolta) + '" required>', "c3") +
      '<div class="field c3"><label>Noites</label><input type="text" name="noites" readonly value="0"></div>' +
      V.campo("Status", V.selectHTML("status", C.db.params.statuses, v.status), "c3") +

      '<div class="section-label"><span class="eyebrow">Custos</span></div>' +
      V.campo("Aéreo (R$)", '<input type="text" class="money" name="aereo" value="' + C.brl(v.aereo) + '">', "c3") +
      V.campo("Diárias de hotel", '<input type="text" class="money" name="diarias" value="' + (v.diarias || 0) + '">', "c3") +
      V.campo("Valor da diária (R$)", '<input type="text" class="money" name="valorDiaria" value="' + C.brl(v.valorDiaria) + '">', "c3") +
      '<div class="field c3"><label>Hospedagem (R$)</label><input type="text" class="money" name="hospedagem" readonly value="0"><span class="hint">Diárias × valor</span></div>' +

      '<div class="field c3"><label>Alimentação (R$)</label>' +
      '<input type="text" class="money" name="alimentacao" value="' + C.brl(v.alimentacao) + '">' +
      '<span class="hint"><button type="button" class="btn btn-ghost btn-sm" data-acao="usar-regra" style="padding:0">usar a regra</button> ' +
      "<span data-info='regra'></span></span></div>" +
      V.campo("Transporte / Auxílio (R$)", '<input type="text" class="money" name="transporte" value="' + C.brl(v.transporte) + '">', "c3") +

      (ehAlteracao ?
        V.campo("Custo da alteração (R$)", '<input type="text" class="money" name="custoAlteracao" value="' + C.brl(v.custoAlteracao) + '">', "c3") +
        V.campo("Viagem original", '<input type="text" readonly value="#' + esc(v.refId || "") + '">', "c3") +
        '<div class="section-label"><span class="eyebrow">Alteração</span></div>' +
        V.campo("Motivo da alteração", '<input type="text" name="motivo" value="' + esc(v.motivo) + '">', "c6") +
        V.campo("Pendências em aberto", '<input type="text" name="pendencias" value="' + esc(v.pendencias) + '" placeholder="Hospedagem + Alimentação">', "c6",
                "Deixe vazio quando tudo estiver contratado — o aviso some sozinho.")
        : "") +

      V.campo("Observação", '<textarea name="obs" rows="2">' + esc(v.obs) + "</textarea>", "c12") +
      "</div>" +

      '<div class="summary" style="margin-top:16px" data-resumo></div>' +
      '<datalist id="destinos">' + destinos.map(function (d) { return '<option value="' + esc(d) + '">'; }).join("") + "</datalist>";

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
    if (!novo || v.diarias) form.dataset.diariasTocada = "1";

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var manterAberto = (ev.submitter && ev.submitter.value) === "novo";
      if (salvarFormulario(form, manterAberto)) {
        if (!manterAberto) dialogo.close();
      }
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
    v.obs = "Extensão da viagem #" + original.id;
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
      if (alvo.name === "diarias") form.dataset.diariasTocada = "1";
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

    // Preenchimentos automáticos, até o usuário assumir o campo
    if (!form.dataset.diariasTocada && noites) form.querySelector('[name="diarias"]').value = noites;
    if (!form.dataset.alimTocada && noites) {
      form.querySelector('[name="alimentacao"]').value = C.brl(noites * C.porPernoite());
    }

    d = dadosDoFormulario(form);
    var calc = C.calc(d);

    form.querySelector('[name="noites"]').value = noites + (noites === 1 ? " noite" : " noites");
    form.querySelector('[name="hospedagem"]').value = C.brl(calc.hospedagem);

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
        ["Aéreo", d.aereo], ["Hospedagem", calc.hospedagem], ["Alimentação", d.alimentacao],
        ["Transporte / Auxílio", d.transporte]
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
          : '<div style="padding-top:4px"><span class="chip ok">OK — noites, diárias e alimentação batem</span></div>');
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
      colaborador: fd.get("colaborador") || "",
      destino: (fd.get("destino") || "").trim(),
      aeroportoOrigem: (fd.get("aeroportoOrigem") || "").trim(),
      dataIda: fd.get("dataIda") || "",
      dataVolta: fd.get("dataVolta") || "",
      diarias: C.parseNum(fd.get("diarias")),
      status: fd.get("status") || "Fechado",
      motivo: (fd.get("motivo") || "").trim(),
      pendencias: (fd.get("pendencias") || "").trim(),
      obs: (fd.get("obs") || "").trim()
    };
    CAMPOS_MOEDA.forEach(function (k) { d[k] = C.parseNum(fd.get(k)); });
    return d;
  }

  function salvarFormulario(form, manterAberto) {
    var d = dadosDoFormulario(form);
    var fd = new FormData(form);
    var emLote = !!fd.get("lote");
    var nomes = emLote ? fd.getAll("lote-nome") : (d.colaborador ? [d.colaborador] : []);

    if (!nomes.length) { avisaForm(form, "Escolha ao menos um colaborador."); return false; }
    if (!d.dataIda || !d.dataVolta) { avisaForm(form, "Informe as datas de ida e volta."); return false; }
    if (C.diasEntre(d.dataIda, d.dataVolta) < 0) { avisaForm(form, "A data de volta é anterior à de ida."); return false; }

    var salvos = nomes.map(function (nome) {
      var aeroporto = d.aeroportoOrigem;
      if (!aeroporto && emLote) {
        var col = C.colaborador(nome);
        aeroporto = col ? col.aeroportoBase : "";   // cada um sai da sua própria base
      }
      return C.salvarViagem(Object.assign({}, d, {
        colaborador: nome, aeroportoOrigem: aeroporto, id: nomes.length > 1 ? 0 : d.id
      }));
    });

    // Ao registrar uma alteração, a viagem original passa a 'Alterada'
    if (form.dataset.originalId) {
      var orig = C.viagemPorId(form.dataset.originalId);
      if (orig && orig.status !== "Alterada") { orig.status = "Alterada"; C.salvar(); }
    }

    toast(salvos.length > 1
      ? salvos.length + " viagens lançadas"
      : (d.id ? "Viagem #" + d.id + " atualizada" : "Viagem #" + salvos[0].id + " lançada"));

    if (manterAberto) {
      // Mantém destino e datas, limpa pessoa e valores — o padrão de quem lança em série.
      form.dataset.id = "";
      form.dataset.originalId = "";
      ["aereo", "valorDiaria", "transporte", "custoAlteracao"].forEach(function (k) {
        var campo = form.querySelector('[name="' + k + '"]');
        if (campo) campo.value = "0,00";
      });
      var sel = form.querySelector('[name="colaborador"]');
      if (sel) { sel.value = ""; sel.focus(); }
      form.querySelectorAll('[name="lote-nome"]').forEach(function (c) { c.checked = false; });
      form.dataset.alimTocada = "";
      form.dataset.diariasTocada = "";
      recalcular(form);
    }
    return true;
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
    if (confirm(texto)) { C.excluirViagem(id); toast("Viagem #" + id + " excluída"); }
  }

  function destinosConhecidos() {
    var set = {};
    C.db.viagens.forEach(function (v) { if (v.destino) set[v.destino] = 1; });
    return Object.keys(set).sort(C.ordenaPt);
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
        V.campo("UF", '<input type="text" name="uf" value="' + esc(d.uf) + '" maxlength="2">', "c3") +
        V.campo("Aeroporto base", '<input type="text" name="aeroportoBase" value="' + esc(d.aeroportoBase) + '" placeholder="CNF - Confins">', "c4") +
        V.campo("Contrato", V.selectHTML("contrato", ["PJ", "CLT"], d.contrato), "c3") +
        V.campo("Modelo", V.selectHTML("modelo", ["Remoto", "Híbrido", "Presencial"], d.modelo), "c3") +
        V.campo("E-mail", '<input type="text" name="email" value="' + esc(d.email) + '">', "c6") +
        "</div>" +
        '<datalist id="areas">' + C.areas().map(function (a) { return '<option value="' + esc(a) + '">'; }).join("") + "</datalist>" +
        '<datalist id="nomes">' + nomes.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist>" +
        "</form>",
      rodape: '<span class="grow"></span>' +
        (novo ? "" : '<button class="btn btn-danger" data-acao="excluir-colab">Excluir</button>') +
        '<button class="btn" data-acao="fechar">Cancelar</button>' +
        '<button class="btn btn-primary" type="submit" form="form-colab">Salvar</button>',
      estreito: true
    });

    var form = dialogo.querySelector("form");
    var nomeAntigo = d.nome;

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var fd = new FormData(form);
      var nome = (fd.get("nome") || "").trim();
      if (!nome) return;
      var alvo = novo ? { status: "Ativo" } : c;
      ["nome", "area", "cargo", "gestor", "cidade", "uf", "aeroportoBase", "contrato", "modelo", "email"].forEach(function (k) {
        alvo[k] = (fd.get(k) || "").trim();
      });
      if (novo) C.db.colaboradores.push(alvo);
      else if (nomeAntigo && nomeAntigo !== nome) {
        C.db.viagens.forEach(function (v) { if (v.colaborador === nomeAntigo) v.colaborador = nome; });
        C.db.params.dePara.forEach(function (m) { if (m.colaborador === nomeAntigo) m.colaborador = nome; });
      }
      C.salvar();
      toast(novo ? "Colaborador cadastrado" : "Cadastro atualizado");
      dialogo.close();
    });

    var btnExcluir = dialogo.querySelector('[data-acao="excluir-colab"]');
    if (btnExcluir) {
      btnExcluir.addEventListener("click", function () {
        var usos = C.db.viagens.filter(function (v) { return v.colaborador === d.nome; }).length;
        if (usos) { alert("Este colaborador tem " + usos + " viagem(ns) lançada(s). Exclua ou reatribua antes."); return; }
        if (!confirm("Remover " + d.nome + " do cadastro?")) return;
        C.db.colaboradores = C.db.colaboradores.filter(function (x) { return x !== d; });
        C.salvar();
        toast("Colaborador removido");
        dialogo.close();
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
      C.salvar();
      toast("Vínculo salvo — corridas reauditadas");
      dialogo.close();
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

    var r = C.adicionarCorridas(validas);
    caixa.value = "";
    var ignoradas = linhas.length - validas.length;
    toast(r.novas + " corrida(s) importada(s)" +
          (r.repetidas ? " · " + r.repetidas + " repetida(s) ignorada(s)" : "") +
          (ignoradas ? " · " + ignoradas + " linha(s) fora do formato" : ""));
  }

  // ---------- regras ----------

  function salvarRegras() {
    var r = C.db.params.regras;
    r.jantar = C.parseNum(document.querySelector('[name="regra-jantar"]').value);
    r.cafe = C.parseNum(document.querySelector('[name="regra-cafe"]').value);
    r.toleranciaUber = Math.max(0, Math.round(C.parseNum(document.querySelector('[name="regra-tol"]').value)));
    C.salvar();
    toast("Regras salvas — base recalculada");
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
        try {
          var novo = JSON.parse(texto);
          if (!novo.viagens || !novo.colaboradores) throw new Error("formato");
          C.substituirEstado(novo);
          toast("Backup restaurado");
          dialogo.close();
        } catch (e) {
          alert("Não consegui ler esse backup. Confira se é o arquivo .json gerado por este app.");
        }
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
    var bom = tipo === "text/csv" ? "\ufeff" : "";

    if (window.claude && typeof window.claude.use === "function") {
      window.claude.use("downloads").then(function (downloads) {
        if (!downloads) { baixarLocal(nome, bom + conteudo, tipo); return; }
        downloads.save({ filename: nome, data: bom + conteudo }).then(
          function () { toast(nome + " salvo"); },
          function (e) {
            if (e && e.code === "declined") return;
            modalTexto(nome, conteudo);
          }
        );
      }, function () { baixarLocal(nome, bom + conteudo, tipo); });
      return;
    }

    baixarLocal(nome, bom + conteudo, tipo);
  }

  function baixarLocal(nome, conteudo, tipo) {
    if (emIframe()) { modalTexto(nome, conteudo.replace(/^\ufeff/, "")); return; }
    var blob = new Blob([conteudo], { type: tipo + ";charset=utf-8" });
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

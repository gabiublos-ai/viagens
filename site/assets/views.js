/* Telas. Cada função devolve o HTML de uma aba; os eventos são delegados em app.js. */

(function () {
  "use strict";

  var C = window.Core;

  // ---------- utilidades de marcação ----------

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function pessoa(nome, sub) {
    return '<div class="person">' +
      '<span class="avatar" aria-hidden="true">' + esc(C.iniciais(nome)) + "</span>" +
      '<span style="min-width:0"><span class="person-name">' + esc(nome || "—") + "</span>" +
      (sub ? '<span class="t-sub">' + esc(sub) + "</span>" : "") +
      "</span></div>";
  }

  function dinheiro(v, zeroFraco) {
    if (!v && zeroFraco !== false) return '<span class="zero">—</span>';
    return C.moeda(v);
  }

  function chipStatus(status, motivo) {
    var classe = status === "Fechado" ? "ok"
               : status === "Pendente" ? "warn"
               : status === "Cancelado" ? "crit"
               : "accent";
    return '<span class="chip ' + classe + '"' + (motivo ? ' title="' + esc(motivo) + '"' : "") + ">" +
      esc(status) + "</span>";
  }

  function chipsConferencia(v) {
    if (v.ok) return '<span class="chip ok">OK</span>';

    if (v.conferido) {
      var quem = v.conferencia && v.conferencia.por ? " por " + v.conferencia.por : "";
      var quando = v.conferencia && v.conferencia.em
        ? " em " + new Date(v.conferencia.em).toLocaleDateString("pt-BR") : "";
      return '<span class="chip ok" title="' + esc("Conferido" + quem + quando + ": " +
        v.avisos.map(function (a) { return a.texto; }).join(" · ")) + '">✓ Conferido</span>';
    }

    return v.avisos.map(function (a) {
      return '<span class="chip ' + a.nivel + '" title="' + esc(a.texto) + '">⚠ ' + esc(a.curto || a.texto) + "</span>";
    }).join(" ");
  }

  function rota(v) {
    var origem = (v.aeroportoOrigem || "").trim();
    if (!origem) return v.destino ? '<span class="t-sub">' + esc(v.destino) + "</span>" : "";
    var codigo = origem.split(/[\s>-]/)[0].toUpperCase();
    if (codigo.length > 4) codigo = origem.slice(0, 3).toUpperCase();
    return '<span class="route" title="' + esc(origem + " → " + v.destino) + '">' +
      esc(codigo) + " ✈ " + esc(destinoCurto(v.destino)) + "</span>";
  }

  function destinoCurto(destino) {
    var d = String(destino || "").split("/")[0].trim();
    return d.length > 14 ? d.slice(0, 13) + "…" : (d || "—");
  }

  function selectHTML(nome, opcoes, valor, extra) {
    return '<select name="' + nome + '" ' + (extra || "") + ">" +
      opcoes.map(function (o) {
        var val = typeof o === "string" ? o : o.v;
        var rot = typeof o === "string" ? o : o.r;
        return '<option value="' + esc(val) + '"' + (String(val) === String(valor) ? " selected" : "") + ">" + esc(rot) + "</option>";
      }).join("") + "</select>";
  }

  function kpi(rotulo, valor, nota, pequeno) {
    return '<div class="kpi"><span class="eyebrow">' + esc(rotulo) + "</span>" +
      '<span class="kpi-value' + (pequeno ? " sm" : "") + '">' + valor + "</span>" +
      (nota ? '<span class="kpi-note">' + nota + "</span>" : "") + "</div>";
  }

  function vazio(titulo, texto) {
    return '<div class="empty"><strong>' + esc(titulo) + "</strong>" + esc(texto || "") + "</div>";
  }

  // ---------- gráficos ----------

  var CORES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)"];

  /**
   * Barras empilhadas mês a mês. series = [{nome, cor, valores: []}], rotulos = eixo X.
   * Fatias com 2px de folga entre si, extremidade arredondada só no topo da pilha.
   */
  function barrasEmpilhadas(rotulos, series, alturaBarra) {
    var L = 52, R = 8, T = 10, B = 26;
    var W = 1000, H = (alturaBarra || 190) + T + B;
    var plotW = W - L - R, plotH = H - T - B;

    var totais = rotulos.map(function (_, i) {
      return series.reduce(function (s, se) { return s + (se.valores[i] || 0); }, 0);
    });
    var max = Math.max.apply(null, totais.concat([1]));
    var passo = escala(max);
    var topo = Math.ceil(max / passo) * passo || passo;

    var largura = plotW / rotulos.length;
    var barW = Math.min(46, largura * 0.56);

    var svg = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" ' +
      'aria-label="Custo mensal por categoria" style="height:' + H + 'px">';

    for (var g = 0; g <= topo; g += passo) {
      var y = T + plotH - (g / topo) * plotH;
      svg += '<line class="grid-line" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/>';
      svg += '<text x="' + (L - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11">' + esc(C.brlCurto(g)) + "</text>";
    }

    rotulos.forEach(function (rot, i) {
      var cx = L + largura * i + largura / 2;
      var y = T + plotH;
      series.forEach(function (se) {
        var v = se.valores[i] || 0;
        if (v <= 0) return;
        var h = (v / topo) * plotH;
        var altura = Math.max(1, h - 2); // 2px de respiro entre fatias
        y -= h;
        svg += '<rect class="bar" x="' + (cx - barW / 2) + '" y="' + y + '" width="' + barW +
          '" height="' + altura + '" rx="2" fill="' + se.cor + '" ' +
          'data-tip="' + esc(rot + " · " + se.nome + "|" + C.brlSigla(v)) + '"/>';
      });
      svg += '<text x="' + cx + '" y="' + (T + plotH + 17) + '" text-anchor="middle" font-size="11">' + esc(rot) + "</text>";
    });

    svg += '<line class="axis-line" x1="' + L + '" x2="' + (W - R) + '" y1="' + (T + plotH) + '" y2="' + (T + plotH) + '"/>';
    svg += "</svg>";
    return svg;
  }

  function escala(max) {
    var bruto = max / 4;
    var mag = Math.pow(10, Math.floor(Math.log10(bruto || 1)));
    var n = bruto / mag;
    return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * mag;
  }

  /** Barras horizontais com rótulo direto — para rankings. */
  function barrasHorizontais(itens) {
    if (!itens.length) return vazio("Sem dados", "");
    var max = Math.max.apply(null, itens.map(function (i) { return i.valor; }).concat([1]));
    return '<div style="display:flex;flex-direction:column;gap:9px">' + itens.map(function (i) {
      var pct = Math.max(1, (i.valor / max) * 100);
      return '<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;align-items:center">' +
        '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(i.nome) +
        (i.sub ? ' <span class="t-sub">' + esc(i.sub) + "</span>" : "") + "</span>" +
        '<span class="num" style="font-size:12.5px">' + C.moeda(i.valor) + "</span>" +
        '<span style="grid-column:1/-1;height:7px;background:var(--surface-2);border-radius:3px;overflow:hidden">' +
        '<span style="display:block;height:100%;width:' + pct + '%;background:var(--s1);border-radius:3px"></span></span>' +
        "</div>";
    }).join("") + "</div>";
  }

  function legenda(series) {
    return '<div class="legend">' + series.map(function (s) {
      return '<span class="legend-item"><span class="legend-swatch" style="background:' + s.cor + '"></span>' + esc(s.nome) + "</span>";
    }).join("") + "</div>";
  }

  // ---------- aba: painel ----------

  function painel(estado) {
    var ano = estado.ano;
    var r = C.resumoAnual(ano);
    var uber = C.resumoUber(ano);
    var pessoas = C.porColaborador(ano);
    var mesesAtivos = r.meses.filter(function (m) { return r.totalMes[m] > 0; });

    var series = r.categorias.map(function (cat, i) {
      return { nome: cat, cor: CORES[i % CORES.length], valores: r.meses.map(function (m) { return r.porCategoria[cat][m]; }) };
    }).filter(function (s) { return s.valores.some(function (v) { return v > 0; }); });

    var mediaPessoa = r.pessoas ? r.totalAno / r.pessoas : 0;
    var mediaViagem = r.nViagens ? r.totalViagens / r.nViagens : 0;
    var avisos = C.viagens().filter(function (v) { return C.anoDe(v.mesRef) === String(ano) && v.precisaConferir; });

    var html = "";

    html += '<div class="kpis">' +
      kpi("Custo total " + ano, C.moeda(r.totalAno),
          r.nViagens + " viagens · " + r.noites + " pernoites") +
      kpi("Viagens (sem Uber)", C.moeda(r.totalViagens),
          "Média de " + C.brlSigla(mediaViagem) + " por viagem") +
      kpi("Uber corporativo", C.moeda(r.totalUber),
          (r.totalAno ? C.brl(r.totalUber / r.totalAno * 100, 0) : "0") + "% do custo total · " + uber.n + " corridas") +
      kpi("Colaboradores com despesa", String(r.pessoas),
          "Média de " + C.brlSigla(mediaPessoa) + " por pessoa") +
      "</div>";

    if (avisos.length) {
      html += '<div class="note warn"><strong>' + avisos.length + " lançamento" + (avisos.length > 1 ? "s pedem" : " pede") +
        " conferência.</strong> " +
        '<a href="#" data-ir="viagens" data-filtro="avisos" style="color:inherit">Ver na lista de viagens →</a></div>';
    }

    html += '<div class="card">' +
      '<div class="card-head"><h2>Custo mensal por categoria</h2><span class="grow"></span>' +
      '<span class="eyebrow">' + esc(ano) + "</span></div>" +
      '<div class="card-body">' + barrasEmpilhadas(r.meses.map(C.mesRotulo), series) + "</div>" +
      legenda(series) + "</div>";

    // Matriz categoria × mês (só meses com movimento, para caber na tela)
    html += '<div class="card"><div class="card-head"><h2>Composição por categoria</h2>' +
      '<span class="grow"></span><span class="t-sub">Meses com movimento</span></div>' +
      '<div class="card-body flush"><div class="table-wrap"><table><thead><tr>' +
      "<th>Categoria</th>" + mesesAtivos.map(function (m) { return '<th class="n">' + esc(C.mesRotulo(m)) + "</th>"; }).join("") +
      '<th class="n">Total ano</th><th class="n">%</th></tr></thead><tbody>' +
      r.categorias.map(function (cat, i) {
        // Guarda a cor pela posição original, para bater com a do gráfico.
        return { cat: cat, cor: CORES[i % CORES.length],
                 total: mesesAtivos.reduce(function (s, m) { return s + r.porCategoria[cat][m]; }, 0) };
      }).filter(function (l) { return l.total > 0; })
        .sort(function (a, b) { return b.total - a.total; })
        .map(function (linha) {
        var cat = linha.cat, totalCat = linha.total;
        return "<tr><td><span class='legend-swatch' style='display:inline-block;background:" + linha.cor +
          ";margin-right:7px'></span>" + esc(cat) + "</td>" +
          mesesAtivos.map(function (m) {
            var v = r.porCategoria[cat][m];
            return '<td class="n' + (v ? "" : " zero") + '">' + (v ? C.moeda(v) : "—") + "</td>";
          }).join("") +
          '<td class="n">' + C.moeda(totalCat) + "</td>" +
          '<td class="n">' + (r.totalAno ? C.brl(totalCat / r.totalAno * 100, 0) : "0") + "%</td></tr>";
      }).join("") +
      "</tbody><tfoot><tr><td>TOTAL</td>" +
      mesesAtivos.map(function (m) { return '<td class="n">' + C.moeda(r.totalMes[m]) + "</td>"; }).join("") +
      '<td class="n">' + C.moeda(r.totalAno) + '</td><td class="n">100%</td></tr>' +
      '<tr><td class="t-sub">Colaboradores no mês</td>' +
      mesesAtivos.map(function (m) { return '<td class="n t-sub">' + Object.keys(r.pessoasMes[m]).length + "</td>"; }).join("") +
      '<td class="n t-sub">' + r.pessoas + '</td><td></td></tr></tfoot></table></div></div></div>';

    // Área × mês
    var areasComGasto = Object.keys(r.porArea).filter(function (a) {
      return mesesAtivos.some(function (m) { return r.porArea[a][m] > 0; });
    }).sort(function (a, b) {
      var ta = mesesAtivos.reduce(function (s, m) { return s + r.porArea[a][m]; }, 0);
      var tb = mesesAtivos.reduce(function (s, m) { return s + r.porArea[b][m]; }, 0);
      return tb - ta;
    });

    html += '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">';

    html += '<div class="card"><div class="card-head"><h2>Custo por área</h2></div>' +
      '<div class="card-body flush"><div class="table-wrap"><table><thead><tr><th>Área</th>' +
      mesesAtivos.map(function (m) { return '<th class="n">' + esc(C.mesRotulo(m)) + "</th>"; }).join("") +
      '<th class="n">Total</th></tr></thead><tbody>' +
      areasComGasto.map(function (a) {
        var t = mesesAtivos.reduce(function (s, m) { return s + r.porArea[a][m]; }, 0);
        return "<tr><td>" + esc(a) + "</td>" +
          mesesAtivos.map(function (m) {
            var v = r.porArea[a][m];
            return '<td class="n' + (v ? "" : " zero") + '">' + (v ? C.moeda(v) : "—") + "</td>";
          }).join("") + '<td class="n">' + C.moeda(t) + "</td></tr>";
      }).join("") + "</tbody></table></div></div></div>";

    html += '<div class="card"><div class="card-head"><h2>Top 10 colaboradores</h2>' +
      '<span class="grow"></span><button class="btn btn-sm" data-ir="equipe">Ver todos</button></div>' +
      '<div class="card-body">' + barrasHorizontais(pessoas.slice(0, 10).map(function (p) {
        return { nome: p.nome, sub: p.viagens + (p.viagens === 1 ? " viagem" : " viagens"), valor: p.total };
      })) + "</div></div>";

    html += "</div>";
    return html;
  }

  // ---------- aba: viagens ----------

  /**
   * Coloca cada alteração logo abaixo da reserva que ela altera, em vez de
   * deixá-la solta na ordem geral. Marca em `mesGrupo` o mês em que a linha
   * conta: a alteração acompanha o mês da viagem original, senão o divisor de
   * mês quebraria no meio do bloco. Quando a viagem original ficou fora do
   * filtro, a alteração continua onde a ordenação a colocou.
   */
  function juntaAlteracoes(lista) {
    var filhas = {};
    lista.forEach(function (v) { if (v.tipo !== "Alteração") filhas[v.id] = []; });

    var soltas = lista.filter(function (v) {
      if (v.tipo === "Alteração" && filhas[v.refId]) { filhas[v.refId].push(v); return false; }
      v.presaA = 0;
      return true;
    });

    var ordenada = [];
    soltas.forEach(function (v) {
      v.mesGrupo = v.mesRef;
      ordenada.push(v);
      (filhas[v.id] || []).sort(function (a, b) { return a.id - b.id; }).forEach(function (alt) {
        alt.mesGrupo = v.mesRef;
        alt.presaA = v.id;
        ordenada.push(alt);
      });
    });
    return ordenada;
  }

  function viagensView(estado) {
    var f = estado.filtros;
    var lista = C.viagens();

    if (f.ano) lista = lista.filter(function (v) { return C.anoDe(v.mesRef) === f.ano; });
    if (f.mes) lista = lista.filter(function (v) { return v.mesRef === f.mes; });
    if (f.area) lista = lista.filter(function (v) { return v.area === f.area; });
    if (f.status) lista = lista.filter(function (v) { return v.status === f.status; });
    if (f.tipo) lista = lista.filter(function (v) { return v.tipo === f.tipo; });
    if (f.avisos) lista = lista.filter(function (v) { return v.precisaConferir; });
    if (f.busca) {
      var q = C.normal(f.busca);
      lista = lista.filter(function (v) {
        return C.normal([v.colaborador, v.destino, v.area, v.obs, v.aeroportoOrigem, v.motivo, "#" + v.id].join(" ")).indexOf(q) > -1;
      });
    }

    var ordem = f.ordem || "data-desc";
    lista.sort(function (a, b) {
      switch (ordem) {
        case "data-asc": return (a.dataIda || "").localeCompare(b.dataIda || "") || a.id - b.id;
        case "total-desc": return b.total - a.total;
        case "nome": return C.ordenaPt(a.colaborador, b.colaborador) || (a.dataIda || "").localeCompare(b.dataIda || "");
        case "id-desc": return b.id - a.id;
        default: return (b.dataIda || "").localeCompare(a.dataIda || "") || b.id - a.id;
      }
    });

    var soma = lista.reduce(function (s, v) { return s + v.total; }, 0);
    var noites = lista.reduce(function (s, v) { return s + v.noites; }, 0);

    lista = juntaAlteracoes(lista);

    var meses = C.mesesComDados();
    var html = "";

    html += '<div class="card"><div class="card-head">' +
      '<h2>Viagens</h2>' +
      '<span class="chip">' + lista.length + " lançamento" + (lista.length === 1 ? "" : "s") + "</span>" +
      '<span class="grow"></span>' +
      '<button class="btn btn-sm" data-acao="registrar-alteracao">Registrar alteração</button>' +
      '<button class="btn btn-sm" data-acao="importar-viagens">Importar planilha</button>' +
      '<button class="btn btn-sm" data-acao="exportar-viagens">Exportar CSV</button>' +
      '<button class="btn btn-primary btn-sm" data-acao="nova-viagem">+ Nova viagem</button>' +
      "</div>" +
      '<div class="card-body" style="border-bottom:1px solid var(--border)">' +
      '<div class="toolbar">' +
      '<input type="search" class="search" name="busca" placeholder="Buscar pessoa, destino, observação…" value="' + esc(f.busca || "") + '">' +
      selectHTML("mes", [{ v: "", r: "Todos os meses" }].concat(meses.map(function (m) { return { v: m, r: C.mesRotulo(m) }; })), f.mes) +
      selectHTML("area", [{ v: "", r: "Todas as áreas" }].concat(C.areas()), f.area) +
      selectHTML("status", [{ v: "", r: "Todos os status" }].concat(C.db.params.statuses), f.status) +
      selectHTML("tipo", [{ v: "", r: "Viagens e alterações" }, "Viagem", "Alteração"], f.tipo) +
      selectHTML("ordem", [
        { v: "data-desc", r: "Mais recentes primeiro" },
        { v: "data-asc", r: "Mais antigas primeiro" },
        { v: "total-desc", r: "Maior custo" },
        { v: "nome", r: "Colaborador (A–Z)" },
        { v: "id-desc", r: "Último lançado" }
      ], ordem) +
      '<label class="chip" style="cursor:pointer;gap:6px"><input type="checkbox" name="avisos" style="width:auto"' +
      (f.avisos ? " checked" : "") + "> Só pendentes de conferência</label>" +
      (temFiltro(f) ? '<button class="btn btn-ghost btn-sm" data-acao="limpar-filtros">Limpar filtros</button>' : "") +
      "</div></div>";

    if (!lista.length) {
      html += vazio("Nenhuma viagem encontrada", "Ajuste os filtros ou lance uma viagem nova.") + "</div>";
      return html;
    }

    html += '<div class="card-body flush"><div class="table-wrap"><table class="compacta"><thead><tr>' +
      '<th class="fix1">ID</th><th class="fix2">Colaborador</th><th class="fix3">Trecho e período</th>' +
      '<th class="n">Aéreo</th><th class="n">Hospedagem</th><th class="n">Alimentação</th><th class="n">Outros</th>' +
      '<th class="n">Total</th><th>Status</th><th>Conferência</th><th class="col-acoes"></th></tr></thead><tbody>';

    var mesAtual = null;
    var agrupar = ordem === "data-desc" || ordem === "data-asc";

    lista.forEach(function (v) {
      if (agrupar && v.mesGrupo !== mesAtual) {
        mesAtual = v.mesGrupo;
        var doMes = lista.filter(function (x) { return x.mesGrupo === mesAtual; });
        var totalMes = doMes.reduce(function (s, x) { return s + x.total; }, 0);
        html += '<tr><td colspan="11" style="background:var(--surface-2);padding:6px 10px">' +
          '<span class="mes-divisor"><span class="eyebrow">' + esc(C.mesNome(mesAtual)) + "</span> " +
          '<span class="t-sub">· ' + doMes.length + " lançamentos · " + C.brlSigla(totalMes) + "</span></span></td></tr>";
      }

      var outros = (Number(v.transporte) || 0) + (Number(v.custoAlteracao) || 0);
      html += '<tr data-id="' + v.id + '"' +
        (v.tipo === "Alteração" ? ' class="row-alt' + (v.presaA ? " row-presa" : "") + '"' : "") + ">" +
        '<td class="num t-sub nowrap fix1">' + (v.tipo === "Alteração" ? "↳ " : "") + v.id + "</td>" +
        '<td class="fix2">' + pessoa(v.colaborador, v.area) + "</td>" +
        '<td class="fix3">' + rota(v) +
        (v.tipo === "Alteração"
          ? ' <span class="chip warn" title="' + esc(v.motivo || "") + '">' +
            esc(v.tipoAlteracao || "Alteração") + (v.presaA ? "" : " de #" + esc(v.refId)) + "</span>"
          : "") +
        '<span class="t-sub periodo"><span class="num">' + C.fmtDataCurta(v.dataIda) + " → " + C.fmtDataCurta(v.dataVolta) +
        "</span> · " + v.noites + (v.noites === 1 ? " noite" : " noites") + "</span></td>" +
        '<td class="n">' + dinheiro(v.aereo) + "</td>" +
        '<td class="n">' + dinheiro(v.hospedagem) +
        (v.porNoite ? '<br><span class="t-sub">' + C.moeda(v.porNoite) + "/noite</span>" : "") + "</td>" +
        '<td class="n">' + dinheiro(v.alimentacao) +
        (v.cafeIncluso ? '<br><span class="t-sub" title="Hospedagem com café da manhã: só o jantar é devido">café incluso</span>' : "") +
        (v.difAlim ? '<br><span class="t-sub" style="color:var(--' + (v.difAlim < 0 ? "critical" : "warning") + ')">' +
          (v.difAlim > 0 ? "+" : "") + C.moeda(v.difAlim) + "</span>" : "") + "</td>" +
        '<td class="n">' + dinheiro(outros) + "</td>" +
        '<td class="n"><strong>' + C.moeda(v.total) + "</strong></td>" +
        "<td>" + chipStatus(v.status, v.status === "Cancelado" ? v.motivo : "") + "</td>" +
        "<td>" + chipsConferencia(v) + "</td>" +
        '<td class="col-acoes"><div class="actions-cell">' +
        (v.tipo === "Alteração" || v.cancelada ? "" : botaoIcone("cancelar", v.id,
           "Cancelar a viagem — informa o motivo e o que aconteceu com os custos",
           '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>')) +
        (v.ok ? "" : botaoIcone(v.conferido ? "desvalidar" : "validar", v.id,
           v.conferido ? "Desfazer a conferência" : "Validar a conferência — para de aparecer como alerta",
           v.conferido ? '<path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/>'
                       : '<path d="M20 6 9 17l-5-5"/>')) +
        botaoIcone("editar", v.id, "Editar", '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>') +
        botaoIcone("alteracao", v.id, "Registrar alteração", '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>') +
        botaoIcone("duplicar", v.id, "Duplicar", '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>') +
        botaoIcone("excluir", v.id, "Excluir", '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>') +
        "</div></td></tr>";
    });

    html += '</tbody><tfoot><tr><td class="fix1"></td><td class="fix2">' + lista.length + " lançamentos</td>" +
      '<td class="fix3">' + noites + " pernoites</td>" +
      '<td class="n">' + C.moeda(lista.reduce(function (s, v) { return s + (Number(v.aereo) || 0); }, 0)) + "</td>" +
      '<td class="n">' + C.moeda(lista.reduce(function (s, v) { return s + v.hospedagem; }, 0)) + "</td>" +
      '<td class="n">' + C.moeda(lista.reduce(function (s, v) { return s + (Number(v.alimentacao) || 0); }, 0)) + "</td>" +
      '<td class="n">' + C.moeda(lista.reduce(function (s, v) { return s + (Number(v.transporte) || 0) + (Number(v.custoAlteracao) || 0); }, 0)) + "</td>" +
      '<td class="n">' + C.moeda(soma) + '</td><td colspan="2"></td><td class="col-acoes"></td></tr></tfoot></table></div></div></div>';

    return html;
  }

  function temFiltro(f) {
    return !!(f.busca || f.mes || f.area || f.status || f.tipo || f.avisos);
  }

  function botaoIcone(acao, id, titulo, caminho) {
    return '<button class="icon-btn" data-acao="' + acao + '" data-id="' + id + '" title="' + esc(titulo) + '" aria-label="' + esc(titulo) + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      caminho + "</svg></button>";
  }

  // ---------- aba: calendário ----------

  function calendarioView(estado) {
    var meses = C.mesesComDados();
    var mes = estado.mesCal && meses.indexOf(estado.mesCal) > -1 ? estado.mesCal : (meses[meses.length - 1] || C.mesRefDe(C.toISO(new Date())));
    var cal = C.calendario(mes);

    var html = '<div class="card"><div class="card-head"><h2>Calendário de ' + esc(C.mesNome(mes)) + "</h2>" +
      '<span class="grow"></span>' +
      '<span class="legend-item"><span class="cal-mark go" style="width:18px">▶</span> ida</span>' +
      '<span class="legend-item"><span class="cal-mark stay" style="width:18px">■</span> em viagem</span>' +
      '<span class="legend-item"><span class="cal-mark back" style="width:18px">◀</span> retorno</span>' +
      selectHTML("mesCal", meses.map(function (m) { return { v: m, r: C.mesNome(m) }; }), mes, 'aria-label="Mês do calendário"') +
      "</div>";

    if (!cal.linhas.length) {
      return html + vazio("Ninguém em viagem neste mês", "") + "</div>";
    }

    var dias = [];
    for (var d = 1; d <= cal.nDias; d++) dias.push(d);

    html += '<div class="card-body flush"><div class="table-wrap"><table class="cal"><thead><tr>' +
      '<th class="name-col">Colaborador</th>' +
      dias.map(function (d) {
        var wd = new Date(cal.ano, cal.mes - 1, d).getDay();
        return '<th class="day' + (wd === 0 || wd === 6 ? " wknd" : "") + '">' + d + "</th>";
      }).join("") +
      '<th class="n">Dias fora</th></tr></thead><tbody>';

    cal.linhas.forEach(function (l) {
      var noites = 0;
      html += '<tr><td class="name-col">' + pessoa(l.nome, l.area) + "</td>" +
        dias.map(function (d) {
          var wd = new Date(cal.ano, cal.mes - 1, d).getDay();
          var m = l.dias[d];
          if (m) noites++;
          var simbolo = m === "go" ? "▶" : m === "back" ? "◀" : "■";
          return '<td class="day' + (wd === 0 || wd === 6 ? " wknd" : "") + '">' +
            (m ? '<span class="cal-mark ' + m + '">' + simbolo + "</span>" : "") + "</td>";
        }).join("") +
        '<td class="n">' + noites + "</td></tr>";
    });

    html += "</tbody></table></div></div></div>";
    return html;
  }

  // ---------- aba: uber ----------

  function uberView(estado) {
    var ano = estado.ano;
    var u = C.resumoUber(ano);
    var todas = C.corridas();
    var f = estado.uberFiltros;

    var lista = todas.slice();
    if (f.mes) lista = lista.filter(function (c) { return c.mesRef === f.mes; });
    if (f.situacao) lista = lista.filter(function (c) { return c.auditoria.situacao === f.situacao; });
    if (f.busca) {
      var q = C.normal(f.busca);
      lista = lista.filter(function (c) {
        return C.normal([c.colaborador, c.nomeRelatorio, c.cidade, c.origem, c.destino, c.servico].join(" ")).indexOf(q) > -1;
      });
    }
    lista.sort(function (a, b) { return (b.data || "").localeCompare(a.data || ""); });

    var html = "";

    html += '<div class="kpis">' +
      kpi("Gasto no período", C.moeda(u.total), u.n + " corridas") +
      kpi("Ticket médio", C.moeda(u.ticket), "Corrida mais cara: " + C.brlSigla(u.maiorValor)) +
      kpi("De/para aeroporto", C.brl(u.pctAeroporto * 100, 0) + "%", u.aeroporto + " de " + u.n + " corridas") +
      kpi("Corridas acima de R$ 150", String(u.acima150), C.brlSigla(u.valorAcima150) + " concentrados") +
      "</div>";

    if (u.desconhecidos.length) {
      html += '<div class="note warn"><strong>' + u.desconhecidos.length +
        " nome" + (u.desconhecidos.length > 1 ? "s não reconhecidos" : " não reconhecido") + " no relatório.</strong> " +
        u.desconhecidos.map(function (d) {
          return '<button class="btn btn-sm" data-acao="mapear" data-nome="' + esc(d.nome) + '">' +
            esc(d.nome) + " (" + d.n + ") → cadastrar</button>";
        }).join(" ") + "</div>";
    }

    html += '<div class="card"><div class="card-head"><h2>Importar relatório do Uber Business</h2>' +
      '<span class="grow"></span><span class="t-sub">' + todas.length + " linhas na base</span></div>" +
      '<div class="card-body grid" style="gap:10px">' +
      '<div class="note">Exporte o CSV de transações no Uber Business, abra no <strong>Bloco de Notas</strong> ' +
      "(não no Excel — ele converte datas e valores errado), copie só as linhas de transação e cole abaixo. " +
      "Linhas repetidas são ignoradas automaticamente.</div>" +
      '<textarea name="colar-uber" rows="4" placeholder="05/24/2026;7:10AM;Nome;Sobrenome;--;Travel | UberX;Sao Paulo;origem;destino;Fare;66,31;66,31"></textarea>' +
      '<div class="row"><button class="btn btn-primary" data-acao="importar-uber">Importar linhas coladas</button>' +
      '<button class="btn" data-acao="exportar-uber">Exportar CSV</button>' +
      '<span class="grow"></span>' +
      '<button class="btn btn-ghost btn-sm btn-danger" data-acao="limpar-uber">Limpar base do Uber</button></div>' +
      "</div></div>";

    // Evolução mensal + serviços
    var mesesU = Object.keys(u.porMes).sort();
    html += '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(400px,1fr))">';

    html += '<div class="card"><div class="card-head"><h2>Evolução mensal</h2></div>' +
      '<div class="card-body flush"><div class="table-wrap"><table><thead><tr><th>Mês</th>' +
      '<th class="n">Corridas</th><th class="n">Valor</th><th class="n">Ticket</th><th class="n">Aeroporto</th>' +
      "</tr></thead><tbody>" +
      mesesU.map(function (m) {
        var d = u.porMes[m];
        return "<tr><td>" + esc(C.mesRotulo(m)) + '</td><td class="n">' + d.n + "</td>" +
          '<td class="n">' + C.moeda(d.valor) + '</td><td class="n">' + (d.n ? C.moeda(d.valor / d.n) : "—") + "</td>" +
          '<td class="n">' + (d.n ? C.brl(d.aeroporto / d.n * 100, 0) + "%" : "—") + "</td></tr>";
      }).join("") + "</tbody></table></div></div></div>";

    html += '<div class="card"><div class="card-head"><h2>Por categoria de serviço</h2></div>' +
      '<div class="card-body flush"><div class="table-wrap"><table><thead><tr><th>Serviço</th>' +
      '<th class="n">Corridas</th><th class="n">Valor</th><th class="n">Ticket</th></tr></thead><tbody>' +
      u.porServico.map(function (s) {
        return "<tr><td>" + esc(s.nome) + '</td><td class="n">' + s.n + "</td>" +
          '<td class="n">' + C.moeda(s.valor) + '</td><td class="n">' + (s.n ? C.moeda(s.valor / s.n) : "—") + "</td></tr>";
      }).join("") + "</tbody></table></div></div></div>";

    html += '</div><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(400px,1fr))">';

    html += '<div class="card"><div class="card-head"><h2>Por cidade</h2></div>' +
      '<div class="card-body">' + barrasHorizontais(u.porCidade.slice(0, 10).map(function (c) {
        return { nome: c.nome, sub: c.n + " corridas", valor: c.valor };
      })) + "</div></div>";

    html += '<div class="card"><div class="card-head"><h2>Pontos de atenção</h2></div>' +
      '<div class="card-body flush"><div class="table-wrap"><table><tbody>' +
      linhaAtencao("Corridas acima de R$ 150", u.acima150 + " · " + C.brlSigla(u.valorAcima150), "Revisar necessidade e possibilidade de compartilhamento") +
      linhaAtencao("Corridas urbanas (sem trecho de aeroporto)", String(u.urbanas), "Deslocamentos dentro da cidade") +
      linhaAtencao("Multa por atraso de pagamento", C.brlSigla(u.multas), "Custo 100% evitável — ajustar o vencimento da fatura") +
      linhaAtencao("Gorjetas", C.brlSigla(u.gorjetas), "Definir se a política corporativa cobre gorjeta") +
      linhaAtencao("Ajustes e estornos", C.brlSigla(u.ajustes), "Créditos devolvidos pela Uber") +
      "</tbody></table></div></div></div>";

    html += "</div>";

    // Tabela de corridas
    html += '<div class="card"><div class="card-head"><h2>Corridas</h2>' +
      '<span class="chip">' + lista.length + '</span><span class="grow"></span>' +
      '<div class="toolbar">' +
      '<input type="search" class="search" name="busca-uber" placeholder="Buscar pessoa, cidade, endereço…" value="' + esc(f.busca || "") + '">' +
      selectHTML("mes-uber", [{ v: "", r: "Todos os meses" }].concat(mesesU.map(function (m) { return { v: m, r: C.mesRotulo(m) }; })), f.mes) +
      selectHTML("situacao-uber", [
        { v: "", r: "Toda a auditoria" }, { v: "ok", r: "OK" },
        { v: "fora", r: "⚠ Fora do período" }, { v: "sem-viagem", r: "⚠ Sem viagem registrada" },
        { v: "na", r: "n/a (encargos)" }, { v: "sem-data", r: "Sem data" }
      ], f.situacao) + "</div></div>";

    if (!lista.length) {
      html += vazio("Nenhuma corrida encontrada", "") + "</div>";
      return html;
    }

    html += '<div class="card-body flush"><div class="table-wrap"><table><thead><tr>' +
      "<th>Data</th><th>Colaborador</th><th>Serviço</th><th>Trajeto</th>" +
      '<th class="n">Valor</th><th>Auditoria</th><th>Alerta</th><th class="col-acoes"></th></tr></thead><tbody>' +
      lista.slice(0, 400).map(function (c) {
        var aud = c.auditoria;
        var classe = aud.situacao === "ok" ? "ok" : aud.situacao === "na" || aud.situacao === "sem-data" ? "" : "warn";
        return "<tr>" +
          '<td class="nowrap"><span class="num">' + (c.data ? C.fmtData(c.data) : "—") + "</span>" +
          (c.hora ? '<br><span class="t-sub">' + esc(c.hora) + "</span>" : "") + "</td>" +
          "<td>" + (c.colaborador ? pessoa(c.colaborador, c.area)
            : '<span class="chip crit">⚠ incluir no De-Para</span><br><span class="t-sub">' + esc(c.nomeRelatorio || "—") + "</span>") + "</td>" +
          "<td>" + esc(c.servico || "—") + '<br><span class="t-sub">' + esc(c.cidade || "") + "</span></td>" +
          '<td style="max-width:280px"><span class="t-sub">' + esc(encurta(c.origem)) + " → " + esc(encurta(c.destino)) + "</span>" +
          (c.aeroporto ? ' <span class="chip accent">aeroporto</span>' : "") + "</td>" +
          '<td class="n">' + C.moeda(c.valor) + (c.tipo !== "Fare" ? '<br><span class="t-sub">' + esc(c.tipo) + "</span>" : "") + "</td>" +
          '<td><span class="chip ' + classe + '">' + (classe === "warn" ? "⚠ " : "") + esc(aud.texto) + "</span></td>" +
          '<td class="t-sub">' + esc(c.alerta) + "</td>" +
          '<td class="col-acoes"><div class="actions-cell">' +
          botaoIcone("excluir-corrida", c.indice, "Excluir corrida", '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>') +
          "</div></td></tr>";
      }).join("") + "</tbody></table></div>" +
      (lista.length > 400 ? '<div class="card-body t-sub">Mostrando as 400 corridas mais recentes de ' + lista.length + ".</div>" : "") +
      "</div></div>";

    return html;
  }

  function linhaAtencao(rotulo, valor, comentario) {
    return "<tr><td>" + esc(rotulo) + '</td><td class="n">' + esc(valor) +
      '</td><td class="t-sub">' + esc(comentario) + "</td></tr>";
  }

  function encurta(endereco) {
    var s = String(endereco || "—").split(" - ")[0];
    return s.length > 34 ? s.slice(0, 33) + "…" : s;
  }

  // ---------- aba: equipe ----------

  function equipeView(estado) {
    var ano = estado.ano;
    var gasto = {};
    C.porColaborador(ano).forEach(function (l) { gasto[l.nome] = l; });

    var lista = C.colaboradoresOrdenados();
    var f = estado.equipeFiltros;
    if (f.area) lista = lista.filter(function (c) { return c.area === f.area; });
    if (f.busca) {
      var q = C.normal(f.busca);
      lista = lista.filter(function (c) {
        return C.normal([c.nome, c.cargo, c.area, c.cidade, c.gestor, c.email].join(" ")).indexOf(q) > -1;
      });
    }

    var html = '<div class="card"><div class="card-head"><h2>Equipe</h2>' +
      '<span class="chip">' + lista.length + ' pessoas</span><span class="grow"></span>' +
      '<div class="toolbar">' +
      '<input type="search" class="search" name="busca-equipe" placeholder="Buscar nome, cargo, cidade…" value="' + esc(f.busca || "") + '">' +
      selectHTML("area-equipe", [{ v: "", r: "Todas as áreas" }].concat(C.areas()), f.area) +
      '<button class="btn btn-primary btn-sm" data-acao="novo-colaborador">+ Colaborador</button></div></div>' +
      '<div class="card-body flush"><div class="table-wrap"><table><thead><tr>' +
      "<th>Colaborador</th><th>Cargo</th><th>Gestor direto</th><th>Base</th>" +
      '<th class="n">Viagens ' + esc(ano) + '</th><th class="n">Pernoites</th><th class="n">Custo ' + esc(ano) + '</th><th class="col-acoes"></th>' +
      "</tr></thead><tbody>";

    lista.forEach(function (c) {
      var g = gasto[c.nome];
      html += '<tr data-nome="' + esc(c.nome) + '">' +
        "<td>" + pessoa(c.nome, c.area) + "</td>" +
        "<td>" + esc(c.cargo || "—") + '<br><span class="t-sub">' + esc(c.contrato || "") + " · " + esc(c.modelo || "") + "</span></td>" +
        "<td>" + esc(c.gestor || "—") + "</td>" +
        "<td>" + esc(c.cidade || "—") + (c.uf ? "/" + esc(c.uf) : "") +
        (c.aeroportoBase ? '<br><span class="route">' + esc(c.aeroportoBase) + "</span>" : "") + "</td>" +
        '<td class="n">' + (g ? g.viagens : '<span class="zero">—</span>') + "</td>" +
        '<td class="n">' + (g && g.noites ? g.noites : '<span class="zero">—</span>') + "</td>" +
        '<td class="n">' + (g ? "<strong>" + C.moeda(g.total) + "</strong>" : '<span class="zero">—</span>') + "</td>" +
        '<td class="col-acoes"><div class="actions-cell">' +
        '<button class="icon-btn" data-acao="nova-viagem-para" data-nome="' + esc(c.nome) + '" title="Lançar viagem para ' + esc(c.nome) + '" aria-label="Lançar viagem">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>' +
        '<button class="icon-btn" data-acao="editar-colaborador" data-nome="' + esc(c.nome) + '" title="Editar cadastro" aria-label="Editar cadastro">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>' +
        "</div></td></tr>";
    });

    html += "</tbody></table></div></div></div>";

    // Quebra por categoria
    var pc = C.porColaborador(ano);
    if (pc.length) {
      var ordem = estado.custoOrdem || { campo: "total", desc: true };
      pc.sort(function (a, b) {
        var x = a[ordem.campo], y = b[ordem.campo];
        var r = typeof x === "string" ? C.ordenaPt(x, y) : (x - y);
        return ordem.desc ? -r : r;
      });

      function colunaOrdenavel(rotulo, campo, numerica) {
        var ativa = ordem.campo === campo;
        return '<th class="' + (numerica ? "n " : "") + 'ord' + (ativa ? " ord-ativa" : "") +
          '" data-ordenar="' + campo + '" title="Ordenar por ' + esc(rotulo) + '">' +
          esc(rotulo) + '<span class="ord-seta">' + (ativa ? (ordem.desc ? "▼" : "▲") : "") + "</span></th>";
      }

      html += '<div class="card"><div class="card-head"><h2>Custo por colaborador em ' + esc(ano) + "</h2>" +
        '<span class="t-sub">clique no título da coluna para ordenar</span>' +
        '<span class="grow"></span><button class="btn btn-sm" data-acao="exportar-colaborador">Exportar CSV</button></div>' +
        '<div class="card-body flush"><div class="table-wrap"><table><thead><tr>' +
        colunaOrdenavel("Colaborador", "nome") + colunaOrdenavel("Área", "area") +
        colunaOrdenavel("Aéreo", "aereo", true) + colunaOrdenavel("Hospedagem", "hospedagem", true) +
        colunaOrdenavel("Alimentação", "alimentacao", true) + colunaOrdenavel("Transporte", "transporte", true) +
        colunaOrdenavel("Alterações", "alteracoes", true) + colunaOrdenavel("Uber", "uber", true) +
        colunaOrdenavel("Total", "total", true) + "</tr></thead><tbody>" +
        pc.map(function (l) {
          return "<tr><td>" + esc(l.nome) + "</td><td>" + esc(l.area) + "</td>" +
            ["aereo", "hospedagem", "alimentacao", "transporte", "alteracoes", "uber"].map(function (k) {
              return '<td class="n' + (l[k] ? "" : " zero") + '">' + (l[k] ? C.moeda(l[k]) : "—") + "</td>";
            }).join("") +
            '<td class="n"><strong>' + C.moeda(l.total) + "</strong></td></tr>";
        }).join("") +
        "</tbody><tfoot><tr><td colspan='2'>TOTAL</td>" +
        ["aereo", "hospedagem", "alimentacao", "transporte", "alteracoes", "uber", "total"].map(function (k) {
          return '<td class="n">' + C.moeda(pc.reduce(function (s, l) { return s + l[k]; }, 0)) + "</td>";
        }).join("") + "</tr></tfoot></table></div></div></div>";
    }

    return html;
  }

  // ---------- aba: ajustes ----------

  function ultimaAlteracao() {
    var m = C.meta;
    var quando = m.atualizadoEm || C.db.atualizadoEm;
    if (!quando) return "Sem alterações registradas.";
    var formatada = new Date(quando).toLocaleString("pt-BR");
    if (m.atualizadoPor === "base original") return "Base original da planilha, carregada em " + formatada;
    return "Última alteração: " + formatada + (m.atualizadoPor ? " · por " + m.atualizadoPor : "");
  }

  function ajustesView() {
    var r = C.db.params.regras;
    var html = '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(330px,1fr))">';

    html += '<div class="card"><div class="card-head"><h2>Regra de alimentação</h2></div>' +
      '<div class="card-body grid" style="gap:12px">' +
      '<div class="note">Cada noite fora vale <strong>' + C.brlSigla(C.porPernoite(false)) +
      "</strong>. Quando a hospedagem já inclui café da manhã, a viagem pode ser marcada assim no lançamento e " +
      "passa a valer só o jantar, <strong>" + C.brlSigla(C.db.params.regras.jantar) + "</strong> por noite. " +
      "Mudar aqui recalcula toda a base — o valor devido, a diferença e a conferência de cada viagem.</div>" +
      '<div class="form-grid">' +
      campo("Jantar por pernoite (R$)", '<input type="text" class="money" name="regra-jantar" value="' + C.brl(r.jantar) + '">', "c6") +
      campo("Café da manhã por manhã em viagem (R$)", '<input type="text" class="money" name="regra-cafe" value="' + C.brl(r.cafe) + '">', "c6") +
      campo("Tolerância da auditoria do Uber (dias)", '<input type="text" class="money" name="regra-tol" value="' + (Number(r.toleranciaUber) || 0) + '">',
            "c6", "Dias antes e depois da viagem que ainda contam como período válido. 0 = auditoria rígida.") +
      "</div>" +
      '<div class="row"><button class="btn btn-primary" data-acao="salvar-regras">Salvar regras</button></div>' +
      "</div></div>";

    var dp = C.db.params.dePara;
    html += '<div class="card"><div class="card-head"><h2>De-Para do Uber</h2>' +
      '<span class="chip">' + dp.length + '</span><span class="grow"></span>' +
      '<button class="btn btn-sm" data-acao="mapear">+ Novo vínculo</button></div>' +
      '<div class="card-body flush"><div class="table-wrap" style="max-height:340px"><table><thead><tr>' +
      "<th>Nome no relatório do Uber</th><th>Colaborador</th><th></th></tr></thead><tbody>" +
      (dp.length ? dp.map(function (d, i) {
        return "<tr><td>" + esc(d.uber) + "</td><td>" + esc(d.colaborador) + "</td>" +
          '<td><div class="actions-cell">' +
          botaoIcone("excluir-depara", i, "Remover vínculo", '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>') +
          "</div></td></tr>";
      }).join("") : '<tr><td colspan="3" class="t-sub" style="padding:16px">Nenhum vínculo cadastrado.</td></tr>') +
      "</tbody></table></div></div></div>";

    html += '<div class="card"><div class="card-head"><h2>Backup e exportação</h2></div>' +
      '<div class="card-body grid" style="gap:12px">' +
      (C.modo === "servidor"
        ? '<div class="note">Os dados ficam no servidor: todo mundo que entra com a senha vê e lança na mesma base. ' +
          "Um backup guarda uma foto do momento — útil antes de uma mudança grande.</div>"
        : '<div class="note">Os dados ficam salvos neste navegador. Faça um backup antes de trocar de máquina ou limpar o histórico.</div>') +
      '<div class="row">' +
      '<button class="btn btn-primary" data-acao="backup-baixar">Baixar backup (.json)</button>' +
      '<button class="btn" data-acao="backup-copiar">Copiar backup</button>' +
      '<button class="btn" data-acao="backup-restaurar">Restaurar backup…</button>' +
      "</div>" +
      '<div class="row">' +
      '<button class="btn" data-acao="importar-viagens">Importar viagens…</button>' +
      '<button class="btn" data-acao="exportar-viagens">Viagens (.csv)</button>' +
      '<button class="btn" data-acao="exportar-uber">Uber (.csv)</button>' +
      '<button class="btn" data-acao="exportar-colaborador">Por colaborador (.csv)</button>' +
      "</div>" +
      '<div class="row"><span class="t-sub">' + esc(ultimaAlteracao()) + "</span></div>" +
      '<div class="row" style="border-top:1px solid var(--border);padding-top:12px">' +
      '<button class="btn btn-danger" data-acao="restaurar-base">Voltar à base original da planilha</button>' +
      '<span class="t-sub">Descarta tudo que foi lançado' +
      (C.modo === "servidor" ? ", para todo mundo." : " aqui.") + "</span></div>" +
      "</div></div>";

    html += '<div class="card"><div class="card-head"><h2>Como usar</h2></div>' +
      '<div class="card-body grid" style="gap:10px;font-size:13px;color:var(--text-2)">' +
      "<p><strong>Lançar viagem:</strong> botão <em>Nova viagem</em>, no topo. Escolha o colaborador e a área, " +
      "o gestor e o aeroporto base vêm sozinhos. A alimentação já vem preenchida pela regra e o total aparece enquanto você digita. " +
      "Use <em>Salvar e lançar outra</em> para emendar vários lançamentos.</p>" +
      "<p><strong>Vários de uma vez:</strong> no formulário, marque <em>Lançar para vários colaboradores</em>. " +
      "Mesmo destino e mesmas datas para todo mundo, uma linha por pessoa — depois é só ajustar aéreo e diária de cada um.</p>" +
      "<p><strong>Remarcação:</strong> use o botão de alteração (↻) na linha da viagem. " +
      "A viagem original passa para <em>Alterada</em> e a extensão entra como um lançamento novo, ligado a ela — " +
      "o valor aprovado no início continua visível e dá para medir quanto as remarcações custaram no ano.</p>" +
      "<p><strong>Uber:</strong> aba Uber, cole o relatório e importe. Nome novo aparece como " +
      "<em>⚠ incluir no De-Para</em>, com um botão para vincular na hora.</p>" +
      "</div></div>";

    html += "</div>";
    return html;
  }

  function campo(rotulo, controle, classe, dica) {
    return '<div class="field ' + (classe || "c12") + '"><label>' + esc(rotulo) + "</label>" + controle +
      (dica ? '<span class="hint">' + esc(dica) + "</span>" : "") + "</div>";
  }

  window.Views = {
    esc: esc, campo: campo, selectHTML: selectHTML, pessoa: pessoa, vazio: vazio,
    painel: painel, viagens: viagensView, calendario: calendarioView,
    uber: uberView, equipe: equipeView, ajustes: ajustesView
  };
})();

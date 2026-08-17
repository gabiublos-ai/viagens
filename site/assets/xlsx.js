/* Escreve e lê arquivos .xlsx sem depender de biblioteca.
 *
 * Um .xlsx é um zip de XMLs. Aqui gravamos as entradas sem compressão (método
 * "stored"), que o Excel aceita, e na leitura descompactamos com a API de
 * streams do próprio navegador.
 *
 * Suporta o que o modelo de importação precisa: texto, número e data. Nada de
 * fórmula, formatação condicional ou gráfico.
 */

(function () {
  "use strict";

  var enc = new TextEncoder();

  // ---------- zip ----------

  var TABELA_CRC = (function () {
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function escreve(vetor, pos, valor, bytes) {
    for (var i = 0; i < bytes; i++) vetor[pos + i] = (valor >>> (i * 8)) & 0xFF;
  }

  /** Monta o zip com as entradas dadas: [{nome, dados:Uint8Array}]. */
  function zipar(entradas) {
    var partes = [], central = [], deslocamento = 0;

    entradas.forEach(function (e) {
      var nome = enc.encode(e.nome);
      var crc = crc32(e.dados);

      var local = new Uint8Array(30 + nome.length);
      escreve(local, 0, 0x04034b50, 4);
      escreve(local, 4, 20, 2);          // versão necessária
      escreve(local, 8, 0, 2);           // método: sem compressão
      escreve(local, 14, crc, 4);
      escreve(local, 18, e.dados.length, 4);
      escreve(local, 22, e.dados.length, 4);
      escreve(local, 26, nome.length, 2);
      local.set(nome, 30);

      partes.push(local, e.dados);

      var reg = new Uint8Array(46 + nome.length);
      escreve(reg, 0, 0x02014b50, 4);
      escreve(reg, 4, 20, 2);
      escreve(reg, 6, 20, 2);
      escreve(reg, 10, 0, 2);
      escreve(reg, 16, crc, 4);
      escreve(reg, 20, e.dados.length, 4);
      escreve(reg, 24, e.dados.length, 4);
      escreve(reg, 28, nome.length, 2);
      escreve(reg, 42, deslocamento, 4);
      reg.set(nome, 46);
      central.push(reg);

      deslocamento += local.length + e.dados.length;
    });

    var tamanhoCentral = central.reduce(function (s, c) { return s + c.length; }, 0);
    var fim = new Uint8Array(22);
    escreve(fim, 0, 0x06054b50, 4);
    escreve(fim, 8, entradas.length, 2);
    escreve(fim, 10, entradas.length, 2);
    escreve(fim, 12, tamanhoCentral, 4);
    escreve(fim, 16, deslocamento, 4);

    return new Blob(partes.concat(central, [fim]),
                    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  // ---------- escrita ----------

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");   // caracteres que o Excel recusa
  }

  function letraColuna(n) {
    var s = "";
    while (n >= 0) {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    }
    return s;
  }

  function celula(ref, valor, estilo) {
    var st = estilo ? ' s="' + estilo + '"' : "";
    if (typeof valor === "number" && isFinite(valor)) {
      return '<c r="' + ref + '"' + st + "><v>" + valor + "</v></c>";
    }
    var texto = valor === null || valor === undefined ? "" : String(valor);
    if (!texto) return st ? '<c r="' + ref + '"' + st + "/>" : "";
    return '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' +
      esc(texto) + "</t></is></c>";
  }

  function folha(aba) {
    var larguras = (aba.larguras || []).map(function (l, i) {
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + l + '" customWidth="1"/>';
    }).join("");

    var linhas = aba.linhas.map(function (linha, i) {
      var celulas = linha.map(function (v, j) {
        var estilo = (i === 0 && aba.cabecalho !== false) ? 1 : 0;
        return celula(letraColuna(j) + (i + 1), v, estilo);
      }).join("");
      return '<row r="' + (i + 1) + '">' + celulas + "</row>";
    }).join("");

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (larguras ? "<cols>" + larguras + "</cols>" : "") +
      "<sheetData>" + linhas + "</sheetData></worksheet>";
  }

  var ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF0D5C63"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
    '<cellXfs count="2"><xf xfId="0"/>' +
    '<xf xfId="0" fontId="1" fillId="2" applyFont="1" applyFill="1"><alignment vertical="center"/></xf></cellXfs>' +
    "</styleSheet>";

  /**
   * Gera o arquivo. abas = [{nome, linhas:[[...]], larguras:[]}]
   * @returns {Blob}
   */
  function criarXLSX(abas) {
    var entradas = [];

    function add(nome, texto) {
      entradas.push({ nome: nome, dados: enc.encode(texto) });
    }

    add("[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      abas.map(function (_, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
          '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join("") + "</Types>");

    add("_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>");

    add("xl/workbook.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      abas.map(function (a, i) {
        return '<sheet name="' + esc(a.nome) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join("") + "</sheets></workbook>");

    add("xl/_rels/workbook.xml.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      abas.map(function (_, i) {
        return '<Relationship Id="rId' + (i + 1) +
          '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
          (i + 1) + '.xml"/>';
      }).join("") +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>");

    add("xl/styles.xml", ESTILOS);
    abas.forEach(function (a, i) { add("xl/worksheets/sheet" + (i + 1) + ".xml", folha(a)); });

    return zipar(entradas);
  }

  // ---------- leitura ----------

  function inflar(bytes, metodo) {
    if (metodo === 0) return Promise.resolve(bytes);
    if (typeof DecompressionStream === "undefined") {
      return Promise.reject(new Error("Este navegador não consegue abrir .xlsx. Salve a planilha como CSV e importe o CSV."));
    }
    var fluxo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(fluxo).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  function le(vetor, pos, bytes) {
    var v = 0;
    for (var i = bytes - 1; i >= 0; i--) v = v * 256 + vetor[pos + i];
    return v;
  }

  /** Abre o zip e devolve {caminho: Uint8Array} das entradas pedidas. */
  function desziparr(buffer, querido) {
    var b = new Uint8Array(buffer);
    // Acha o fim do diretório central, varrendo de trás para frente.
    var fim = -1;
    for (var i = b.length - 22; i >= 0 && i > b.length - 66000; i--) {
      if (le(b, i, 4) === 0x06054b50) { fim = i; break; }
    }
    if (fim < 0) return Promise.reject(new Error("Arquivo não parece ser um .xlsx válido."));

    var total = le(b, fim + 10, 2);
    var pos = le(b, fim + 16, 4);
    var tarefas = [];

    for (var n = 0; n < total; n++) {
      if (le(b, pos, 4) !== 0x02014b50) break;
      var metodo = le(b, pos + 10, 2);
      var comprimido = le(b, pos + 20, 4);
      var tamNome = le(b, pos + 28, 2);
      var tamExtra = le(b, pos + 30, 2);
      var tamCom = le(b, pos + 32, 2);
      var local = le(b, pos + 42, 4);
      var nome = new TextDecoder().decode(b.subarray(pos + 46, pos + 46 + tamNome));

      if (querido(nome)) {
        var inicio = local + 30 + le(b, local + 26, 2) + le(b, local + 28, 2);
        tarefas.push(inflar(b.subarray(inicio, inicio + comprimido), metodo)
          .then((function (nome) {
            return function (dados) { return { nome: nome, dados: dados }; };
          })(nome)));
      }
      pos += 46 + tamNome + tamExtra + tamCom;
    }

    return Promise.all(tarefas).then(function (lista) {
      var mapa = {};
      lista.forEach(function (e) { mapa[e.nome] = e.dados; });
      return mapa;
    });
  }

  function texto(bytes) { return new TextDecoder().decode(bytes); }

  function desescapa(s) {
    return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
      .replace(/&amp;/g, "&");
  }

  /** Data do Excel (número de série) → "AAAA-MM-DD". */
  function dataDeSerie(n) {
    var ms = Math.round((n - 25569) * 86400000);   // 25569 = 01/01/1970 no calendário do Excel
    var d = new Date(ms);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  }

  /**
   * Lê a primeira aba do arquivo.
   * @returns {Promise<Array<Array<string|number>>>} linhas × colunas
   */
  function lerXLSX(buffer) {
    return desziparr(buffer, function (nome) {
      return nome === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet1\.xml$/.test(nome);
    }).then(function (partes) {
      var folhaXml = partes["xl/worksheets/sheet1.xml"];
      if (!folhaXml) throw new Error("Não achei a primeira planilha do arquivo.");

      var compartilhadas = [];
      if (partes["xl/sharedStrings.xml"]) {
        var xmlS = texto(partes["xl/sharedStrings.xml"]);
        var itens = xmlS.match(/<si[\s>][\s\S]*?<\/si>|<si\/>/g) || [];
        compartilhadas = itens.map(function (si) {
          var pedacos = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
          return pedacos.map(function (t) {
            return desescapa(t.replace(/<t[^>]*>/, "").replace(/<\/t>/, ""));
          }).join("");
        });
      }

      var xml = texto(folhaXml);
      var linhas = [];
      var regexLinha = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
      var m;
      while ((m = regexLinha.exec(xml))) {
        var numero = +m[1] - 1;
        var celulas = [];
        var regexCel = /<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g;
        var c;
        while ((c = regexCel.exec(m[2]))) {
          var atributos = c[1] || c[3] || "";
          var conteudo = c[2] || "";
          var refm = /r="([A-Z]+)\d+"/.exec(atributos);
          var coluna = 0;
          if (refm) {
            var letras = refm[1];
            for (var i = 0; i < letras.length; i++) coluna = coluna * 26 + (letras.charCodeAt(i) - 64);
            coluna -= 1;
          } else {
            coluna = celulas.length;
          }

          var tipo = (/t="([^"]+)"/.exec(atributos) || [])[1] || "n";
          var valor = "";
          if (tipo === "inlineStr") {
            valor = (conteudo.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(function (t) {
              return desescapa(t.replace(/<t[^>]*>/, "").replace(/<\/t>/, ""));
            }).join("");
          } else {
            var vm = /<v>([\s\S]*?)<\/v>/.exec(conteudo);
            var bruto = vm ? desescapa(vm[1]) : "";
            if (tipo === "s") valor = compartilhadas[+bruto] || "";
            else if (tipo === "str" || tipo === "e") valor = bruto;
            else if (bruto === "") valor = "";
            else valor = Number(bruto);
          }
          celulas[coluna] = valor;
        }
        for (var k = 0; k < celulas.length; k++) if (celulas[k] === undefined) celulas[k] = "";
        linhas[numero] = celulas;
      }
      for (var j = 0; j < linhas.length; j++) if (!linhas[j]) linhas[j] = [];
      return linhas;
    });
  }

  window.XLSX = { criar: criarXLSX, ler: lerXLSX, dataDeSerie: dataDeSerie };
})();

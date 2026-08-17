/* Listas de apoio para os campos de seleção: aeroportos comerciais do Brasil e UFs.
 *
 * O rótulo segue o padrão que a base já usava — "CNF - Confins" —, com a cidade
 * e a UF só na descrição, para não quebrar o que foi lançado antes.
 */

(function () {
  "use strict";

  var UFS = [
    { sigla: "AC", nome: "Acre" }, { sigla: "AL", nome: "Alagoas" },
    { sigla: "AM", nome: "Amazonas" }, { sigla: "AP", nome: "Amapá" },
    { sigla: "BA", nome: "Bahia" }, { sigla: "CE", nome: "Ceará" },
    { sigla: "DF", nome: "Distrito Federal" }, { sigla: "ES", nome: "Espírito Santo" },
    { sigla: "GO", nome: "Goiás" }, { sigla: "MA", nome: "Maranhão" },
    { sigla: "MG", nome: "Minas Gerais" }, { sigla: "MS", nome: "Mato Grosso do Sul" },
    { sigla: "MT", nome: "Mato Grosso" }, { sigla: "PA", nome: "Pará" },
    { sigla: "PB", nome: "Paraíba" }, { sigla: "PE", nome: "Pernambuco" },
    { sigla: "PI", nome: "Piauí" }, { sigla: "PR", nome: "Paraná" },
    { sigla: "RJ", nome: "Rio de Janeiro" }, { sigla: "RN", nome: "Rio Grande do Norte" },
    { sigla: "RO", nome: "Rondônia" }, { sigla: "RR", nome: "Roraima" },
    { sigla: "RS", nome: "Rio Grande do Sul" }, { sigla: "SC", nome: "Santa Catarina" },
    { sigla: "SE", nome: "Sergipe" }, { sigla: "SP", nome: "São Paulo" },
    { sigla: "TO", nome: "Tocantins" }
  ];

  // codigo IATA · nome usual do aeroporto · cidade · UF
  var AEROPORTOS = [
    ["GRU", "Guarulhos", "São Paulo", "SP"],
    ["CGH", "Congonhas", "São Paulo", "SP"],
    ["VCP", "Viracopos", "Campinas", "SP"],
    ["SDU", "Santos Dumont", "Rio de Janeiro", "RJ"],
    ["GIG", "Galeão", "Rio de Janeiro", "RJ"],
    ["CNF", "Confins", "Belo Horizonte", "MG"],
    ["PLU", "Pampulha", "Belo Horizonte", "MG"],
    ["BSB", "Brasília", "Brasília", "DF"],
    ["CWB", "Afonso Pena", "Curitiba", "PR"],
    ["POA", "Salgado Filho", "Porto Alegre", "RS"],
    ["SSA", "Salvador", "Salvador", "BA"],
    ["REC", "Recife", "Recife", "PE"],
    ["FOR", "Fortaleza", "Fortaleza", "CE"],
    ["BEL", "Belém", "Belém", "PA"],
    ["MAO", "Manaus", "Manaus", "AM"],
    ["NAT", "Natal", "Natal", "RN"],
    ["MCZ", "Maceió", "Maceió", "AL"],
    ["AJU", "Aracaju", "Aracaju", "SE"],
    ["JPA", "João Pessoa", "João Pessoa", "PB"],
    ["THE", "Teresina", "Teresina", "PI"],
    ["SLZ", "São Luís", "São Luís", "MA"],
    ["VIX", "Vitória", "Vitória", "ES"],
    ["CGB", "Cuiabá", "Cuiabá", "MT"],
    ["CGR", "Campo Grande", "Campo Grande", "MS"],
    ["GYN", "Goiânia", "Goiânia", "GO"],
    ["PMW", "Palmas", "Palmas", "TO"],
    ["RBR", "Rio Branco", "Rio Branco", "AC"],
    ["PVH", "Porto Velho", "Porto Velho", "RO"],
    ["BVB", "Boa Vista", "Boa Vista", "RR"],
    ["MCP", "Macapá", "Macapá", "AP"],
    ["FLN", "Florianópolis", "Florianópolis", "SC"],
    ["JOI", "Joinville", "Joinville", "SC"],
    ["NVT", "Navegantes", "Navegantes", "SC"],
    ["XAP", "Chapecó", "Chapecó", "SC"],
    ["CXJ", "Caxias do Sul", "Caxias do Sul", "RS"],
    ["PET", "Pelotas", "Pelotas", "RS"],
    ["URG", "Uruguaiana", "Uruguaiana", "RS"],
    ["LDB", "Londrina", "Londrina", "PR"],
    ["MGF", "Maringá", "Maringá", "PR"],
    ["CAC", "Cascavel", "Cascavel", "PR"],
    ["FOZ", "Foz do Iguaçu", "Foz do Iguaçu", "PR"],
    ["RAO", "Ribeirão Preto", "Ribeirão Preto", "SP"],
    ["SJP", "São José do Rio Preto", "São José do Rio Preto", "SP"],
    ["SJK", "São José dos Campos", "São José dos Campos", "SP"],
    ["BAU", "Bauru", "Bauru", "SP"],
    ["PPB", "Presidente Prudente", "Presidente Prudente", "SP"],
    ["MII", "Marília", "Marília", "SP"],
    ["UDI", "Uberlândia", "Uberlândia", "MG"],
    ["UBA", "Uberaba", "Uberaba", "MG"],
    ["IPN", "Ipatinga", "Ipatinga", "MG"],
    ["MOC", "Montes Claros", "Montes Claros", "MG"],
    ["JDF", "Juiz de Fora", "Juiz de Fora", "MG"],
    ["GVR", "Governador Valadares", "Governador Valadares", "MG"],
    ["DIQ", "Divinópolis", "Divinópolis", "MG"],
    ["IOS", "Ilhéus", "Ilhéus", "BA"],
    ["BPS", "Porto Seguro", "Porto Seguro", "BA"],
    ["VDC", "Vitória da Conquista", "Vitória da Conquista", "BA"],
    ["LEC", "Lençóis", "Lençóis", "BA"],
    ["PAV", "Paulo Afonso", "Paulo Afonso", "BA"],
    ["JUA", "Juazeiro do Norte", "Juazeiro do Norte", "CE"],
    ["PHB", "Parnaíba", "Parnaíba", "PI"],
    ["IMP", "Imperatriz", "Imperatriz", "MA"],
    ["STM", "Santarém", "Santarém", "PA"],
    ["MAB", "Marabá", "Marabá", "PA"],
    ["ATM", "Altamira", "Altamira", "PA"],
    ["CZS", "Cruzeiro do Sul", "Cruzeiro do Sul", "AC"],
    ["TBT", "Tabatinga", "Tabatinga", "AM"],
    ["TFF", "Tefé", "Tefé", "AM"],
    ["JPR", "Ji-Paraná", "Ji-Paraná", "RO"],
    ["ROO", "Rondonópolis", "Rondonópolis", "MT"],
    ["SIN", "Sinop", "Sinop", "MT"],
    ["BYO", "Bonito", "Bonito", "MS"],
    ["DOU", "Dourados", "Dourados", "MS"],
    ["CAW", "Campos dos Goytacazes", "Campos dos Goytacazes", "RJ"],
    ["MEA", "Macaé", "Macaé", "RJ"],
    ["CPV", "Campina Grande", "Campina Grande", "PB"],
    ["PNZ", "Petrolina", "Petrolina", "PE"],
    ["FEN", "Fernando de Noronha", "Fernando de Noronha", "PE"],
    ["MVF", "Mossoró", "Mossoró", "RN"],
    ["ARU", "Araçatuba", "Araçatuba", "SP"],
    ["QSC", "Sorocaba", "Sorocaba", "SP"]
  ].map(function (a) {
    return { codigo: a[0], nome: a[1], cidade: a[2], uf: a[3], valor: a[0] + " - " + a[1] };
  });

  window.BR = {
    UFS: UFS,
    AEROPORTOS: AEROPORTOS,

    /** <option> do datalist: valor no padrão da base, descrição com cidade e UF. */
    opcoesAeroporto: function () {
      return AEROPORTOS.map(function (a) {
        return '<option value="' + a.valor + '">' + a.cidade + "/" + a.uf + "</option>";
      }).join("");
    },

    opcoesUF: function (valor) {
      return '<option value="">—</option>' + UFS.map(function (u) {
        return '<option value="' + u.sigla + '"' + (u.sigla === valor ? " selected" : "") +
          ">" + u.sigla + " · " + u.nome + "</option>";
      }).join("");
    },

    /** Acha o aeroporto de uma cidade, para sugerir sozinho no cadastro. */
    aeroportoDaCidade: function (cidade, uf) {
      if (!cidade) return null;
      var alvo = String(cidade).trim().toLowerCase();
      for (var i = 0; i < AEROPORTOS.length; i++) {
        if (AEROPORTOS[i].cidade.toLowerCase() === alvo && (!uf || AEROPORTOS[i].uf === uf)) {
          return AEROPORTOS[i];
        }
      }
      return null;
    }
  };
})();

/* Onde os dados ficam.
 *
 * Dois modos, mesma interface:
 *   servidor — site com senha; todo mundo lança na mesma base (window.MODO_SERVIDOR)
 *   local    — arquivo aberto direto no navegador; os dados ficam só naquela máquina
 *
 * Em modo servidor, cada operação devolve o estado inteiro já atualizado, então
 * nenhum cliente fica com uma versão pela metade.
 */

(function () {
  "use strict";

  var CHAVE_LOCAL = "gvc.v1";
  var servidor = !!window.MODO_SERVIDOR;

  // ---------- modo servidor ----------

  function chamar(metodo, rota, corpo) {
    return fetch("/api" + rota, {
      method: metodo,
      headers: corpo ? { "content-type": "application/json" } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined,
      credentials: "same-origin"
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (dados) {
        if (r.ok) return dados;
        var e = new Error(dados.erro || "Falha na comunicação com o servidor.");
        e.status = r.status;
        e.dados = dados;
        throw e;
      });
    });
  }

  var Servidor = {
    modo: "servidor",

    /** Devolve {autenticado, estado} — sem lançar erro quando é só falta de sessão. */
    iniciar: function () {
      return chamar("GET", "/estado").then(
        function (estado) { return { autenticado: true, estado: estado }; },
        function (e) {
          if (e.status === 401) return { autenticado: false };
          throw e;
        }
      );
    },

    entrar: function (senha, nome) {
      return chamar("POST", "/sessao", { senha: senha, nome: nome });
    },

    sair: function () { return chamar("DELETE", "/sessao"); },

    revisao: function () { return chamar("GET", "/revisao"); },
    estado: function () { return chamar("GET", "/estado"); },

    salvarViagem: function (viagem) { return chamar("PUT", "/viagem", { viagem: viagem }); },
    excluirViagem: function (id) { return chamar("DELETE", "/viagem/" + encodeURIComponent(id)); },

    salvarColaborador: function (colaborador, nomeOriginal) {
      return chamar("PUT", "/colaborador", { colaborador: colaborador, nomeOriginal: nomeOriginal || "" });
    },
    excluirColaborador: function (nome) {
      return chamar("DELETE", "/colaborador/" + encodeURIComponent(nome));
    },

    importarUber: function (linhas) { return chamar("POST", "/uber", { linhas: linhas }); },
    excluirCorrida: function (linha) { return chamar("DELETE", "/uber", { linha: linha }); },
    limparUber: function () { return chamar("DELETE", "/uber/tudo"); },

    salvarParams: function (params) { return chamar("PUT", "/params", { params: params }); },

    restaurarEstado: function (dados) { return chamar("PUT", "/estado", { dados: dados }); },
    restaurarBase: function () { return chamar("POST", "/base-original"); }
  };

  // ---------- modo local ----------

  /**
   * No modo local o app é dono do estado: cada operação mexe no objeto em memória
   * (quem chama já fez isso) e aqui só persistimos e devolvemos o mesmo estado.
   */
  function Local(obterDados) {
    function persistir() {
      var estado = {
        revisao: 0,
        atualizadoEm: new Date().toISOString(),
        atualizadoPor: "",
        dados: obterDados()
      };
      try {
        localStorage.setItem(CHAVE_LOCAL, JSON.stringify(estado.dados));
      } catch (e) {
        console.warn("Não foi possível gravar no navegador:", e);
      }
      return Promise.resolve(estado);
    }

    var api = {
      modo: "local",
      iniciar: function () {
        var dados = null;
        try {
          var bruto = localStorage.getItem(CHAVE_LOCAL);
          if (bruto) dados = JSON.parse(bruto);
        } catch (e) { /* armazenamento indisponível — começa da base original */ }
        return Promise.resolve({ autenticado: true, estado: dados ? { revisao: 0, dados: dados } : null });
      },
      entrar: function () { return Promise.resolve({}); },
      sair: function () { return Promise.resolve({}); },
      revisao: function () { return Promise.resolve({ revisao: 0 }); },
      estado: function () { return persistir(); }
    };

    ["salvarViagem", "excluirViagem", "salvarColaborador", "excluirColaborador",
     "importarUber", "excluirCorrida", "limparUber", "salvarParams",
     "restaurarEstado", "restaurarBase"].forEach(function (nome) {
      api[nome] = persistir;
    });

    return api;
  }

  window.Armazenamento = {
    ehServidor: servidor,
    criar: function (obterDados) { return servidor ? Servidor : Local(obterDados); }
  };
})();

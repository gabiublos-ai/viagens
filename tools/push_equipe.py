#!/usr/bin/env python3
"""Envia a base de equipe de assets/seed.js para o site publicado.

As viagens e as corridas de Uber que já estão no ar não são tocadas: só a lista
de colaboradores é substituída.

Uso:
    SENHA='...' python3 tools/push_equipe.py https://acegamingviagens.netlify.app
    SENHA='...' python3 tools/push_equipe.py <url> --simular
"""
import io
import json
import os
import sys
import unicodedata
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(RAIZ, "assets", "seed.js")


def norma(s):
    return unicodedata.normalize("NFD", str(s or "").strip().lower()).encode("ascii", "ignore").decode()


class Sessao:
    def __init__(self, base):
        self.base = base.rstrip("/")
        self.cookie = ""

    def chamar(self, metodo, rota, corpo=None):
        dados = json.dumps(corpo).encode() if corpo is not None else None
        req = urllib.request.Request(self.base + rota, data=dados, method=metodo)
        if dados:
            req.add_header("Content-Type", "application/json")
        if self.cookie:
            req.add_header("Cookie", self.cookie)
        with urllib.request.urlopen(req, timeout=120) as r:
            bruto = r.headers.get("set-cookie")
            if bruto:
                self.cookie = bruto.split(";")[0]
            texto = r.read().decode()
            return json.loads(texto) if texto.strip() else {}

    def entrar(self, senha):
        return self.chamar("POST", "/api/sessao", {"senha": senha, "nome": "atualização da base"})


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    url = sys.argv[1]
    simular = "--simular" in sys.argv
    senha = os.environ.get("SENHA", "")
    if not senha:
        print("Informe a senha do site na variável SENHA.")
        return 1

    seed = json.loads(io.open(SEED, encoding="utf-8").read().split("window.SEED = ", 1)[1].rstrip().rstrip(";"))
    novos = seed["colaboradores"]

    s = Sessao(url)
    estado = s.entrar(senha)
    atuais = estado["dados"]["colaboradores"]
    print("no ar: %d colaboradores · %d viagens · %d linhas de Uber (revisão %d)"
          % (len(atuais), len(estado["dados"]["viagens"]), len(estado["dados"]["uber"]), estado["revisao"]))

    por_nome = {norma(c["nome"]): c for c in atuais}
    incluidos = [c["nome"] for c in novos if norma(c["nome"]) not in por_nome]
    conhecidos = {norma(c["nome"]) for c in novos}
    # Quem foi cadastrado direto no app e não está na planilha continua na base.
    extras = [c for c in atuais if norma(c["nome"]) not in conhecidos]

    alterados = 0
    for c in novos:
        antigo = por_nome.get(norma(c["nome"]))
        if antigo and any(str(antigo.get(k, "")) != str(v) for k, v in c.items()):
            alterados += 1

    print("a enviar: %d da planilha (%d novos, %d alterados) + %d cadastrados no próprio app"
          % (len(novos), len(incluidos), alterados, len(extras)))
    for n in incluidos:
        print("   +", n)
    for c in extras:
        print("   ·", c["nome"], "(mantido)")

    if simular:
        print("\n(simulação — nada foi enviado)")
        return 0

    estado["dados"]["colaboradores"] = sorted(novos + extras, key=lambda c: norma(c["nome"]))
    resposta = s.chamar("PUT", "/api/estado", {"dados": estado["dados"]})
    print("\nenviado · revisão %d · %d colaboradores · %d viagens · %d linhas de Uber"
          % (resposta["revisao"], len(resposta["dados"]["colaboradores"]),
             len(resposta["dados"]["viagens"]), len(resposta["dados"]["uber"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())

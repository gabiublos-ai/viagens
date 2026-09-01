#!/usr/bin/env python3
"""Envia a base de equipe de assets/seed.js para o site publicado.

As viagens e as corridas de Uber que já estão no ar não são tocadas: só a lista
de colaboradores é substituída.

Uso:
    SENHA='...' python3 tools/push_equipe.py https://acegamingviagens.netlify.app
    SENHA='...' python3 tools/push_equipe.py <url> --simular
    SENHA='...' python3 tools/push_equipe.py <url> --remover-fora   # espelha a base local
"""
import io
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nomes import acha, norma  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(RAIZ, "assets", "seed.js")


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
    remover_fora = "--remover-fora" in sys.argv
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

    def combina(novo, antigo):
        """A planilha manda no que ela preenche. O que ela deixa em branco não
        apaga o que já está no ar — cidade, aeroporto e afins completados no
        próprio app continuam valendo. O nome fica com a grafia cadastrada,
        que é a chave dos lançamentos de viagem."""
        if not antigo:
            return dict(novo)
        junto = dict(antigo)
        for campo, valor in novo.items():
            if campo == "nome":
                continue
            if str(valor).strip() or not str(junto.get(campo, "")).strip():
                junto[campo] = valor
        return junto

    enviar, incluidos, alterados = [], [], []
    for c in novos:
        antigo = acha(c["nome"], atuais)
        junto = combina(c, antigo)
        enviar.append(junto)
        if not antigo:
            incluidos.append(c["nome"])
        else:
            dif = ["%s: %s → %s" % (k, antigo.get(k, "") or "—", junto[k] or "—")
                   for k in junto if str(antigo.get(k, "")) != str(junto[k])]
            if dif:
                alterados.append((junto["nome"], dif))

    # Quem foi cadastrado direto no app e não está na base local: por padrão
    # continua no ar; com --remover-fora sai, a menos que tenha viagem lançada.
    viajantes = {norma(v["colaborador"]) for v in estado["dados"]["viagens"]}
    sobrando = [c for c in atuais if not acha(c["nome"], novos)]
    if remover_fora:
        extras = [c for c in sobrando if norma(c["nome"]) in viajantes]
        removidos = [c for c in sobrando if norma(c["nome"]) not in viajantes]
    else:
        extras, removidos = sobrando, []

    print("a enviar: %d da planilha (%d novos, %d alterados) + %d cadastrados no próprio app"
          % (len(novos), len(incluidos), len(alterados), len(extras)))
    for n in incluidos:
        print("   +", n)
    for nome, dif in alterados:
        print("   ~", nome)
        for d in dif:
            print("       ", d)
    for c in extras:
        print("   ·", c["nome"], "(mantido)")
    for c in removidos:
        print("   −", c["nome"], "(removido)")

    if simular:
        print("\n(simulação — nada foi enviado)")
        return 0

    estado["dados"]["colaboradores"] = sorted(enviar + extras, key=lambda c: norma(c["nome"]))
    resposta = s.chamar("PUT", "/api/estado", {"dados": estado["dados"]})
    print("\nenviado · revisão %d · %d colaboradores · %d viagens · %d linhas de Uber"
          % (resposta["revisao"], len(resposta["dados"]["colaboradores"]),
             len(resposta["dados"]["viagens"]), len(resposta["dados"]["uber"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())

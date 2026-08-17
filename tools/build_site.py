#!/usr/bin/env python3
"""Monta site/ (o que o servidor publica) e servidor/seed.json (base original).

O site publicado NÃO leva assets/seed.js: os dados só chegam ao navegador
depois da senha, vindos do servidor.

Uso: python3 tools/build_site.py
"""
import io
import json
import os
import re
import shutil

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(RAIZ, "site")
COPIAR = ["styles.css", "dados-br.js", "xlsx.js", "armazenamento.js", "core.js", "views.js", "app.js"]


def main():
    html = io.open(os.path.join(RAIZ, "index.html"), encoding="utf-8").read()

    # Fora o seed; entra a marca de que os dados vêm do servidor.
    html = html.replace('<script src="assets/seed.js"></script>\n', "")
    html = html.replace(
        '<script src="assets/armazenamento.js"></script>',
        "<script>window.MODO_SERVIDOR = true;</script>\n"
        '<script src="assets/armazenamento.js"></script>',
    )
    assert "MODO_SERVIDOR" in html and "seed.js" not in html, "index.html mudou de forma inesperada"

    if os.path.isdir(SITE):
        shutil.rmtree(SITE)
    os.makedirs(os.path.join(SITE, "assets"))

    with io.open(os.path.join(SITE, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)

    # Gerador da senha de acesso — usado uma vez, na configuração do site.
    shutil.copy(os.path.join(RAIZ, "senha.html"), os.path.join(SITE, "senha.html"))
    for nome in COPIAR:
        shutil.copy(os.path.join(RAIZ, "assets", nome), os.path.join(SITE, "assets", nome))

    # A base original, para o servidor semear o banco na primeira vez.
    bruto = io.open(os.path.join(RAIZ, "assets", "seed.js"), encoding="utf-8").read()
    seed = json.loads(bruto.split("window.SEED = ", 1)[1].rstrip().rstrip(";"))
    destino = os.path.join(RAIZ, "servidor", "seed.json")
    with io.open(destino, "w", encoding="utf-8") as f:
        json.dump(seed, f, ensure_ascii=False)

    tamanho = sum(os.path.getsize(os.path.join(dir, n))
                  for dir, _, nomes in os.walk(SITE) for n in nomes)
    print("site/            %d arquivos · %.0f KB" % (len(COPIAR) + 2, tamanho / 1024))
    print("servidor/seed.json %.0f KB · %d viagens · %d colaboradores · %d linhas Uber"
          % (os.path.getsize(destino) / 1024, len(seed["viagens"]),
             len(seed["colaboradores"]), len(seed["uberRaw"])))


if __name__ == "__main__":
    main()

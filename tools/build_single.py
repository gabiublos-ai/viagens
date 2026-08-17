#!/usr/bin/env python3
"""Gera as versões de arquivo único a partir de index.html + assets/.

  dist/gestao-viagens.html  — HTML completo, abre com dois cliques, funciona offline
  dist/artifact.html        — só o conteúdo (sem <html>/<head>/<body>), para publicar

Uso: python3 tools/build_single.py
"""
import io
import os
import re

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def ler(caminho):
    with io.open(os.path.join(RAIZ, caminho), encoding="utf-8") as f:
        return f.read()


def inline(html):
    """Substitui <link>/<script src> pelo conteúdo dos arquivos."""

    def css(m):
        return "<style>\n" + ler(m.group(1)) + "\n</style>"

    def js(m):
        return "<script>\n" + ler(m.group(1)) + "\n</script>"

    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css, html)
    html = re.sub(r'<script src="([^"]+)"></script>', js, html)
    return html


def main():
    completo = inline(ler("index.html"))

    corpo = completo
    corpo = corpo.split("<body>", 1)[1].split("</body>", 1)[0]
    cabeca = completo.split("<head>", 1)[1].split("</head>", 1)[0]
    estilo = "<style>" + cabeca.split("<style>", 1)[1].split("</style>", 1)[0] + "</style>"
    titulo = re.search(r"<title>(.*?)</title>", cabeca).group(1)

    fragmento = "<title>" + titulo + "</title>\n" + estilo + "\n" + corpo.strip()

    os.makedirs(os.path.join(RAIZ, "dist"), exist_ok=True)
    for nome, conteudo in [("gestao-viagens.html", completo), ("artifact.html", fragmento)]:
        destino = os.path.join(RAIZ, "dist", nome)
        with io.open(destino, "w", encoding="utf-8") as f:
            f.write(conteudo)
        print("%-24s %6.0f KB" % (nome, len(conteudo.encode("utf-8")) / 1024))


if __name__ == "__main__":
    main()

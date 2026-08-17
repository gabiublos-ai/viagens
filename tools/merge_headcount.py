#!/usr/bin/env python3
"""Atualiza a base de equipe a partir de "Ace Gaming_Gestao_Headcount.xlsx".

Essa planilha é a fonte da verdade do quadro: aba **Colaboradores** para quem
está ativo, aba **Desligados** para quem saiu.

Traz só o que a gestão de viagens usa — status, área, cargo, nível, contrato,
gestor direto, modelo de trabalho, cidade/UF, aeroporto e e-mails corporativos.
Remuneração, comissão, CPF, RG, telefone, endereço, dados bancários, PIX, data
de nascimento e escolaridade NÃO são importados.

Uso:
    python3 tools/merge_headcount.py caminho/Ace\\ Gaming_Gestao_Headcount.xlsx
    python3 tools/merge_headcount.py <arquivo> --simular    # só mostra o que mudaria
"""
import io
import json
import os
import sys
import warnings

warnings.filterwarnings("ignore")
import openpyxl

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nomes import PARTICULAS, acha, norma  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(RAIZ, "assets", "seed.js")

# Coluna da planilha → campo do app. Os cabeçalhos são comparados sem acento,
# sem caixa e sem o "ƒ" que a planilha usa para marcar coluna calculada.
MAPA = {
    "status": "status",
    "tipo contrato": "contrato",
    "area": "area",
    "cargo": "cargo",
    "nivel": "nivel",
    "gestor direto": "gestor",
    "modelo de trabalho": "modelo",
    "cidade": "cidade",
    "uf": "uf",
    "aeroporto": "aeroportoBase",
    "e-mail ace gaming": "email",
    "e-mail anterior (@apostou)": "emailAlt",
}
COLUNA_NOME = "nome completo"


def texto(v):
    return "" if v is None else str(v).strip()


def cabecalho_norm(v):
    """'NOME COMPLETO ƒ' → 'nome completo'."""
    return norma(texto(v).replace("ƒ", ""))


def nome_legivel(valor):
    """'GABRIELA UHR BLOS LOLLI' → 'Gabriela Uhr Blos Lolli'.

    A planilha guarda os nomes em caixa alta; o app mostra nome de gente.
    Nome que já venha escrito normalmente passa intacto.
    """
    if not valor or valor != valor.upper():
        return valor
    partes = []
    for i, palavra in enumerate(valor.split()):
        baixa = palavra.lower()
        partes.append(baixa if i and baixa in PARTICULAS else baixa.capitalize())
    return " ".join(partes)


def acha_cabecalho(ws, obrigatoria, limite=14):
    """A planilha tem título, subtítulo e às vezes um resumo antes do cabeçalho."""
    for i in range(1, limite + 1):
        valores = [cabecalho_norm(c.value) for c in ws[i]]
        if obrigatoria in valores:
            return i, valores
    raise SystemExit("Não achei a coluna '%s' nas %d primeiras linhas de '%s'." % (obrigatoria, limite, ws.title))


def le_colaboradores(wb):
    ws = wb["Colaboradores"]
    linha_cab, cab = acha_cabecalho(ws, COLUNA_NOME)
    indices = {MAPA[c]: cab.index(c) for c in MAPA if c in cab}
    faltando = sorted(c for c in MAPA if c not in cab)
    if faltando:
        print("Aviso: colunas ausentes na planilha:", ", ".join(faltando))

    col_nome = cab.index(COLUNA_NOME)
    registros = []
    for linha in ws.iter_rows(min_row=linha_cab + 1, values_only=True):
        nome = nome_legivel(texto(linha[col_nome]))
        if not nome:
            continue
        reg = {"nome": nome}
        for campo, coluna in indices.items():
            reg[campo] = texto(linha[coluna])
        registros.append(reg)
    return registros


def le_desligados(wb):
    if "Desligados" not in wb.sheetnames:
        return {}
    ws = wb["Desligados"]
    try:
        linha_cab, cab = acha_cabecalho(ws, COLUNA_NOME)
    except SystemExit:
        return {}
    col_nome = cab.index(COLUNA_NOME)
    col_dia = cab.index("data ultimo dia") if "data ultimo dia" in cab else None
    saidas = {}
    for linha in ws.iter_rows(min_row=linha_cab + 1, values_only=True):
        nome = nome_legivel(texto(linha[col_nome]))
        if nome:
            saidas[norma(nome)] = {"nome": nome, "ultimoDia": texto(linha[col_dia]) if col_dia is not None else ""}
    return saidas


def carrega_seed():
    bruto = io.open(SEED, encoding="utf-8").read()
    cabecalho, corpo = bruto.split("window.SEED = ", 1)
    return cabecalho, json.loads(corpo.rstrip().rstrip(";"))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    caminho = sys.argv[1]
    simular = "--simular" in sys.argv

    wb = openpyxl.load_workbook(caminho, data_only=True)
    ativos = le_colaboradores(wb)
    desligados = le_desligados(wb)

    cabecalho, seed = carrega_seed()
    atuais = {norma(c["nome"]): c for c in seed["colaboradores"]}

    incluidos, alterados, marcados = [], [], []

    viajantes = {norma(v["colaborador"]) for v in seed["viagens"]}
    renomeados = []

    for reg in ativos:
        chave = norma(reg["nome"])
        alvo = acha(reg["nome"], atuais)
        if alvo and norma(alvo["nome"]) != chave:
            # Mesma pessoa com grafia diferente. Quem já tem viagem lançada
            # mantém o nome do app, que é a chave desses lançamentos.
            if norma(alvo["nome"]) in viajantes:
                renomeados.append("%s (planilha) mantido como %s (tem viagem lançada)"
                                  % (reg["nome"], alvo["nome"]))
                reg = dict(reg, nome=alvo["nome"])
            else:
                renomeados.append("%s → %s" % (alvo["nome"], reg["nome"]))
                atuais.pop(norma(alvo["nome"]), None)
                alvo["nome"] = reg["nome"]
                atuais[chave] = alvo
        if not alvo:
            alvo = {"nome": reg["nome"], "status": "Ativo", "area": "", "cargo": "", "nivel": "",
                    "gestor": "", "contrato": "", "cidade": "", "uf": "", "aeroportoBase": "",
                    "email": "", "emailAlt": "", "modelo": ""}
            seed["colaboradores"].append(alvo)
            atuais[chave] = alvo
            incluidos.append(reg["nome"])

        mudancas = []
        for campo, valor in reg.items():
            # O nome é a chave que liga às viagens: mantém a grafia já cadastrada.
            if campo == "nome" or not valor:
                continue
            if texto(alvo.get(campo)) != valor:
                if alvo.get(campo):
                    mudancas.append("%s: %s → %s" % (campo, alvo[campo], valor))
                alvo[campo] = valor
        if mudancas and reg["nome"] not in incluidos:
            alterados.append((reg["nome"], mudancas))

    # Quem saiu fica no cadastro, marcado — as viagens passadas continuam válidas.
    for chave, saida in desligados.items():
        alvo = acha(saida["nome"], atuais)
        if alvo and alvo.get("status") != "Desligado":
            alvo["status"] = "Desligado"
            marcados.append(saida["nome"] + (" (último dia %s)" % saida["ultimoDia"][:10] if saida["ultimoDia"] else ""))

    conhecidos = set()
    for reg in ativos:
        alvo = acha(reg["nome"], atuais)
        conhecidos.add(norma(alvo["nome"] if alvo else reg["nome"]))
    for saida in desligados.values():
        alvo = acha(saida["nome"], atuais)
        conhecidos.add(norma(alvo["nome"] if alvo else saida["nome"]))
    fora = [c["nome"] for c in seed["colaboradores"] if norma(c["nome"]) not in conhecidos]

    seed["colaboradores"].sort(key=lambda c: norma(c["nome"]))
    seed["baseEquipeVersao"] = seed.get("baseEquipeVersao", 0) + 1

    print("Planilha: %d ativos · %d desligados" % (len(ativos), len(desligados)))
    print("Base do app: %d pessoas (versão %d)\n" % (len(seed["colaboradores"]), seed["baseEquipeVersao"]))

    print("%d incluídos:" % len(incluidos))
    for n in incluidos:
        print("  +", n)
    if renomeados:
        print("\n%d com grafia de nome ajustada:" % len(renomeados))
        for n in renomeados:
            print("  ↔", n)
    print("\n%d marcados como desligados:" % len(marcados))
    for n in marcados:
        print("  ×", n)
    print("\n%d com dados alterados:" % len(alterados))
    for nome, mudancas in alterados:
        print("  ~ %s" % nome)
        for m in mudancas:
            print("      %s" % m)
    if fora:
        print("\n%d no app e fora da planilha (mantidos, confira):" % len(fora))
        for n in fora:
            print("  ?", n)

    if simular:
        print("\n(simulação — assets/seed.js não foi alterado)")
        return 0

    with io.open(SEED, "w", encoding="utf-8") as f:
        f.write(cabecalho)
        f.write("window.SEED = ")
        json.dump(seed, f, ensure_ascii=False, indent=1)
        f.write(";\n")
    print("\nassets/seed.js atualizado.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

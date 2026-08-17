"""Casamento de nomes de pessoas entre a planilha e a base do app.

A planilha de headcount e o app nem sempre escrevem o nome igual — um traz o
nome completo ("Andrei Espelocim Garcia") e o outro o nome curto ("Andrei
Garcia"). Como o nome é a chave que liga um colaborador às suas viagens,
reconhecer que são a mesma pessoa evita cadastro duplicado.
"""
import unicodedata

PARTICULAS = {"de", "da", "do", "das", "dos", "e"}


def norma(s):
    """Minúsculas, sem acento, sem espaço sobrando."""
    return unicodedata.normalize("NFD", str(s or "").strip().lower()).encode("ascii", "ignore").decode()


def tokens(nome):
    """Palavras significativas de um nome, sem partículas."""
    return {t for t in norma(nome).split() if t not in PARTICULAS and len(t) > 1}


def mesma_pessoa(a, b):
    """Um nome contido no outro, com o primeiro nome igual e ao menos duas
    palavras em comum — apertado o bastante para não juntar homônimos."""
    if norma(a) == norma(b):
        return True
    pa, pb = norma(a).split(), norma(b).split()
    if not pa or not pb or pa[0] != pb[0]:
        return False
    ta, tb = tokens(a), tokens(b)
    return len(ta & tb) >= 2 and (ta <= tb or tb <= ta)


def acha(nome, pessoas, chave=lambda p: p["nome"]):
    """Procura `nome` numa lista/dict de pessoas. Devolve o registro ou None."""
    lista = pessoas.values() if isinstance(pessoas, dict) else pessoas
    alvo = norma(nome)
    for p in lista:
        if norma(chave(p)) == alvo:
            return p
    for p in lista:
        if mesma_pessoa(nome, chave(p)):
            return p
    return None

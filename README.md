# Gestão de Viagens Corporativas

Substitui a planilha `Gestao_Viagens_Corporativas_AceGaming_2026.xlsx` por um app que roda no
navegador, sem instalação e sem servidor. A base de maio a agosto/2026 já vem carregada:
**53 viagens · 1 alteração · 233 pernoites · 186 linhas do Uber · 57 colaboradores**.

O cadastro da equipe vem de `Ace Gaming_Gestao_Colaboradores.xlsx` (Drive), com apenas os campos
que a gestão de viagens usa — área, cargo, nível, contrato, modelo de trabalho, cidade/UF,
aeroporto base e e-mail corporativo. Dados pessoais e bancários da planilha de origem (CPF, RG,
endereço, telefone, conta, PIX) não são importados.

Todos os totais conferem com a planilha original: R$ 139.228,71 no ano, R$ 128.070,42 em viagens,
R$ 11.158,29 de Uber, 25 colaboradores com despesa, 181 corridas, ticket médio de R$ 62,07.

## Como abrir

**Opção 1 — arquivo único.** Baixe `dist/gestao-viagens.html` e abra com dois cliques.
Funciona offline, em qualquer navegador, sem instalar nada.

**Opção 2 — pasta do projeto.** Abra `index.html`. Mesma coisa, com os arquivos separados
para editar.

Os dados ficam salvos no navegador (localStorage) da máquina onde o app foi aberto. Para levar
para outro computador, use **Ajustes → Baixar backup** e depois **Restaurar backup** no destino.

## O que mudou em relação à planilha

| Na planilha | Aqui |
|---|---|
| Achar a primeira linha vazia da aba Viagens e preencher 13 colunas | Botão **Nova viagem**, formulário com o total calculado enquanto se digita |
| Repetir o mesmo lançamento para 15 pessoas da mesma viagem | **Lançar para vários colaboradores** — marque a lista, uma linha por pessoa |
| Copiar área, gestor e aeroporto do cadastro | Vêm sozinhos ao escolher a pessoa; no lote, cada um sai do seu aeroporto base |
| Lembrar a regra dos R$ 100 por pernoite | Alimentação já vem preenchida, com o botão *usar a regra* |
| Montar a linha de alteração à mão e trocar o status da original | Botão ↻ na viagem: cria a linha ligada e marca a original como *Alterada* |
| Conferir fórmula por fórmula | Coluna Conferência com o motivo no próprio aviso |

## As abas

- **Painel** — custo do ano, composição mensal por categoria, custo por área e top 10 pessoas.
- **Viagens** — a lista de lançamentos, agrupada por mês, com filtros, busca e edição.
- **Calendário** — quem estava fora em cada dia do mês. ▶ ida · ■ em viagem · ◀ retorno.
- **Uber** — colagem do relatório, auditoria contra as datas de viagem e análise de gastos.
- **Equipe** — cadastro das 53 pessoas, com viagens e custo de cada uma no ano.
- **Ajustes** — regra de alimentação, De-Para do Uber, backup e exportação em CSV.

## Regras de cálculo

São as mesmas da planilha:

- **Noites** = data de volta − data de ida.
- **Hospedagem** = diárias × valor da diária.
- **Total** = aéreo + hospedagem + alimentação + transporte/auxílio + custo de alteração.
- **Alimentação devida** = noites × (jantar R$ 70 + café da manhã R$ 30). Editável em Ajustes.
- **Conferência** avisa quando há pendência em aberto, quando noites e diárias não batem, e
  quando a alimentação lançada difere da regra.
- **Auditoria do Uber**: cada corrida (transações do tipo `Fare`) é confrontada com as datas de
  viagem do mesmo colaborador, com tolerância de 1 dia antes e depois — configurável.
  Transações `Payment` são o pagamento da fatura e não entram como despesa nova.

## Importar o Uber

1. No Uber Business, exporte o relatório de transações em CSV.
2. Abra no **Bloco de Notas** — não no Excel, que converte datas e valores errado.
3. Copie só as linhas de transação, sem o cabeçalho do relatório.
4. Cole na aba **Uber** e clique em *Importar linhas coladas*. Linhas repetidas são ignoradas.

Nome que o Uber traz diferente do cadastro aparece como **⚠ incluir no De-Para**, com um botão
para vincular na hora.

## Estrutura

```
index.html               casca do app
assets/styles.css        tokens de cor, tema claro/escuro, componentes
assets/seed.js           base extraída da planilha (gerado)
assets/core.js           estado, persistência e todas as regras de cálculo
assets/views.js          telas
assets/app.js            navegação, formulários e ações
tools/extract_seed.py    regenera assets/seed.js a partir da planilha de viagens
tools/merge_equipe.py    atualiza a base de equipe a partir da planilha de colaboradores
tools/build_single.py    gera dist/gestao-viagens.html (arquivo único)
```

Sem dependências, sem build obrigatório, sem framework — só HTML, CSS e JavaScript.

Para regerar a base a partir de uma planilha nova:

```sh
pip install openpyxl
python3 tools/extract_seed.py "Gestao_Viagens_Corporativas_AceGaming_2026.xlsx" assets/seed.js
python3 tools/merge_equipe.py "Ace Gaming_Gestao_Colaboradores.xlsx"
python3 tools/build_single.py
```

`merge_equipe.py` atualiza quem já existe, inclui quem entrou e não apaga o que a planilha de
origem deixa em branco — hoje, o gestor direto, que continua vindo da base de viagens. Cada
execução incrementa `baseEquipeVersao`; quem já usa o app recebe a base nova na próxima vez que
abrir, sem perder os lançamentos.

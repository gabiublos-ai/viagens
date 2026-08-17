# Publicar o site

O app pode rodar de três jeitos. O terceiro é o que você pediu: um endereço na
internet, protegido por senha, com todo mundo lançando na mesma base.

| | Onde os dados ficam | Quem acessa |
|---|---|---|
| `dist/gestao-viagens.html` | no navegador de quem abriu | quem tem o arquivo |
| `servidor/local.js` | num arquivo JSON na máquina que roda | quem alcança a máquina |
| **Cloudflare Workers** | **banco de dados na nuvem** | **quem tem o endereço e a senha** |

## Cloudflare Workers — o caminho recomendado

Plano gratuito atende com folga: o limite é de 100 mil requisições por dia e
5 GB de banco. Uma equipe de dezenas de pessoas usa uma fração disso.

Precisa de: uma conta na Cloudflare (grátis, cria em 2 minutos em
<https://dash.cloudflare.com/sign-up>) e o Node instalado.

```sh
git clone https://github.com/gabiublos-ai/viagens
cd viagens

# 1. entrar na sua conta Cloudflare (abre o navegador)
npx wrangler login

# 2. criar o banco de dados
npx wrangler d1 create viagens
```

O comando acima imprime um `database_id`. Copie e cole em `wrangler.toml`, na
linha `database_id = "PREENCHA_COM_O_ID_DO_SEU_BANCO"`.

```sh
# 3. escolher a senha de acesso
node servidor/senha.js "a senha que a equipe vai usar"
```

Isso imprime dois valores, `SENHA_HASH` e `SESSAO_SEGREDO`. A senha em si não
fica guardada em lugar nenhum — só o hash, que não permite voltar à senha
original. Guarde os dois valores e informe quando for pedido:

```sh
npx wrangler secret put SENHA_HASH        # cole o hash
npx wrangler secret put SESSAO_SEGREDO    # cole o segredo

# 4. montar o site e publicar
python3 tools/build_site.py
npx wrangler deploy
```

No fim aparece o endereço, algo como
`https://gestao-viagens.SEU-USUARIO.workers.dev`. É esse link que você
distribui. Quem abrir vê a tela de senha; quem entrar, vê e lança na mesma base.

### Trocar a senha depois

```sh
node servidor/senha.js "a nova senha"
npx wrangler secret put SENHA_HASH
```

As sessões abertas continuam valendo até 30 dias. Para derrubar todo mundo na
hora, troque também o `SESSAO_SEGREDO`.

### Publicar uma versão nova do app

```sh
git pull
python3 tools/build_site.py
npx wrangler deploy
```

Os dados ficam no banco e não são tocados pelo deploy.

### Domínio próprio

Se quiser `viagens.apostou.bet.br` em vez do endereço `.workers.dev`, adicione
o domínio à Cloudflare e, no painel do Worker, use **Settings → Domains &
Routes → Add custom domain**.

## Rodar numa máquina sua (ou num VPS)

Mesmo app, mesma senha, guardando o estado num arquivo JSON:

```sh
node servidor/senha.js "sua senha"     # gere os dois valores

SENHA_HASH='pbkdf2$...' \
SESSAO_SEGREDO='...' \
node servidor/local.js
```

Abre em <http://localhost:8787>. Variáveis aceitas: `PORTA`,
`ESTADO_ARQUIVO` (padrão `dados/estado.json`), `SITE_DIR`, `COOKIE_SEGURO=1`
quando estiver atrás de um proxy https.

Para publicar na internet dessa forma, coloque um proxy https na frente
(Caddy, nginx, Cloudflare Tunnel). Sem https o cookie de sessão trafega em
texto claro.

## O que a senha protege

- O site publicado **não leva nenhum dado**: `site/` tem só o código.
  As viagens, os colaboradores e as corridas chegam ao navegador depois do
  login, vindos do servidor. Sem senha, `GET /api/estado` responde 401.
- A senha é guardada como hash **PBKDF2-SHA256 com 310 mil iterações** e sal
  aleatório. Quem tiver acesso ao hash não consegue voltar à senha.
- A sessão é um cookie **HttpOnly, SameSite=Strict, Secure**, assinado com
  HMAC-SHA256 — não dá para forjar sem o `SESSAO_SEGREDO`.
- Login tem atraso fixo e corte em 8 tentativas por IP a cada 10 minutos.
- Toda escrita passa por validação no servidor: só os campos conhecidos entram,
  com os tipos certos.

O que ela **não** faz: é uma senha só, compartilhada, sem usuários individuais.
Todo mundo que entra pode lançar e apagar, e o registro de quem alterou vem do
nome digitado na entrada — serve para se organizar entre colegas, não como
controle de acesso. Se em algum momento precisar de contas separadas, com
permissão de leitura e de edição, dá para evoluir a partir daqui.

## Segredos e o repositório público

`SENHA_HASH` e `SESSAO_SEGREDO` vivem como secrets na Cloudflare (ou como
variáveis de ambiente, no modo local) e **nunca entram no repositório**. O
`wrangler.toml` versionado não contém nenhum dos dois.

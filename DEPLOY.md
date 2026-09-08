# Publicar o site

O app roda de quatro jeitos. O primeiro é o que você pediu: um endereço na
internet, com login por pessoa e todo mundo lançando na mesma base.

| | Onde os dados ficam | Quem acessa |
|---|---|---|
| **Netlify** | **Netlify Blobs** | **quem tem um acesso criado no sistema** |
| Cloudflare Workers | banco D1 | quem tem um acesso criado no sistema |
| `servidor/local.js` | num arquivo JSON na máquina que roda | quem alcança a máquina |
| `dist/gestao-viagens.html` | no navegador de quem abriu | quem tem o arquivo |

## Netlify — o caminho mais curto

Sem terminal e sem instalar nada: o Netlify lê o `netlify.toml` do repositório e
monta tudo sozinho. O plano gratuito atende com folga.

### 1. Criar o site (uma vez)

1. Entre em <https://app.netlify.com> → **Add new site** → **Import an existing project**.
2. Escolha **GitHub** e autorize, se ele pedir.
3. Selecione o repositório **gabiublos-ai/viagens**.
4. Não mexa em nada nas opções de build — `netlify.toml` já traz tudo:
   publica a pasta `site`, roda `npm install` e liga a função da API.
5. Clique em **Deploy**.

Em cerca de um minuto o site sobe num endereço como
`https://algum-nome-aleatorio.netlify.app`. Em **Site configuration → General →
Site details → Change site name** dá para trocar por algo como
`viagens-acegaming`.

Nesse primeiro momento o app ainda não entra: falta a senha mestre.

### 2. Definir a senha mestre

Cada pessoa da equipe vai ter o seu próprio login, criado dentro do sistema.
Antes disso é preciso uma **senha mestre**: é ela que abre a porta na primeira
vez e que serve de emergência se ninguém mais conseguir entrar. Ela fica só na
configuração do site e não circula pela equipe.

Abra **`/senha.html`** no seu site — por exemplo
`https://acegamingviagens.netlify.app/senha.html`.

Digite a senha mestre e clique em **Gerar**. A senha é transformada ali mesmo,
no seu navegador, e não é enviada a lugar nenhum. A página devolve dois
valores: `SENHA_HASH` e `SESSAO_SEGREDO`.

Depois, no Netlify:

1. **Site configuration → Environment variables → Add a variable**.
2. Crie `SENHA_HASH` com o primeiro valor e `SESSAO_SEGREDO` com o segundo —
   os nomes precisam ser exatamente esses.
3. **Deploys → Trigger deploy → Deploy site**.

### 3. Criar os acessos da equipe

Abra o site, entre com o seu e-mail e a senha mestre, e vá em
**Ajustes → Acessos → + Novo acesso**. Para cada pessoa informe o nome, o
e-mail corporativo `@acegaming.com.br` — é por ele que ela entra, e endereço de
outro domínio não é aceito — e o que ela pode fazer (*administra* ou *lança e
edita*). O sistema
mostra uma senha provisória — copie e entregue por um canal privado. Na
primeira entrada a pessoa escolhe a senha dela, e a provisória deixa de valer.

Crie o seu próprio acesso como **administra** e passe a usá-lo no dia a dia,
deixando a senha mestre guardada. A partir daí tudo que for incluído, alterado
ou excluído aparece em **Ajustes → Registro de alterações**, com nome e
horário.

### Trocar a senha mestre depois

Gere valores novos em `/senha.html`, atualize `SENHA_HASH` nas variáveis e
publique de novo. Isso não mexe nos acessos individuais nem derruba ninguém.

Trocar também o `SESSAO_SEGREDO` derruba na hora todas as sessões abertas.
Para tirar o acesso de uma pessoa só, o caminho é outro e não precisa de
deploy: **Ajustes → Acessos**, desativar ou remover — a sessão dela cai na
requisição seguinte.

### Publicar uma versão nova do app

Cada `git push` na branch do repositório dispara um deploy novo
automaticamente. Os dados ficam no Netlify Blobs e não são tocados.

### Onde os dados ficam

No **Netlify Blobs**, o armazenamento do próprio Netlify — não precisa criar
banco nem contratar nada. A leitura é configurada como forte
(`consistency: "strong"`), então logo depois de alguém salvar, a próxima
consulta já enxerga o valor novo.

### Domínio próprio

**Domain management → Add a domain** para usar algo como
`viagens.apostou.bet.br`. O Netlify emite o certificado https sozinho.

## Cloudflare Workers — alternativa

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
# 3. escolher a senha mestre (os acessos da equipe são criados dentro do app)
node servidor/senha.js "a senha mestre"
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
distribui. Quem abrir vê a tela de login; cada pessoa entra com o seu acesso e
todas lançam na mesma base. Entre com a senha mestre e crie os acessos em
**Ajustes → Acessos**.

### Trocar a senha mestre depois

```sh
node servidor/senha.js "a nova senha mestre"
npx wrangler secret put SENHA_HASH
```

Isso não mexe nos acessos individuais. As sessões abertas continuam valendo até
30 dias; para derrubar todo mundo na hora, troque também o `SESSAO_SEGREDO`.
Para tirar o acesso de uma pessoa só, desative-a em **Ajustes → Acessos** — vale
na requisição seguinte, sem deploy.

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

Mesmo app, mesmos acessos, guardando o estado num arquivo JSON:

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

`SENHA_HASH` e `SESSAO_SEGREDO` vivem como variáveis de ambiente no Netlify
(ou secrets na Cloudflare) e **nunca entram no repositório**. Nem o
`netlify.toml` nem o `wrangler.toml` versionados contêm qualquer um dos dois —
só os comentários explicando onde configurá-los.

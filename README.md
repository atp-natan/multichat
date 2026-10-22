# MultiChat

[![CI](https://github.com/maiconfontana/multichat/actions/workflows/ci.yml/badge.svg)](https://github.com/maiconfontana/multichat/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/maiconfontana/multichat)](https://github.com/maiconfontana/multichat/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)

Cliente desktop **multi-conta** para mensageiros web, construído em [Electron](https://www.electron.dev/).

Use WhatsApp, Microsoft Teams, Telegram, Discord, Slack (ou qualquer URL personalizada) em contas separadas dentro de um único aplicativo, com sidebar, notificações do sistema e contador de mensagens não lidas.

> Projeto derivado de [whatsapp-electron](https://github.com/dagmoller/whatsapp-electron) (fork de [SingleBox](https://github.com/hmami252/whatsapp-desktop-app)).

🌐 **Página do projeto e downloads:** <https://maiconfontana.github.io/multichat/>

---

## Download

Baixe o pacote da sua plataforma — nada de compilar:

| Plataforma | Arquivo | Observação |
|---|---|---|
| **Windows** 10/11 (x64) | `MultiChat-<versão>-setup.exe` | Instalador NSIS. Sem assinatura de código: o SmartScreen pede confirmação em *Mais informações → Executar assim mesmo* |
| **Windows** (portátil) | `MultiChat-<versão>-win-x64.zip` | Descompacte e execute; nada é instalado |
| **macOS** Apple Silicon | `MultiChat-<versão>-mac-arm64.dmg` | Veja [macOS: primeira abertura](#macos-primeira-abertura) |
| **macOS** Intel | `MultiChat-<versão>-mac-x64.dmg` | idem |
| **Linux** (x64) | `MultiChat-<versão>.AppImage` | `chmod +x` e execute |
| **Linux** (x64) | `multichat-<versão>.tar.xz` | Mesma build descompactada |

Os arquivos ficam na [página de releases](https://github.com/maiconfontana/multichat/releases)
junto com `SHA256SUMS.txt`, para conferir a integridade do download:

```bash
sha256sum -c SHA256SUMS.txt   # Linux
shasum -a 256 -c SHA256SUMS.txt   # macOS
```

Ao instalar uma versão nova, instale por cima da anterior: contas e preferências são preservadas.

### macOS: primeira abertura

O app não é notarizado pela Apple (isso exige o Apple Developer Program, pago). A partir da 1.7.1 o binário sai com **assinatura ad-hoc**, então o macOS não deve mais dizer que o app está “danificado”. Na primeira execução:

1. Clique com o botão direito no app → **Abrir** → **Abrir** (ou libere em *Ajustes do Sistema → Privacidade e Segurança → Abrir mesmo assim*).
2. Se ainda aparecer “danificado”, remova a marca de quarentena:

   ```bash
   xattr -dr com.apple.quarantine /Applications/MultiChat.app
   ```

## Atualizações

O app verifica a versão publicada no GitHub — a checagem é silenciosa, alguns segundos após abrir, e só
incomoda quando existe versão mais nova. A notificação **Há uma nova versão disponível** abre o changelog
ou baixa o instalador (SHA-256) e reinicia o app empacotado. Nada instala sem o seu clique.

- **Automaticamente:** ao iniciar (consulta à API de releases, 8 s de timeout, falha silenciosa).
- **Manualmente:** menu **Ajuda → Verificar atualizações…**, que mostra também quando você já está na versão mais recente.
- **Menu Ajuda:** atalhos para a página do projeto, a página de downloads e o formulário de issues.

A comparação de versões (`src/update-check.js`) é um módulo puro, coberto por testes em
`test/update-check.test.js`.

### Atualizar a instalação local (Linux)

Se você instalou o MultiChat em `~/.local/bin/multichat`, o script `update-local.sh`
baixa a última release, **confere o SHA-256** contra o `SHA256SUMS.txt` publicado e troca
o binário de forma atômica, guardando backup da versão anterior:

```bash
./update-local.sh              # verifica e atualiza
./update-local.sh --check      # só informa se há versão nova (exit 10 quando há)
./update-local.sh --yes        # sem confirmação (para scripts/cron)
./update-local.sh --rollback   # volta para o backup mais recente
```

Sem escolher nada, ele usa a release mais recente; `--version 1.6.0` fixa uma versão.
Também disponível como `npm run update:local`.

## Compilar localmente (sem baixar o instalador)

Compilar na própria máquina gera um binário que **não carrega a marca de origem do
download**, então ele abre sem o aviso do SmartScreen (Windows) e sem a quarentena
do Gatekeeper (macOS) — é a alternativa a assinar o aplicativo.

O custo é o download das dependências e do Electron (~1,3 GB) e alguns minutos de build:

```bash
./build-local.sh          # Linux e macOS: instala deps e gera o pacote da plataforma
./build-local.sh --dir    # só empacota, sem instalador (mais rápido)
npm run build:local       # equivalente
```

No Windows, use o PowerShell (`.\build-local.ps1`; veja o cabeçalho do arquivo para as
opções). Os dois scripts checam a versão do Node antes de começar.

> Isto é um caminho **opcional** para quem prefere não liberar manualmente um app
> baixado. Para a maioria dos casos, o pacote pronto da página de downloads é mais
> simples e mais rápido.

---

## Funcionalidades

- **Multi-conta**: várias contas do mesmo serviço ou de serviços diferentes, cada uma com seu próprio perfil de navegação (login isolado por conta)
- **Logo da conta**: na criação e na edição dá para enviar uma imagem que entra na moldura redonda da sidebar
- **Equilíbrio entre conexão e memória**: contas são criadas sob demanda (lazy-load), continuam ativas em segundo plano e só são suspensas após 60 minutos sem uso, devolvendo memória sem perder o login; o prazo é configurável; dá para hibernar todas, inclusive a última visível
- **Sidebar recolhível**: alterne entre a lista expandida (280px) e o modo compacto apenas com ícones (72px) — o estado é persistido entre inicializações
- **Atalhos por conta**: `Ctrl`/`⌘` + `1`…`9` alterna direto para a conta naquela posição da sidebar; mantenha o modificador pressionado e os números aparecem sobre os avatares, para não ter que decorar a ordem
- **Notificações desktop** com título da conta e clique para focar a conversa; pode ser ligado/desligado por conta
- **Contador de não lidas** por conta, refletido na sidebar, na bandeja (tray) e, no Mac, no badge nativo do Dock (até 99+)
- **Tray** (bandeja do sistema): minimizar/retornar para a bandeja em vez de fechar
- **Compartilhamento de tela** no WhatsApp Web, com seletor próprio de telas/janelas
- **Assistente contextual para WhatsApp**: lê somente as mensagens visíveis, gera um rascunho pela OpenAI e o insere no campo de edição para revisão e envio manual; não envia mensagens automaticamente
- **Correção ortográfica** (en-US, pt-BR)
- **Deeplinks**: `whatsapp://`, `wa.me`, `msteams://` / `ms-teams://` e links de reunião do Teams abrem no MultiChat; se houver mais de uma conta do mesmo tipo, o app pergunta qual usar
- **Funciona offline na interface**: os recursos da interface (Bootstrap e ícones) são carregados localmente, sem CDN

## Requisitos

| Item | Versão mínima |
|---|---|
| Node.js | v24 |
| npm | (vem com o Node) |
| git | qualquer recente |

Plataformas suportadas: **Linux**, **Windows** e **macOS** (Intel e Apple Silicon).

## Instalação (executar do código-fonte)

```bash
# 1. Clone o repositório
git clone https://github.com/maiconfontana/multichat.git

# 2. Entre no diretório
cd multichat

# 3. Instale as dependências
npm install

# 4. Inicie o app
npm run start
```

### Opções de linha de comando

| Flag | Efeito |
|---|---|
| `--start-in-tray` | Inicia direto na bandeja, sem mostrar a janela |
| `--disable-gpu` | Desabilita aceleração de hardware (útil em terminais/remotos) |
| `--spell-lang=xx-XX` | Idioma adicional da correção ortográfica (ex.: `--spell-lang=es-ES`) |
| `--whats-new-preview` | Abre o popup de novidades com todo o histórico de `src/whats-new.json` e não grava nada no estado do app (para revisar conteúdo antes de publicar) |
| `--whats-new-reset` | Simula ter acabado de atualizar: esquece a versão vista e abre o popup no fluxo normal |

A hibernação (descarregar da RAM uma conta fora de foco) é configurável por conta em **Editar conta**. O padrão é 60 minutos; desligar o interruptor mantém aquela conta sempre carregada. No menu de contexto (botão direito) dá para **Hibernar agora**, na hora — se for a conta visível, o MultiChat troca para outra antes de descarregar. A variável de ambiente `MULTICHAT_SUSPEND_MINUTES` ainda vale como padrão das contas que nunca foram ajustadas (`0` = nunca hibernar, máximo `1440`). Quanto maior o prazo e o número de contas abertas, maior o uso de RAM.

Exemplo:

```bash
MULTICHAT_SUSPEND_MINUTES=120 npm run start -- --start-in-tray --disable-gpu
```

## Uso

1. Ao abrir, a primeira conta padrão (WhatsApp) já está carregada.
2. **Adicionar conta**: clique no **＋** no topo da sidebar, escolha o tipo de serviço (WhatsApp, Teams, Telegram, Discord, Slack ou URL personalizada) e dê um nome. Com a sidebar recolhida, o formulário abre ao lado, como o menu de contexto.
3. **Alternar de conta**: clique no avatar na sidebar, use `Ctrl`/`⌘` + `1`…`9` para ir direto à conta naquela posição (a numeração segue a ordem da sidebar, então arrastar uma conta renumera todas), ou `Ctrl+Tab` / `Ctrl+Shift+Tab` para percorrer na ordem. Mantenha `Ctrl`/`⌘` pressionado e os números aparecem sobre os avatares — emende no próximo número sem soltar a tecla. A conta é carregada na primeira vez que for aberta.
4. **Recolher/expandir sidebar**: clique no botão de **painel** no topo da sidebar. No modo recolhido, o contador de não lidas aparece como badge sobre o avatar.
5. **Editar/remover conta**: passe o mouse sobre o item e use os botões de lápis e lixeira (ou botão direito no ícone). Com a sidebar recolhida, editar e remover abrem ao lado, como o menu de contexto. O menu também hiberna a conta na hora. Em **Editar conta** dá para ligar/desligar a hibernação automática e o tempo de inatividade. A remoção apaga o login daquela conta.
6. **Notificações**: o botão de sino por conta liga/desliga as notificações do sistema.
7. **Assistente contextual**: numa conta WhatsApp, abra em **Exibir → Assistente contextual** (`Ctrl/Cmd+Shift+A`), configure um gateway compatível com OpenAI (Responses API ou Chat Completions), a chave e os perfis de agente. A chave é criptografada pelo `safeStorage` do Electron; testar uma chave digitada não a salva, e com o campo vazio o teste usa a chave já salva. Pesquisa web só é habilitada para gateway marcado como capaz e no modo Responses API. Confira o rascunho antes de inseri-lo; o envio permanece sempre manual. Teams e outros serviços ainda não são suportados.
8. **Minimizar para a bandeja**: o botão fechar (X) esconde a janela; o ícone na bandeja mostra/oculta.

## Testes e verificação

```bash
npm test      # testes unitários, inclusive adaptador WhatsApp com DOM fake
npm run check # valida sintaxe dos processos principal, preloads e scripts
```

### Popup de novidades da versão

Toda versão publicada ganha um popup "Novidades" na primeira abertura depois de atualizar. O
conteúdo é curado à mão em `src/whats-new.json` (não vai para a tela o corpo cru da release ou os
commits): título curto, texto explicativo, até 3 bullets e, opcionalmente, uma demonstração de
atalho com `keys` + `demo: "modifier"`.

Para ver como ficou **antes** de commitar:

```bash
npm run whats-new:preview   # ou: npm start -- --whats-new-preview
```

Isso abre o popup com o histórico inteiro do JSON e não mexe no que já foi marcado como visto.
Para reproduzir o fluxo real (como quem acabou de atualizar):

```bash
npm start -- --whats-new-reset
```

Ao preparar uma release nova:

```bash
npm run whats-new -- 1.8.0      # rascunho a partir dos commits (feat/fix/perf)
npm run whats-new -- --check    # falha se a versão do package.json não tiver entrada
```

O rascunho nasce com `"draft": true` e títulos técnicos — reescreva em linguagem de produto e
remova o campo. `npm run whats-new:check` roda no CI e no job de release: é o que impede taguear
uma versão sem popup (ou com changelog técnico vazando para o usuário final).

## Build (distributíveis)

Gera pacotes com [electron-builder](https://www.electron.build):

```bash
npm run pack          # apenas empacota (sem instalador)
npm run dist:linux    # AppImage e tar.xz (Linux x64)
npm run dist:windows  # instalador NSIS + zip (Windows x64)
npm run dist:mac      # dmg + zip (macOS Intel e Apple Silicon)
npm run dist          # alvo padrão da plataforma atual
npm run icons         # regenera os ícones (inclui icon.ico p/ Windows)
```

Os pacotes saem na pasta `dist/`.

> **Release automática**: tags no formato `v*.*.*` disparam o workflow
> [.github/workflows/release.yml](.github/workflows/release.yml), que builda
> Linux, Windows e macOS em runners separados, gera `SHA256SUMS.txt` e publica
> um GitHub Release com todos os artefatos:
>
> ```bash
> npm run bump minor                     # sobe a versão em package.json + src/constants.js
> npm test                               # confirma, inclusive a sincronia das versões
> git commit -am "chore: release 1.6.0"
> git tag v1.6.0
> git push origin main --follow-tags
> ```

> **Página pública**: `docs/` é publicado no GitHub Pages por
> [.github/workflows/pages.yml](.github/workflows/pages.yml) em
> <https://maiconfontana.github.io/multichat/>. A página lista os downloads
> consultando a última release em tempo de execução, então publicar uma versão
> nova não exige republicar o site.

## Estrutura do projeto

```
├── src/
│   ├── main.js               # processo principal (janela, sidebar, contas, tray, lazy-load)
│   ├── constants.js          # nome do app, serviços suportados, eventos IPC
│   ├── resource-policy.js    # política configurável de suspensão de contas
│   ├── update-check.js       # comparação de versão e consulta de releases (sem Electron)
│   ├── account-shortcuts.js  # numeração dos atalhos ⌘/Ctrl+1…9 e aviso do modificador (sem Electron)
│   ├── assistant.html/js     # painel lateral do assistente contextual
│   ├── assistant-preload.js  # ponte IPC isolada do painel
│   ├── assistant-core.js     # validação e montagem do contexto
│   ├── openai-client.js      # cliente da Responses API
│   ├── whatsapp-assistant-adapter.js # leitura/inserção via DOM do WhatsApp
│   ├── preload.js            # ponte IPC da sidebar
│   ├── whatsapp-preload.js   # injeção no WhatsApp Web (não lidas, notificações)
│   ├── messenger-preload.js  # injeção genérica nos demais serviços
│   ├── accounts.html         # UI da sidebar (bootstrap)
│   ├── accounts.js           # lógica da sidebar
│   ├── screenshare.html      # seletor de compartilhamento de tela (janela própria)
│   ├── screenshare-preload.js# ponte IPC do seletor
│   └── vendor/               # bootstrap + ícones servidos localmente (sem CDN)
├── assets/                   # ícones do app (png + ico)
├── docs/                     # página pública publicada no GitHub Pages
├── scripts/gen-icon.js       # gera derivados do ícone a partir do PNG mestre
└── package.json              # metadata + config do electron-builder
```

## Contribuindo

Contribuições são muito bem-vindas — código, documentação, tradução ou apenas um relato de bug.

- Leia o [**guia de contribuição**](CONTRIBUTING.md) antes de abrir um pull request: ele traz o
  padrão de commits ([Conventional Commits](https://www.conventionalcommits.org/pt-br/)),
  o fluxo de branches, o que é esperado de um PR e o que está fora do escopo do projeto.
- [Abra uma issue](https://github.com/maiconfontana/multichat/issues/new/choose) para bugs e sugestões.
- O projeto segue o [Contributor Covenant 2.1](CODE_OF_CONDUCT.md).

### Segurança

**Não relate vulnerabilidades em issues públicas.** Use o canal privado
(*Report a vulnerability* na aba Security) descrito na [Política de Segurança](SECURITY.md).

## Licença

[MIT](LICENSE). Projeto derivado de [whatsapp-electron](https://github.com/dagmoller/whatsapp-electron)
(fork de [SingleBox](https://github.com/hmami252/whatsapp-desktop-app)) — os créditos de autoria
dos projetos originais são mantidos.

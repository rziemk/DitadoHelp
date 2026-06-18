# Scribeflowai Desktop (Tauri)

Base cross-platform do Scribeflowai (Mac/Windows/Linux).

## Pré-requisitos
- Node.js + npm
- Rust + Cargo (obrigatório para compilar Tauri)

### Instalar Rust (uma vez)
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

## Rodar frontend (sem Tauri)
```bash
cd desktop
npm install
npm run dev
```

## Rodar app desktop (Tauri)
```bash
cd desktop
npm install
npm run tauri:dev
```

## Build instaladores
```bash
cd desktop
npm run tauri:build
```

## Build macOS valida
Para parar o aviso do macOS de app "nao valido", o app precisa sair assinado e notarizado.

Setup mais simples no projeto:
```bash
cd desktop
cp .env.macos.example .env.macos.local
```

Preencha `desktop/.env.macos.local` com:
- `APPLE_SIGNING_IDENTITY`
- e uma das opcoes de notarizacao:
  - `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`
  - ou `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`

Depois rode:
```bash
cd desktop
npm run release:macos
```

Esse comando valida as variaveis e executa o `tauri build` pronto para assinatura/notarizacao no macOS.
Por padrao ele gera build `universal-apple-darwin`, compativel com Apple Silicon e Intel.

Se quiser forcar um target especifico:

```bash
cd desktop
TAURI_BUILD_TARGET=aarch64-apple-darwin npm run release:macos
```

## Publicar release no GitHub
Para publicar o `.dmg` oficial no GitHub Releases:

```bash
cd desktop
npm run publish:github
```

Esse comando:
- localiza o `.dmg` da versao atual
- gera arquivo `.sha256`
- cria ou atualiza a release `v<versao>` no GitHub

## Compatibilidade macOS
- `aarch64` abre apenas em Macs Apple Silicon
- `x86_64` abre apenas em Macs Intel
- `universal-apple-darwin` abre nos dois

Se outra maquina mostrar que o app "can't be opened", verifique primeiro:
- se o build baixado bate com a arquitetura da maquina
- se a maquina esta em macOS 11+ no caso de Apple Silicon

O fluxo oficial deste projeto agora publica o build universal por padrao.

Para fazer build oficial + publicacao em um comando:

```bash
cd desktop
npm run release:macos:github
```

## Auto-update
O projeto já está com seção de updater no `src-tauri/tauri.conf.json`, porém `active: false`.

Para ativar:
1. Publicar releases versionadas no GitHub.
2. Gerar e publicar manifesto de update (`latest.json`).
3. Trocar `active` para `true`.

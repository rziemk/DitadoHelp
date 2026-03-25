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

## Auto-update
O projeto já está com seção de updater no `src-tauri/tauri.conf.json`, porém `active: false`.

Para ativar:
1. Publicar releases versionadas no GitHub.
2. Gerar e publicar manifesto de update (`latest.json`).
3. Trocar `active` para `true`.

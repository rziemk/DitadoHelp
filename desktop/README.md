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

## Auto-update
O projeto já está com seção de updater no `src-tauri/tauri.conf.json`, porém `active: false`.

Para ativar:
1. Publicar releases versionadas no GitHub.
2. Gerar e publicar manifesto de update (`latest.json`).
3. Trocar `active` para `true`.

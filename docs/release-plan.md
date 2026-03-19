# Scribeflowai release plan

## Status atual

- App desktop Tauri consolidado como versao oficial.
- Historico local em `Documents/Scribeflowai/conversations.jsonl`.
- Criacao automatica do arquivo de historico.
- Escolha de pasta de historico.
- Importacao de historico.
- Exportacao manual de backup.

## Proxima fase de engenharia

### 1. Updater para builds fora da loja

Objetivo:
- Atualizar instalacoes distribuidas por site/GitHub Releases.

Pendencias:
- Adicionar `tauri-plugin-updater`.
- Gerar chave publica/privada de assinatura do updater.
- Publicar artefatos e `latest.json` em endpoint estavel.
- Manter updater desligado para builds da Mac App Store.

Entregaveis:
- Script de release.
- Configuracao de endpoint por ambiente.
- Fluxo de verificacao e aplicacao de update no app.

### 2. Login

Objetivo:
- Definir se login serve para `sync`, `licenca`, `assinatura` ou `backup`.

Decisao recomendada:
- Nao implementar UI de login antes de fechar o objetivo.
- Se a prioridade for monetizacao e multiplas maquinas, focar em `licenca + sync de historico`.

Pendencias:
- Escolher backend de autenticacao.
- Definir modelo de sessao.
- Definir storage seguro de token.
- Definir politica de privacidade.

### 3. Publicacao Mac App Store

Objetivo:
- Publicar primeiro no ecossistema Apple para macOS.

Pendencias:
- Conta Apple Developer ativa.
- App ID / Bundle ID final.
- Assinatura do app.
- Notarizacao / validacoes Apple.
- Cadastro do app no App Store Connect.
- Metadados de loja, icones, screenshots e politica de privacidade.

### 4. Windows Store

Objetivo:
- Publicar apos estabilizar o fluxo Mac.

Pendencias:
- Conta Partner Center.
- Pacote e manifestos revisados.
- Validacao de instalacao e atualizacao no Windows.

### 5. iOS e Android

Objetivo:
- Tratar como frente separada.

Motivo:
- O produto atual e desktop-first.
- Captura de audio, UX, login e monetizacao mobile exigem outro ciclo.

## Comercializacao

### Modelo recomendado

- App pago unico para desktop inicial.
- Assinatura apenas quando houver login + sync + backup online + licenca.

### Cobranca

- Fora da loja: Stripe/Lemon Squeezy/Paddle.
- Na Apple: compras e assinaturas conforme regras da App Store para bens digitais.

## Checklist operacional

- [ ] Fechar objetivo do login.
- [ ] Implementar updater fora da loja.
- [ ] Gerar primeira build assinada de distribuicao.
- [ ] Preparar pacote para Mac App Store.
- [ ] Publicar no App Store Connect.
- [ ] Revisar estrategia comercial apos primeira release publica.

## Referencias oficiais

- Tauri updater: https://v2.tauri.app/plugin/updater/
- Tauri distribute / app store: https://v2.tauri.app/distribute/app-store/
- Apple App Store submission: https://developer.apple.com/app-store/submitting/
- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Apple Developer Program: https://developer.apple.com/programs/
- Apple Small Business Program: https://developer.apple.com/app-store/small-business-program/
- Microsoft Store publishing: https://learn.microsoft.com/en-us/windows/apps/publish/

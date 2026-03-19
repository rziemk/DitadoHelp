# Scribeflowai Cloudflare backend

## Estado atual

Backend inicial criado em:
- `/Users/rz80/DitadoHelp/cloudflare-api`

Recursos ja provisionados:
- Worker: `scribeflowai-api`
- D1: `scribeflowai-prod`
- URL atual: `https://scribeflowai-api.rz-f38.workers.dev`

Funcionalidades atuais:
- `GET /health`
- `POST /auth/request-magic-link`
- `POST /auth/verify`
- `GET /me`
- `POST /devices/heartbeat`
- `GET /sync/conversations`
- `POST /sync/conversations`
- `GET /updates/latest`
- `GET /admin/online-users`

## Banco D1

Tabelas criadas:
- `users`
- `magic_links`
- `sessions`
- `devices`
- `conversations`
- `app_updates`

Migracao aplicada:
- `migrations/0001_initial.sql`

## Como rodar

```bash
cd /Users/rz80/DitadoHelp/cloudflare-api
npm install
npx wrangler dev
```

## Como publicar

```bash
cd /Users/rz80/DitadoHelp/cloudflare-api
npx wrangler deploy
```

## Secrets que faltam

Para login por email real, defina:

```bash
cd /Users/rz80/DitadoHelp/cloudflare-api
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put MAIL_FROM
npx wrangler secret put ADMIN_API_KEY
```

Sem `RESEND_API_KEY` e `MAIL_FROM`, o endpoint de magic link continua funcionando em modo debug quando `DEBUG_MAGIC_LINKS = "1"`.

## Dominio

Estado atual:
- `api.scribeflowai.com` responde e pode ser usado para `GET /auth/verify`
- `scribeflowai.com` ainda nao esta configurado no DNS, entao `APP_URL` deve ficar vazio por enquanto

Quando `scribeflowai.com` estiver pronto na Cloudflare:

Objetivo recomendado:
- `api.scribeflowai.com` -> Worker `scribeflowai-api`

Passos:
- adicionar o dominio a conta Cloudflare
- configurar DNS / custom domain do Worker
- trocar `APP_URL` e `API_BASE_URL` no `wrangler.toml`
- fazer novo deploy

## Email / magic link

Modelo escolhido:
- `magic link`

Implementacao atual:
- cria usuario se nao existir
- gera token unico
- grava hash do token em `magic_links`
- cria `session` e `device` ao verificar

Pendencias para producao:
- configurar remetente valido no dominio
- ligar envio de email real
- implementar tela de login no app Tauri
- implementar abertura automatica do app via deep link ou fluxo de colar token

## Historico sincronizado

Implementacao atual no backend:
- pull por `updated_at`
- push com upsert por `id`

Pendencias no app desktop:
- autenticar com `session_token`
- enviar `devices/heartbeat`
- fazer push/pull de `conversations`
- tratar merge e delecao

## Online users

Endpoint:
- `GET /admin/online-users?minutes=30`

Header obrigatorio:
- `x-admin-key: <ADMIN_API_KEY>`

Uso:
- lista dispositivos com `last_seen_at` recente
- serve para saber quem esta ativo

## Updates

Para builds fora da loja:
- endpoint pronto: `GET /updates/latest?channel=stable`
- tabela pronta: `app_updates`

Pendencia:
- publicar versoes nesta tabela
- integrar com o app desktop fora da App Store

Para Mac App Store:
- updates continuam sendo geridos pela Apple

## App Store e cobranca

Prioridade definida:
- App Store primeiro

Consequencia tecnica:
- cobrar pela Apple com In-App Purchase / subscriptions na fase de billing
- o backend precisara validar e refletir entitlements da Apple no banco

Ainda nao implementado:
- verificacao de recibo
- tabela de transacoes Apple
- reconciliacao de assinatura/licenca

## Proximo passo recomendado

1. Comprar e conectar `scribeflowai.com` na Cloudflare
2. Configurar email real para magic link
3. Criar tela de login no app Tauri
4. Integrar sync completo do historico
5. Implementar camada de entitlements para App Store

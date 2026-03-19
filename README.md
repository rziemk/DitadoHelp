# Scribeflowai

## Qual versão abrir
- UI **mais nova** (igual ao layout com `Consulta LLM` e `Reescrever com LLM F12`): rode `desktop/` (`npm run dev` ou `npm run tauri:dev`).
- UI **legada** em Tkinter: rode `python app.py`.

Aplicativo desktop (Python + Tkinter) para:
1. Iniciar/parar gravacao por atalho
2. Fazer speech-to-text
3. Copiar o texto para clipboard
4. Colar automaticamente no campo/app ativo
5. Reescrever/traduzir com LLM (OpenAI, Gemini ou Grok)

## Interface
Ao executar `python app.py`, abre uma janela com:
- Nome e icone da aplicacao: `Scribeflowai` (logo de microfone no cabecalho)
- Campo `OPENAI_API_KEY (STT)` para speech-to-text
- Seletor de LLM de texto: `free` (padrao), `openai`, `gemini`, `grok`
- Seletor de idioma da traducao: `Português`, `Inglês`, `Espanhol`, `Francês`, `Alemão`
- Campo de chave da LLM selecionada
- Campo de modelo da LLM
- Botao **Salvar configuracao**
- Botoes de gravacao
- Botao `Acoes no Texto` com 3 opcoes:
  - Reescrever prompt
  - Retraduzir
  - Reescrever texto
- Botao **Copiar status**
- Botao **Copiar resultado**
- Painel de status
- Painel com ultimo texto inserido
- Contador dinamico de `Palavras` e `Tokens (est.)` no resultado

## Indicador de gravacao
Durante a gravacao, o app mostra um painel visual no proprio app:
- Estado de gravacao (pronto/gravando)
- Waveform animado, reagindo em tempo real ao volume da voz
- Dica contextual para parar com `Enter`/`Espaco`

## Feedback de processamento
- Ao finalizar a gravacao, o app mostra imediatamente `Processando...` com barra animada.
- O botao `Parar` muda para `Parar Processamento` durante a geracao.
- Se interromper, o processamento e cancelado e o indicador some.

## Atalhos
- `F8`: ditado normal (start/stop)
- `F9`: ditado + reescrita pela LLM selecionada
- `F10`: ditado + traducao para o idioma selecionado na interface
- `F11`: ditado + geracao de prompt no estilo Codex
- `F12`: atalho alternativo para ditado + reescrita
- `Enter` ou `Espaco`: para gravacao em andamento

Observacao de estabilidade no macOS:
- Em macOS com Python `3.14+`, hotkeys globais via `pynput` podem crashar.
- Nesse caso, use botoes e atalhos com foco na janela.
- Para hotkeys globais estaveis, use Python `3.12`.

## Requisitos
- macOS (ideal para fluxo de colar no app ativo)
- Python 3.10+
- Permissoes do macOS para Terminal/iTerm/Python:
  - Microfone
  - Acessibilidade (para enviar `Cmd+V`)
  - Entrada de teclado (se solicitado)

## Instalar
```bash
cd /Users/rz80/DitadoHelp
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Como cadastrar as chaves
1. Execute `python app.py`
2. Preencha `OPENAI_API_KEY (STT)` (obrigatoria para transcricao)
3. A LLM padrao de texto e `free` (sem chave, pronta para uso)
4. Se usar `openai`, pode manter a opcao de reutilizar a chave STT
5. Se usar `gemini` ou `grok`, informe a chave da LLM escolhida
6. Ajuste o modelo (opcional)
7. Clique em **Salvar configuracao**

As configuracoes ficam em `/Users/rz80/DitadoHelp/.env`.

### Regra de prioridade de chave (texto)
1. Se `LLM Texto = free`, o app funciona sem chave para reescrever/traduzir.
2. Se existir chave configurada para o provedor selecionado, o app usa essa chave.
3. Se nao existir e a opcao estiver ativa, o app tenta `LLM Free pre-configurada`.
4. Se ainda nao existir, usa fallback para `OPENAI_API_KEY (STT)` quando possivel.

### Modo LLM Free pre-configurada
Para distribuir com uma chave padrao no seu ambiente, defina:
```bash
export HELPSCRIBE_FREE_LLM_API_KEY="sua_chave_free"
export HELPSCRIBE_FREE_LLM_PROVIDER="gemini"   # openai|gemini|grok
export HELPSCRIBE_FREE_LLM_MODEL="gemini-2.0-flash"
```

## Executar
```bash
cd /Users/rz80/DitadoHelp
source .venv/bin/activate
python app.py
```

## Fluxo rapido
1. Deixe o cursor no campo onde quer inserir texto.
2. Pressione `F8` (ou clique em `Dictar`) e fale.
3. Pare com `Enter`, `Espaco` ou botao/atalho novamente.
4. O texto sera transcrito, copiado e colado automaticamente.
5. Clique em `Acoes no Texto` para transformar a transcricao com a opcao desejada.

## Prompt Codex por ditado
- Use `F11` (ou botao `Dictar + Prompt Codex`) para transformar sua fala em um prompt estruturado para Codex.
- Tambem pode usar comando no final da fala: `gerar prompt codex` ou `transformar em prompt codex`.

## Observacoes
- STT usa OpenAI (`OPENAI_API_KEY`) nesta versao.
- Reescrita/traducao usa a LLM selecionada (OpenAI/Gemini/Grok).
- Nao existe chave publica segura para distribuir em app; cada usuario deve informar sua propria chave.
- Erro `401 invalid_api_key`: a chave salva esta invalida/revogada/errada.

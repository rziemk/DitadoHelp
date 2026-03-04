# Ditado Help

Aplicativo desktop (Python + Tkinter) para:
1. Iniciar/parar gravacao por atalho
2. Fazer speech-to-text
3. Copiar o texto para clipboard
4. Colar automaticamente no campo/app ativo
5. Reescrever/traduzir com LLM (OpenAI, Gemini ou Grok)

## Interface
Ao executar `python app.py`, abre uma janela com:
- Campo `OPENAI_API_KEY (STT)` para speech-to-text
- Seletor de LLM de texto: `openai`, `gemini`, `grok`
- Campo de chave da LLM selecionada
- Campo de modelo da LLM
- Botao **Salvar configuracao**
- Botoes de gravacao
- Botao **Copiar status**
- Botao **Copiar resultado**
- Painel de status
- Painel com ultimo texto inserido

## Indicador de gravacao
Durante a gravacao, o app mostra um painel visual no proprio app:
- Estado de gravacao (pronto/gravando)
- Medidor animado em barras, reagindo em tempo real ao volume da voz
- Dica contextual para parar com `Enter`/`Espaco`

## Feedback de processamento
- Ao finalizar a gravacao, o app mostra imediatamente `Processando...` com barra animada.
- O botao `Parar` muda para `Parar Processamento` durante a geracao.
- Se interromper, o processamento e cancelado e o indicador some.

## Atalhos
- `F8`: ditado normal (start/stop)
- `F9`: ditado + reescrita pela LLM selecionada
- `F10`: ditado + traducao para ingles pela LLM selecionada
- `F11`: ditado + geracao de prompt no estilo Codex
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
3. Escolha a LLM de texto (`openai`, `gemini` ou `grok`)
4. Se usar `openai`, pode manter a opcao de reutilizar a chave STT
5. Se usar `gemini` ou `grok`, informe a chave da LLM escolhida
6. Ajuste o modelo (opcional)
7. Clique em **Salvar configuracao**

As configuracoes ficam em `/Users/rz80/DitadoHelp/.env`.

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

## Prompt Codex por ditado
- Use `F11` (ou botao `Dictar + Prompt Codex`) para transformar sua fala em um prompt estruturado para Codex.
- Tambem pode usar comando no final da fala: `gerar prompt codex` ou `transformar em prompt codex`.

## Observacoes
- STT usa OpenAI (`OPENAI_API_KEY`) nesta versao.
- Reescrita/traducao usa a LLM selecionada (OpenAI/Gemini/Grok).
- Erro `401 invalid_api_key`: a chave salva esta invalida/revogada/errada.

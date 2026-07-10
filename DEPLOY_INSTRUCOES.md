# Guia de Deploy — Eletrium Field (PWA com offline real)

## Parte 1 — Backend (Apps Script)

1. Abra o projeto **Eletrium OS** no Apps Script (o mesmo de sempre,
   `script.google.com` → planilha → Extensões → Apps Script)
2. Clique no arquivo **`API.gs`** (já existe, hoje está vazio)
3. Apague o conteúdo e cole o arquivo `API.gs` que te entreguei
4. Clique em **Salvar** (ícone de disquete)
5. **Implantar → Nova implantação**
   - Tipo: **App da Web**
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
6. Clique em **Implantar** e **copie a URL gerada** (termina em `/exec`)
7. **Teste rápido antes de seguir:** no editor, selecione a função
   `testarDoPost` no menu suspenso ao lado de "Depuração" e clique em
   **Executar**. Veja o **Registro de execução** — deve mostrar a
   lista de técnicos em JSON, sem erro. Se der erro, pare aqui e
   me traga o erro exato antes de continuar.

## Parte 2 — Frontend (arquivos para o GitHub)

Você vai receber 4 arquivos: `index.html`, `manifest.json`, `sw.js`,
`icon-192.png`, `icon-512.png`.

**Antes de subir, um passo obrigatório:**
Abra o `index.html` num editor de texto, procure a linha:
```
const API_URL = 'COLE_AQUI_A_URL_DO_APPS_SCRIPT_/exec';
```
E troque pela URL real que você copiou na Parte 1, passo 6.

## Parte 3 — Publicar no GitHub Pages

1. No GitHub, clique em **"+"** (canto superior direito) → **New repository**
2. Nome do repositório: `eletrium-field` (ou o que preferir)
3. Marque **Public** (obrigatório para o GitHub Pages gratuito funcionar)
4. Clique em **Create repository**
5. Na tela do repositório vazio, clique em **"uploading an existing file"**
6. Arraste os 5 arquivos (`index.html`, `manifest.json`, `sw.js`,
   `icon-192.png`, `icon-512.png` — já com a URL corrigida no index.html)
7. Clique em **Commit changes**
8. Vá em **Settings** (aba do repositório) → **Pages** (menu lateral)
9. Em "Source", selecione **Deploy from a branch** → Branch: **main** → pasta **/ (root)**
10. Clique em **Save**
11. Espere ~1 minuto, atualize a página — vai aparecer uma URL tipo:
    `https://SEU-USUARIO.github.io/eletrium-field/`

**Essa é a URL que você manda pro Carlos e pro Paulo.**

## Parte 4 — Teste de instalação

**No Android (Chrome):**
1. Abra a URL do GitHub Pages
2. Deve aparecer um banner "Adicionar à tela inicial" — toque nele
   (se não aparecer sozinho, toque nos 3 pontinhos → "Instalar app")

**No iPhone (Safari):**
1. Abra a URL do GitHub Pages
2. Toque no ícone de **Compartilhar** (quadrado com seta pra cima)
3. Toque em **"Adicionar à Tela de Início"**

## Parte 5 — Teste de offline (o mais importante)

1. Com o app já instalado e aberto uma vez (pra cachear),
   **ative o modo avião** no celular
2. Feche e reabra o app pelo ícone da tela inicial
3. **Deve abrir normalmente** (a tela de login/lista de técnicos
   aparece, mesmo sem sinal)
4. Tente fazer login, iniciar uma OS — deve funcionar e mostrar
   uma mensagem tipo "(offline — sincroniza depois)"
5. **Desative o modo avião**
6. Em alguns segundos, o app deve sincronizar sozinho os dados
   que ficaram na fila (isso acontece automaticamente quando a
   conexão volta)

Se o passo 3 falhar (app não abre offline), o Service Worker não
cacheou corretamente — nesse caso me chame de volta com o que
aconteceu.

## Observação sobre o CORS

O `index.html` usa `Content-Type: text/plain` (não `application/json`)
nas chamadas para o Apps Script — isso é proposital, evita um
problema técnico de CORS que travaria toda chamada. Não mude isso
sem entender por quê (está comentado no código).

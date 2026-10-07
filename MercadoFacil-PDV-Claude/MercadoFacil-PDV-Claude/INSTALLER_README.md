# Instalador Windows — MercadoFácil PDV

O app desktop roda a **cópia empacotada da SPA** (servida pelo protocolo interno
`mercadofacil://app`) e fala direto com o **Supabase**. É isso que mantém o caixa
vendendo quando a loja fica sem internet — não há URL remota obrigatória e não há
nada de Base44 no pacote.

O binário tem ~99 MB, então não fica no repositório nem no deploy: ele é
publicado no repositório **público** de instaladores
[`Guarni7/MercadoFacil-PDV-releases`](https://github.com/Guarni7/MercadoFacil-PDV-releases/releases),
que também serve de feed para o auto-update. O código-fonte segue privado.

## Publicar uma versão

```bash
# 1. sobe a versão em package.json e em src/lib/desktopDownload.js
node scripts/release-desktop.mjs          # build + artefatos em release-artifacts/
node scripts/publish-github-release.mjs --dir=release-artifacts
```

Os três arquivos publicados:

| Arquivo | Para quê |
| --- | --- |
| `MercadoFacilPDV-Setup-<versão>.exe` | download manual (~99 MB) |
| `latest.yml` | feed lido pelo auto-update |
| `...exe.blockmap` | download diferencial da atualização |

O token do GitHub vem do credential manager do git (ou `GITHUB_TOKEN`).

## Atualização automática

O app checa o feed ao abrir e a cada 6 h, baixa a nova versão em segundo plano e
instala ao fechar (`electron-updater`, provider `github` apontando para o repo de
releases). Testado de ponta a ponta: um 1.3.0 instalado baixou sozinho o 1.3.1
publicado no GitHub.

O banco local do terminal (IndexedDB em `%APPDATA%/MercadoFacilPDV`) sobrevive à
atualização: o origin `mercadofacil://app` é fixo e o NSIS usa
`deleteAppDataOnUninstall: false`.

## Verificações automatizadas

```bash
node scripts/verify-electron.mjs                       # abre a SPA local, sem internet
node scripts/verify-electron.mjs --exe=<caminho.exe>   # mesma checagem no app instalado
node scripts/verify-electron-update.mjs                # 1.3.0 baixa a 1.3.1 de um feed real
```

`verify-electron.mjs` também falha se o bundle contiver qualquer referência a
Base44 ou não tiver a URL do Supabase. Ele roda dentro de `scripts/smoke-all.mjs`.

## Variáveis

| Variável | Uso |
| --- | --- |
| `MF_URL` | força o app a carregar uma URL publicada (testes contra o preview) |
| `MF_UPDATE_URL` | sobrescreve o feed de atualização (testes) |
| `MF_DEV_SERVER` | em dev, carrega `http://localhost:5173` em vez do `dist/` |
| `VITE_DESKTOP_INSTALLER_URL` | muda o link de download exibido no site |

## Ícones

A identidade visual (logo e ícone) vem das 3 imagens aprovadas em `branding/source/`. `electron/build/icon.png` e `icon.ico` (exe, atalhos e instalador do Windows), `public/favicon.ico` e `public/brand/*` (favicon, PWA, logo, imagem de compartilhamento) são gerados delas, sem redesenhar nada:

```bash
node scripts/build-brand-assets.cjs
```

/**
 * Instalador Windows do PDV. O app desktop roda a cópia empacotada da SPA
 * (funciona sem internet) e fala direto com o Supabase — sem CDN Base44.
 *
 * O binário (~99 MB) fica no repositório público de instaladores, não no
 * deploy: `node scripts/release-desktop.mjs` gera e
 * `node scripts/publish-github-release.mjs` publica.
 * Override de hospedagem: VITE_DESKTOP_INSTALLER_URL.
 */
const VERSION = "1.3.1";
const FILE_NAME = `MercadoFacilPDV-Setup-${VERSION}.exe`;
const RELEASE_BASE =
  "https://github.com/Guarni7/MercadoFacil-PDV-releases/releases/download";

export const DESKTOP_INSTALLER = {
  version: VERSION,
  channel: "stable",
  fileName: FILE_NAME,
  path:
    import.meta.env.VITE_DESKTOP_INSTALLER_URL ||
    `${RELEASE_BASE}/v${VERSION}/${FILE_NAME}`,
  label: "Baixar para Windows",
  sizeLabel: "~99 MB",
  platforms: "Windows 10/11 (64 bits)",
  notes: "Funciona offline: vendas ficam no terminal e sincronizam ao voltar a conexão.",
};

export function getInstallerUrl() {
  return DESKTOP_INSTALLER.path;
}

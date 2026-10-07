import { useEffect } from "react";
import { Link } from "react-router-dom";
import { DESKTOP_INSTALLER, getInstallerUrl } from "@/lib/desktopDownload";

/** /downloads/* antigo (ex.: .exe) → ZIP no CDN, sem 404 do SPA. */
export default function DownloadRedirect() {
  useEffect(() => {
    window.open(getInstallerUrl(), "_blank", "noopener,noreferrer");
    const t = setTimeout(() => {
      window.location.replace("/baixar");
    }, 500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-gray-50 p-6 text-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-emerald-600" />
      <p className="text-sm font-medium text-gray-700">Iniciando download do instalador (ZIP)…</p>
      <a
        className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white"
        href={getInstallerUrl()}
        download={DESKTOP_INSTALLER.fileName}
        target="_blank"
        rel="noopener noreferrer"
      >
        Clique aqui se o download não começar
      </a>
      <Link to="/baixar" className="text-sm text-gray-600 underline">
        Voltar para Baixar App
      </Link>
    </div>
  );
}

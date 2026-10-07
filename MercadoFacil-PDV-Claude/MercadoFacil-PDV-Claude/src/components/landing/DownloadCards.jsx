import React, { useEffect, useState } from "react";
import { Monitor, Smartphone, Globe, Download, ExternalLink, Check } from "lucide-react";
import { DESKTOP_INSTALLER, getInstallerUrl } from "@/lib/desktopDownload";

const TEAL = "#059669";
const TEAL_DARK = "#0F766E";
const BLUE = "#2563EB";

// Cartões de instalação (Windows/Android/Web) + lógica de instalação PWA.
// Usado tanto pela página cheia (src/pages/Baixar.jsx, link direto/sidebar)
// quanto pela seção "Baixar" embutida na Landing — mesmo código, dois lugares.
export default function DownloadCards() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);

    const nav = /** @type {Navigator & { standalone?: boolean }} */ (window.navigator);
    if (window.matchMedia("(display-mode: standalone)").matches || nav.standalone) {
      setInstalled(true);
    }

    window.addEventListener("appinstalled", () => setInstalled(true));

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) {
      alert(
        "Para instalar:\n\nNo Chrome ou Edge, clique no ícone de instalação (⊕) na barra de endereço, ou no menu (⋮) selecione 'Instalar app'."
      );
      return;
    }
    setInstalling(true);
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setDeferredPrompt(null);
    setInstalling(false);
  };

  const openWebApp = () => {
    window.location.href = "/";
  };

  const handleWindowsDownload = (e) => {
    e.preventDefault();
    window.open(getInstallerUrl(), "_blank", "noopener,noreferrer");
  };

  return (
    <div className="w-full">
      <div className="grid md:grid-cols-3 gap-5">
        {/* Windows */}
        <div className="bg-white rounded-2xl shadow-md p-6 flex flex-col">
          <div className="flex items-start justify-between mb-5">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: BLUE }}>
              <Monitor className="w-6 h-6 text-white" />
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
              WINDOWS 10 · 11
            </span>
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">Desktop Windows</h3>
          <p className="text-sm text-gray-500 mb-6 flex-1">
            Instalador v{DESKTOP_INSTALLER.version}: o PDV fica no computador do caixa e
            <strong> continua vendendo sem internet</strong>. As vendas sobem sozinhas quando a
            conexão voltar.
          </p>
          <a
            href={getInstallerUrl()}
            download={DESKTOP_INSTALLER.fileName}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleWindowsDownload}
            className="w-full h-11 rounded-lg flex items-center justify-center gap-2 text-white font-medium text-sm transition-opacity hover:opacity-90"
            style={{ backgroundColor: TEAL }}
          >
            <Download className="w-4 h-4" /> Baixar instalador
          </a>
          <p className="mt-2 text-center text-[11px] text-gray-400">
            v{DESKTOP_INSTALLER.version} · {DESKTOP_INSTALLER.sizeLabel}
          </p>
          <p className="mt-3 text-[11px] leading-snug text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-2">
            Instale <strong>uma vez</strong>. As atualizações do sistema chegam pela nuvem —
            <strong> não precisa baixar o instalador de novo</strong> a cada novidade.
          </p>
        </div>

        {/* Android */}
        <div className="bg-white rounded-2xl shadow-md p-6 flex flex-col">
          <div className="flex items-start justify-between mb-5">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: TEAL }}>
              <Smartphone className="w-6 h-6 text-white" />
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
              ANDROID
            </span>
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">Android / celular (PWA)</h3>
          <p className="text-sm text-gray-500 mb-6 flex-1">
            <strong>Não há app na Play Store.</strong> No Chrome Android: abra o site → menu ⋮ →
            &quot;Instalar app&quot; ou &quot;Adicionar à tela inicial&quot;. Usa o sistema atual online
            (e cache local quando o PWA estiver instalado).
          </p>
          <button
            onClick={handleInstall}
            disabled={installed || installing}
            className="w-full h-11 rounded-lg flex items-center justify-center gap-2 bg-white border border-gray-800 text-gray-900 font-medium text-sm transition-colors hover:bg-gray-50 disabled:opacity-60"
          >
            {installed ? (
              <>
                <Check className="w-4 h-4" /> App instalado
              </>
            ) : (
              <>
                <Download className="w-4 h-4" /> {installing ? "Instalando..." : "Instalar no celular"}
              </>
            )}
          </button>
        </div>

        {/* Web */}
        <div className="bg-white rounded-2xl shadow-md p-6 flex flex-col">
          <div className="flex items-start justify-between mb-5">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: TEAL_DARK }}>
              <Globe className="w-6 h-6 text-white" />
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
              NAVEGADOR
            </span>
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">Acesso web</h3>
          <p className="text-sm text-gray-500 mb-6 flex-1">
            Mesmo sistema atual no Chrome/Edge, sem instalar. Ideal para gestão no computador
            com internet. Use &quot;Abrir sistema&quot; abaixo.
          </p>
          <button
            onClick={openWebApp}
            className="w-full h-11 rounded-lg flex items-center justify-center gap-2 bg-white border border-gray-800 text-gray-900 font-medium text-sm transition-colors hover:bg-gray-50"
          >
            <ExternalLink className="w-4 h-4" /> Abrir sistema
          </button>
        </div>
      </div>

      {/* Note */}
      <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-950 max-w-3xl mx-auto">
        <p className="font-semibold mb-1">Atualizações automáticas — sem reinstalar</p>
        <p className="text-emerald-900/90 leading-relaxed">
          Instale uma vez. Com internet, o app baixa as novas versões em segundo plano e aplica
          ao fechar o programa — sem baixar o instalador de novo e sem perder as vendas
          guardadas no caixa. Baixe manualmente só em um PC novo.
        </p>
      </div>
      <p className="text-center text-sm text-gray-400 mt-4">
        O app funciona offline após a primeira abertura — vendas ficam na fila e sincronizam sozinhas quando a internet voltar.
      </p>
    </div>
  );
}

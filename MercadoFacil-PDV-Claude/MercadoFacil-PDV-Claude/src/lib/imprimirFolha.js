import { electronWindow } from "@/lib/electronWindow";

/**
 * Imprime uma folha HTML (ex.: plaquinhas de QR) escolhendo a impressora na caixa de diálogo do sistema —
 * diferente do cupom, que sai direto na térmica. Electron: mf:print:html com silent:false; navegador: janela + print().
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function imprimirFolhaHtml(html) {
  const win = electronWindow();
  if (typeof window !== "undefined" && win.electronAPI?.printHtml) {
    try {
      const r = await win.electronAPI.printHtml({ html, silent: false });
      return { ok: !!r?.ok, error: r?.error };
    } catch (e) {
      return { ok: false, error: e?.message };
    }
  }
  try {
    const janela = window.open("", "_blank", "width=900,height=900");
    if (!janela) return { ok: false, error: "O navegador bloqueou a janela de impressão. Libere pop-ups para este site." };
    janela.document.open();
    janela.document.write(html);
    janela.document.close();
    janela.focus();
    setTimeout(() => janela.print(), 400);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message };
  }
}

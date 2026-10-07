// Ponte pro autoUpdater real do processo main (electron/main.cjs). Fora do
// Electron (web/PWA) essas funções são no-op — não existe autoUpdater ali.
import { electronWindow } from "@/lib/electronWindow";
import { verificarAtualizacao } from "@/lib/atualizacaoDesktop";

export const hasElectronUpdate = () => !!electronWindow().electronAPI?.update;

/** Pede pro processo main checar atualização agora, sem esperar o timer de 6h. */
export const checkForUpdateNow = () => {
  const update = electronWindow().electronAPI?.update;
  if (!update) return Promise.resolve(false);
  return update.checkNow();
};

/** "Verificar Atualizações" no desktop: checagem real do electron-updater (ver verificarAtualizacao). */
export const verificarAtualizacaoAgora = (versaoAtual, opcoes = {}) =>
  verificarAtualizacao({ checkNow: checkForUpdateNow, onChange: onElectronUpdateStatus, versaoAtual, ...opcoes });

/** Assina mudanças de status (checking/available/downloading/downloaded/error). */
export const onElectronUpdateStatus = (handler) => {
  const update = electronWindow().electronAPI?.update;
  if (!update) return () => {};
  return update.onChange(handler);
};

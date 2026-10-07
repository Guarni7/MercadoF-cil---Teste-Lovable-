import React, { useCallback, useEffect, useRef, useState } from "react";
import BackupAntesDeSairDialog from "./BackupAntesDeSairDialog";
import { db } from "@/lib/localdb";
import { electronWindow } from "@/lib/electronWindow";
import { runBackup } from "@/lib/localBackup";
import { contarPendenciasDeSync, executarBackupComLimite, proximoEstado } from "@/lib/fechamentoComBackup";

/** Pedido de "Reiniciar e instalar agora" (painel do updater): passa pelo mesmo backup antes de reiniciar. */
export const EVENTO_INSTALAR_AGORA = "mf:install-now-request";

/**
 * Ordem segura no desktop: backup → fechamento (ou reinício para instalar a atualização).
 * Ouve o pedido de fechamento do processo main (electron/closeFlow.cjs) e o botão "Reiniciar e instalar
 * agora". Na web não faz nada.
 */
export default function FechamentoComBackupHost() {
  const [aberto, setAberto] = useState(false);
  const [modo, setModo] = useState(/** @type {"fechar"|"instalar"} */ ("fechar"));
  const [estado, setEstado] = useState(/** @type {"pergunta"|"salvando"|"falhou"} */ ("pergunta"));
  const [erro, setErro] = useState("");
  const [pendencias, setPendencias] = useState(0);
  const [info, setInfo] = useState({ updateReady: false, version: null });
  const modoRef = useRef(modo);
  modoRef.current = modo;

  const abrir = useCallback(async (novoModo, contexto) => {
    setModo(novoModo);
    setEstado("pergunta");
    setErro("");
    setInfo({ updateReady: !!contexto?.updateReady, version: contexto?.version || null });
    setPendencias(await contarPendenciasDeSync(db));
    setAberto(true);
  }, []);

  useEffect(() => {
    const bridge = electronWindow().electronAPI?.closeFlow;
    if (!bridge) return undefined;
    const sair = bridge.onRequest((contexto) => {
      bridge.ack(); // o main não fecha por tempo esgotado enquanto o diálogo estiver na tela
      abrir("fechar", contexto);
    });
    return sair;
  }, [abrir]);

  useEffect(() => {
    const aoPedirInstalar = async () => {
      const st = await electronWindow().electronAPI?.update?.status?.().catch(() => null);
      abrir("instalar", { updateReady: true, version: st?.info });
    };
    window.addEventListener(EVENTO_INSTALAR_AGORA, aoPedirInstalar);
    return () => window.removeEventListener(EVENTO_INSTALAR_AGORA, aoPedirInstalar);
  }, [abrir]);

  const concluir = useCallback(() => {
    setAberto(false);
    const api = electronWindow().electronAPI;
    if (modoRef.current === "instalar") api?.update?.installNow?.();
    else api?.closeFlow?.confirm?.();
  }, []);

  const cancelar = useCallback(() => {
    setAberto(false);
    if (modoRef.current === "fechar") electronWindow().electronAPI?.closeFlow?.cancel?.();
  }, []);

  const fazerBackup = useCallback(async () => {
    const r = await executarBackupComLimite({ runBackup });
    if (!r.ok) {
      console.error("Backup antes de sair falhou:", r.error);
      setErro(r.error || "");
    }
    const { estado: proximo, acao } = proximoEstado("salvando", r.ok ? "backupOk" : "backupFalhou");
    setEstado(proximo);
    if (acao === "concluir") concluir();
  }, [concluir]);

  const aoEvento = (evento) => {
    const { estado: proximo, acao } = proximoEstado(estado, evento);
    setEstado(proximo);
    if (acao === "concluir") concluir();
    else if (acao === "cancelar") cancelar();
    else if (proximo === "salvando") fazerBackup();
  };

  return <BackupAntesDeSairDialog open={aberto} modo={modo} estado={estado} erro={erro} pendencias={pendencias} atualizacaoPronta={info.updateReady} versaoNova={info.version} onEvento={aoEvento} />;
}

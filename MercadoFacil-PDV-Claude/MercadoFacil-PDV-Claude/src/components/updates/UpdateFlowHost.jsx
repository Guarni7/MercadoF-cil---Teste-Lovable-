import React, { useEffect, useState, useCallback, useRef } from "react";
import UpdateAvailableDialog from "./UpdateAvailableDialog";
import SystemUpdatedDialog from "./SystemUpdatedDialog";
import CommercialModulesDialog from "./CommercialModulesDialog";
import {
  APP_VERSION,
  PENDING_VERSION,
  getInstalledVersion,
  setInstalledVersion,
  isUpdateAvailable,
  wasUpdateSkipped,
  skipUpdate,
  hasSeenUpdatedModal,
  markUpdatedModalSeen,
  saveCommercialTrialSelection,
  clearSkippedUpdate,
} from "@/lib/appVersion";
import { PENDING_RELEASE } from "@/lib/releaseNotes";
import { toast } from "sonner";
import { hasElectronUpdate, checkForUpdateNow } from "@/lib/electronUpdate";

/**
 * Orquestra: Atualização disponível → Sistema Atualizado → Módulos comerciais.
 * Não implementa download real nem as features da 3.79.2.
 */
export default function UpdateFlowHost() {
  const [step, setStep] = useState(null); // 'available' | 'updated' | 'commercial' | null

  // Só auto-abre "Atualização disponível" quando a release estiver marcada como implementada.
  // Enquanto planned, o fluxo abre só via Suporte → Verificar Atualizações (preview da UI).
  const evaluate = useCallback(() => {
    const installed = getInstalledVersion();
    if (
      installed === PENDING_VERSION &&
      !hasSeenUpdatedModal(PENDING_VERSION)
    ) {
      setStep("updated");
      return;
    }
    if (
      PENDING_RELEASE.implemented &&
      isUpdateAvailable(PENDING_VERSION) &&
      !wasUpdateSkipped(PENDING_VERSION)
    ) {
      setStep("available");
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(evaluate, 800);
    return () => clearTimeout(t);
  }, [evaluate]);

  useEffect(() => {
    const openCheck = () => {
      clearSkippedUpdate();
      if (isUpdateAvailable(PENDING_VERSION)) {
        setStep("available");
      } else {
        toast.success(`Sistema já está na versão mais recente (${getInstalledVersion()})`);
      }
    };
    window.addEventListener("mf:check-updates", openCheck);
    return () => window.removeEventListener("mf:check-updates", openCheck);
  }, []);

  // autoUpdater real (Electron) — separado do fluxo mock acima. O aviso/progresso/"pronta" é do
  // ElectronUpdatePanel; aqui só a re-checagem quando a internet volta, pra não depender do timer
  // de 6h do processo main (autoInstallOnAppQuit continua sendo quem instala, ao fechar).
  const lastCheckAtRef = useRef(0);
  useEffect(() => {
    if (!hasElectronUpdate()) return;

    const handleOnline = () => {
      // ponytail: debounce simples de 10s — 'online' pode disparar mais de
      // uma vez seguida em reconexões instáveis; suficiente pra não empilhar
      // checagens, sem precisar de fila/estado mais sofisticado.
      const now = Date.now();
      if (now - lastCheckAtRef.current < 10_000) return;
      lastCheckAtRef.current = now;
      checkForUpdateNow();
    };
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  const handleSkip = () => {
    skipUpdate(PENDING_VERSION);
    setStep(null);
  };

  const handleUpdate = () => {
    // UI only: marca versão instalada localmente; features da release NÃO são ativadas.
    setInstalledVersion(PENDING_VERSION);
    clearSkippedUpdate();
    setStep("updated");
    toast.message("Atualização aplicada (interface).", {
      description: "As novidades da lista ainda serão desenvolvidas sob demanda.",
    });
  };

  const handleUpdatedClose = () => {
    markUpdatedModalSeen(PENDING_VERSION);
    setStep("commercial");
  };

  const handleCommercialClose = () => setStep(null);

  const handleCommercialConfirm = (ids) => {
    saveCommercialTrialSelection(ids);
    if (ids.length) {
      toast.success("Preferências salvas. Ativação dos módulos virá depois.");
    }
  };

  return (
    <>
      <UpdateAvailableDialog
        open={step === "available"}
        currentVersion={getInstalledVersion() || APP_VERSION}
        latestVersion={PENDING_RELEASE.version}
        notes={PENDING_RELEASE.notes}
        onSkip={handleSkip}
        onUpdate={handleUpdate}
        onClose={handleSkip}
      />
      <SystemUpdatedDialog
        open={step === "updated"}
        version={PENDING_RELEASE.version}
        notes={PENDING_RELEASE.notes}
        onClose={handleUpdatedClose}
      />
      <CommercialModulesDialog
        open={step === "commercial"}
        onClose={handleCommercialClose}
        onConfirm={handleCommercialConfirm}
      />
    </>
  );
}

/** Dispara verificação manual (ex.: botão em Suporte). */
export function requestUpdateCheck() {
  window.dispatchEvent(new Event("mf:check-updates"));
}

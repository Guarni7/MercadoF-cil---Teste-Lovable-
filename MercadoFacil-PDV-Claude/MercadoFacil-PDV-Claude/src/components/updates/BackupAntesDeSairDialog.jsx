import React from "react";
import { Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MSG_BACKUP_NAO_SUBSTITUI_SYNC } from "@/lib/fechamentoComBackup";

/**
 * Diálogo "backup antes de sair" (modo fechar) e "backup antes de reiniciar e instalar" (modo instalar).
 * Só apresenta: quem decide os passos é proximoEstado (fechamentoComBackup.js).
 *
 * @param {{
 *   open: boolean,
 *   modo: "fechar" | "instalar",
 *   estado: "pergunta" | "salvando" | "falhou",
 *   erro?: string,
 *   pendencias: number,
 *   atualizacaoPronta: boolean,
 *   versaoNova?: string | null,
 *   onEvento: (evento: "fazerBackup" | "tentarNovamente" | "fecharSemBackup" | "cancelar") => void,
 * }} props
 */
export default function BackupAntesDeSairDialog({ open, modo, estado, erro, pendencias, atualizacaoPronta, versaoNova, onEvento }) {
  const instalar = modo === "instalar";
  const salvando = estado === "salvando";
  const falhou = estado === "falhou";
  const acaoFinal = instalar ? "instalar" : "fechar";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !salvando && onEvento("cancelar")}>
      <DialogContent className="max-w-md" aria-describedby="backup-sair-descricao">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {falhou ? <TriangleAlert className="w-5 h-5 text-amber-600" /> : <ShieldCheck className="w-5 h-5 text-emerald-700" />}
            {instalar ? "Fazer backup antes de atualizar?" : "Fazer backup antes de fechar?"}
          </DialogTitle>
          <DialogDescription id="backup-sair-descricao">
            {falhou
              ? "O backup não foi concluído. Escolha o que fazer."
              : instalar
                ? "O sistema vai reiniciar para instalar a atualização. Recomendamos salvar um backup local antes."
                : "Recomendamos salvar um backup local dos dados antes de fechar o MercadoFácil."}
          </DialogDescription>
        </DialogHeader>

        {falhou && erro && <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">{erro}</div>}

        {!instalar && atualizacaoPronta && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2.5 text-sm text-emerald-900">
            Há uma atualização pronta{versaoNova ? ` (versão ${versaoNova})` : ""}. Ela será instalada logo depois de fechar.
          </div>
        )}

        {pendencias > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
            <p className="font-medium">
              {pendencias === 1 ? "1 operação ainda não foi sincronizada." : `${pendencias} operações ainda não foram sincronizadas.`}
            </p>
            <p className="mt-0.5 text-xs">{MSG_BACKUP_NAO_SUBSTITUI_SYNC}</p>
          </div>
        )}

        {salvando && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="w-4 h-4 animate-spin" /> Salvando backup...
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onEvento("cancelar")} disabled={salvando}>
            Cancelar
          </Button>
          <Button variant="outline" onClick={() => onEvento("fecharSemBackup")} disabled={salvando}>
            {instalar ? "Instalar sem backup" : "Fechar sem backup"}
          </Button>
          <Button onClick={() => onEvento(falhou ? "tentarNovamente" : "fazerBackup")} disabled={salvando}>
            {falhou ? "Tentar novamente" : `Fazer backup e ${acaoFinal}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

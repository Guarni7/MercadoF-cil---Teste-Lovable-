import React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AlertTriangle, X, CheckCircle2 } from "lucide-react";

const MUTED = "#5c6b68";
const GREEN = "#27ae60";

export default function NotificationsDialog({ open, onClose, notifications = [] }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden [&>button]:hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "#ecedee" }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" style={{ color: MUTED }} />
            <span className="text-base font-semibold text-black">Notificações</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-muted"
            style={{ border: `1px solid ${MUTED}`, color: MUTED }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center px-6 py-14">
            <CheckCircle2 className="w-16 h-16 mb-5" style={{ color: GREEN }} />
            <p className="text-base font-bold text-black mb-1.5">
              Nenhuma notificação no momento
            </p>
            <p className="text-sm" style={{ color: "#7f8c8d" }}>
              Avisos e alertas aparecem aqui quando houver.
            </p>
          </div>
        ) : (
          <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
            {notifications.map((n, i) => (
              <div
                key={i}
                className="p-3 rounded-xl border text-sm"
                style={{ borderColor: "#ecedee", background: "#fafafa" }}
              >
                <div className="font-medium text-foreground">{n.title}</div>
                {n.desc && (
                  <div className="text-xs text-muted-foreground mt-0.5">{n.desc}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
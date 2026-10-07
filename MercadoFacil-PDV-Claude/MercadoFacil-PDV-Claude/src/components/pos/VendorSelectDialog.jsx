import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { User as UserIcon } from "lucide-react";
import { api } from "@/api/dataClient";

export default function VendorSelectDialog({ open, onClose, onSelect, currentVendorId }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open) {
      setLoading(true);
      api.entities.User.list()
        .then((data) => setUsers(data || []))
        .catch(() => setUsers([]))
        .finally(() => setLoading(false));
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 border-b flex flex-row items-center justify-between space-y-0">
          <DialogTitle className="text-base font-bold">Vendedor</DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Quem realizou esta venda? Use F1, F2...
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhum vendedor cadastrado.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {users.map((u, i) => {
                const isActive = u.id === currentVendorId;
                return (
                  <button
                    key={u.id}
                    onClick={() => {
                      onSelect(u);
                      onClose();
                    }}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-lg border transition-colors text-left ${
                      isActive
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <span className="w-7 h-7 rounded-md bg-muted text-[10px] font-bold flex items-center justify-center text-muted-foreground shrink-0">
                      F{i + 1}
                    </span>
                    <UserIcon className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-sm font-medium flex-1 truncate">
                      {u.full_name || u.email}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
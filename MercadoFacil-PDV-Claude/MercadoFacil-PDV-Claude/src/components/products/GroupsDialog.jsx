import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useAuth } from "@/lib/AuthContext";
import { withCompanyId } from "@/lib/companyContext";
import { Plus, Tag, X, Pencil, Check, Truck } from "lucide-react";
import { mensagemDeErro } from "@/lib/mensagemErro";

export default function GroupsDialog({ open, onClose, onSaved }) {
  const { user } = useAuth();
  const [groups, setGroups] = useState([]);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    if (open) loadData();
  }, [open]);

  const loadData = async () => {
    try {
      const { listCategories } = await import("@/lib/productStore");
      const cats = await listCategories();
      setGroups(cats);
    } catch (e) {
      console.error(e);
    }
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    try {
      const { createCategory } = await import("@/lib/productStore");
      await createCategory(withCompanyId({ name: newName.trim() }, user));
      setNewName("");
      toast.success("Grupo adicionado!");
      loadData();
      onSaved?.();
    } catch (e) {
      console.error("Erro ao adicionar grupo:", e);
      toast.error(mensagemDeErro(e, "adicionar o grupo"));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (group) => {
    if (!confirm(`Excluir o grupo "${group.name}"?`)) return;
    try {
      const { deleteCategory } = await import("@/lib/productStore");
      await deleteCategory(group.id);
      toast.success("Grupo excluído!");
      loadData();
      onSaved?.();
    } catch (e) {
      toast.error("Erro ao excluir grupo.");
    }
  };

  const handleRename = async (group) => {
    if (!editName.trim() || editName.trim() === group.name) {
      setEditingId(null);
      return;
    }
    try {
      const { updateCategory, listProducts, updateProduct } = await import("@/lib/productStore");
      await updateCategory(group.id, { name: editName.trim() });
      const products = await listProducts();
      const toUpdate = products.filter((p) => p.category === group.name);
      for (const p of toUpdate) {
        await updateProduct(p.id, { category: editName.trim() });
      }
      toast.success(`Grupo renomeado em ${toUpdate.length} produto(s)!`);
      setEditingId(null);
      loadData();
      onSaved?.();
    } catch (e) {
      toast.error("Erro ao renomear grupo.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden [&>button]:hidden">
        {/* Header */}
        <div className="p-5 pb-3">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold">Gerenciar Grupos</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Subgrupos são criados no cadastro do produto (ao lado do grupo).
              </p>
            </div>
            <button onClick={onClose} className="p-1 rounded-md hover:bg-muted">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-5 pb-5 space-y-3">
          {/* Add input */}
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder="Nome do novo grupo"
              className="flex-1 h-10"
            />
            <button
              onClick={handleAdd}
              disabled={loading || !newName.trim()}
              className="w-10 h-10 shrink-0 rounded-lg bg-[#1a4d31] hover:bg-[#1a4d31]/90 flex items-center justify-center transition-colors disabled:opacity-40"
            >
              <Plus className="w-5 h-5 text-white" />
            </button>
          </div>

          {/* Group list */}
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Nenhum grupo cadastrado
              </p>
            ) : (
              groups.map((group) => (
                <div
                  key={group.id}
                  className="flex items-center gap-2 p-2.5 rounded-lg border bg-card"
                >
                  {editingId === group.id ? (
                    <>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleRename(group)}
                        className="flex-1 h-8"
                        autoFocus
                      />
                      <button
                        onClick={() => handleRename(group)}
                        className="p-1.5 rounded-md hover:bg-[#1a4d31]/10 text-[#1a4d31]"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="p-1.5 rounded-md hover:bg-muted"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <Tag className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="flex-1 text-sm font-semibold uppercase tracking-wide">
                        {group.name}
                      </span>
                      <button
                        onClick={() => toast.info("Configuração de delivery por grupo em breve")}
                        className="p-1.5 rounded-md hover:bg-[#1a4d31]/10 transition-colors"
                        title="Delivery"
                      >
                        <Truck className="w-4 h-4 text-[#1a4d31]" />
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(group.id);
                          setEditName(group.name);
                        }}
                        className="p-1.5 rounded-md hover:bg-muted transition-colors"
                        title="Editar"
                      >
                        <Pencil className="w-4 h-4 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => handleDelete(group)}
                        className="p-1.5 rounded-md hover:bg-red-500/10 transition-colors"
                        title="Remover"
                      >
                        <X className="w-4 h-4 text-red-500" />
                      </button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
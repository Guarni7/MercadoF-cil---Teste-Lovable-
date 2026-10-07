import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/api/dataClient";
import { toast } from "sonner";
import { Plus, Bookmark, X, Pencil, Check } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { withCompanyId } from "@/lib/companyContext";

export default function BrandsDialog({ open, onClose, onSaved }) {
  const { user } = useAuth();
  const [brands, setBrands] = useState([]);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) loadData();
  }, [open]);

  const loadData = async () => {
    try {
      const list = await api.entities.Brand.list("name", 200);
      setBrands(list);
    } catch (e) {
      try {
        const list = JSON.parse(localStorage.getItem("mf_local_brands") || "[]");
        setBrands(list);
      } catch {
        setBrands([]);
      }
    }
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    try {
      await api.entities.Brand.create(withCompanyId({ name: newName.trim() }, user));
      setNewName("");
      toast.success("Marca adicionada!");
      loadData();
      onSaved?.();
    } catch (e) {
      // Demo / offline: guarda local e permite usar no produto
      try {
        const key = "mf_local_brands";
        const list = JSON.parse(localStorage.getItem(key) || "[]");
        const row = { id: `local-brand-${Date.now()}`, name: newName.trim() };
        list.push(row);
        localStorage.setItem(key, JSON.stringify(list));
        setBrands(list);
        setNewName("");
        toast.success("Marca adicionada (local)!");
        onSaved?.(row.name);
      } catch {
        toast.error("Erro ao adicionar marca.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (brand) => {
    if (!confirm(`Excluir a marca "${brand.name}"?`)) return;
    try {
      await api.entities.Brand.delete(brand.id);
      toast.success("Marca excluída!");
      loadData();
      onSaved?.();
    } catch (e) {
      toast.error("Erro ao excluir marca.");
    }
  };

  const handleRename = async (brand) => {
    if (!editName.trim() || editName.trim() === brand.name) {
      setEditingId(null);
      return;
    }
    try {
      await api.entities.Brand.update(brand.id, { name: editName.trim() });

      const products = await api.entities.Product.filter({ brand: brand.name }, null, 500);
      if (products.length > 0) {
        await api.entities.Product.bulkUpdate(
          products.map((p) => ({ id: p.id, brand: editName.trim() }))
        );
      }

      toast.success(`Marca renomeada em ${products.length} produto(s)!`);
      setEditingId(null);
      loadData();
      onSaved?.();
    } catch (e) {
      toast.error("Erro ao renomear marca.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden [&>button]:hidden">
        {/* Header */}
        <div className="p-5 pb-3">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold">Editar marcas</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Renomear atualiza a marca nos produtos que a usam.
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
              placeholder="Nome da nova marca"
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

          {/* Brand list */}
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {brands.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Nenhuma marca cadastrada
              </p>
            ) : (
              brands.map((brand) => (
                <div
                  key={brand.id}
                  className="flex items-center gap-2 p-2.5 rounded-lg border bg-card"
                >
                  {editingId === brand.id ? (
                    <>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleRename(brand)}
                        className="flex-1 h-8"
                        autoFocus
                      />
                      <button
                        onClick={() => handleRename(brand)}
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
                      <Bookmark className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="flex-1 text-sm font-semibold uppercase tracking-wide">
                        {brand.name}
                      </span>
                      <button
                        onClick={() => {
                          setEditingId(brand.id);
                          setEditName(brand.name);
                        }}
                        className="p-1.5 rounded-md hover:bg-muted transition-colors"
                        title="Editar"
                      >
                        <Pencil className="w-4 h-4 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => handleDelete(brand)}
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
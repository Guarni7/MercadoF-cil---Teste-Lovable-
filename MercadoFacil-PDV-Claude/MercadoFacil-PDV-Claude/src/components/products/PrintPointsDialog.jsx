import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/dataClient";
import { Printer, Search, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const STORAGE_KEY = "print_points_config";

export default function PrintPointsDialog({ open, onClose }) {
  const [products, setProducts] = useState([]);
  const [name, setName] = useState("");
  const [connection, setConnection] = useState("rede");
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("9100");
  const [linked, setLinked] = useState(/** @type {Record<string, any>} */ ({}));
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open) {
      loadProducts();
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        if (saved.length > 0) {
          setName(saved[0].name || "");
          setConnection(saved[0].connection || "rede");
          setIp(saved[0].ip || "");
          setPort(saved[0].port || "9100");
          const l = {};
          (saved[0].product_ids || []).forEach((id) => {
            l[id] = true;
          });
          setLinked(l);
        }
      } catch {}
    }
  }, [open]);

  const loadProducts = async () => {
    try {
      const prods = await api.entities.Product.list("name", 500);
      setProducts(prods);
    } catch (e) {
      console.error(e);
    }
  };

  const grouped = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = products.filter(
      (p) => !search || p.name?.toLowerCase().includes(q) || p.barcode?.includes(search)
    );
    const groups = {};
    filtered.forEach((p) => {
      const cat = p.category || "Sem grupo";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [products, search]);

  const linkedCount = Object.values(linked).filter(Boolean).length;

  const selectAll = () => {
    const all = {};
    products.forEach((p) => {
      all[p.id] = true;
    });
    setLinked(all);
  };

  const selectNone = () => setLinked({});

  const toggleProduct = (id) => {
    setLinked((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("Informe o nome do ponto de impressão.");
      return;
    }
    if (connection === "rede" && !ip.trim()) {
      toast.error("Informe o IP da impressora.");
      return;
    }
    const point = {
      name: name.trim(),
      connection,
      ip: connection === "rede" ? ip.trim() : "",
      port: connection === "rede" ? port.trim() : "",
      product_ids: Object.entries(linked)
        .filter(([, v]) => v)
        .map(([id]) => id),
    };
    try {
      const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      existing[0] = point;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
      toast.success("Ponto de impressão salvo.");
      onClose();
    } catch {
      toast.error("Erro ao salvar.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Printer className="w-5 h-5 text-primary" />
            Pontos de Impressão
          </DialogTitle>
          <DialogDescription>
            Configure impressoras e vincule produtos para impressão automática nas comandas
          </DialogDescription>
        </DialogHeader>

        <div className="p-5 max-h-[65vh] overflow-y-auto">
          <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
            <h3 className="text-sm font-semibold">Novo Ponto</h3>

            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Nome</Label>
              <Input
                placeholder="Ex: Cozinha, Bar, Copa..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="border-primary/50"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Conexão</Label>
                <Select value={connection} onValueChange={setConnection}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rede">Rede (IP)</SelectItem>
                    <SelectItem value="usb">USB</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {connection === "rede" && (
                <>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">IP</Label>
                    <Input
                      placeholder="192.168.1.100"
                      value={ip}
                      onChange={(e) => setIp(e.target.value)}
                      className="border-primary/50"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Porta</Label>
                    <Input
                      placeholder="9100"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      className="border-primary/50"
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-semibold">
                Produtos vinculados ({linkedCount})
              </Label>
              <div className="flex gap-2 text-xs">
                <button type="button" onClick={selectAll} className="text-primary hover:underline">
                  Todos
                </button>
                <span className="text-muted-foreground">|</span>
                <button type="button" onClick={selectNone} className="text-primary hover:underline">
                  Nenhum
                </button>
              </div>
            </div>

            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar produto..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>

            <div className="rounded-lg border max-h-48 overflow-y-auto divide-y">
              {grouped.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  Nenhum produto encontrado.
                </p>
              ) : (
                grouped.map(([cat, items]) => (
                  <div key={cat}>
                    <div className="px-3 py-1.5 bg-muted/50 text-xs font-semibold uppercase text-muted-foreground sticky top-0">
                      {cat}
                    </div>
                    {items.map((p) => (
                      <label
                        key={p.id}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30 cursor-pointer"
                      >
                        <Checkbox
                          checked={!!linked[p.id]}
                          onCheckedChange={() => toggleProduct(p.id)}
                        />
                        <span className="text-sm flex-1">{p.name}</span>
                        <span className="text-xs text-muted-foreground font-mono">
                          {p.barcode || "—"}
                        </span>
                      </label>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="p-5 pt-3 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSave} className="gap-1.5">
            <Save className="w-4 h-4" /> Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

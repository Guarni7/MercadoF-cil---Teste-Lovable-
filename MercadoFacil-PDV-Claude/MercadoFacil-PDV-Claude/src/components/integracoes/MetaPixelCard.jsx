import React, { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Link2, ChevronRight, Check } from "lucide-react";
import { toast } from "sonner";
import { getMetaPixelId, setMetaPixelId, initMetaPixel } from "@/lib/metaPixel";

export default function MetaPixelCard() {
  const [open, setOpen] = useState(false);
  const [pixelId, setPixelId] = useState("");
  const [savedId, setSavedId] = useState("");

  useEffect(() => {
    const id = getMetaPixelId();
    setSavedId(id);
    setPixelId(id);
  }, []);

  const handleSave = () => {
    const trimmed = pixelId.trim();
    setMetaPixelId(trimmed);
    setSavedId(trimmed);
    if (trimmed) {
      initMetaPixel(trimmed);
      toast.success("Meta Pixel configurado!");
    } else {
      toast.success("Meta Pixel removido.");
    }
    setOpen(false);
  };

  return (
    <>
      <Card
        className="p-5 flex flex-col gap-3 hover:shadow-md cursor-pointer transition-shadow"
        onClick={() => setOpen(true)}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <Link2 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">Meta Pixel</h3>
              <Badge variant={savedId ? "default" : "secondary"} className="text-xs mt-1 font-normal">
                {savedId ? "Configurado" : "Não configurado"}
              </Badge>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Rastreie PageView, carrinho e compras com Pixel + API de Conversões da conta Meta do cliente.
        </p>
      </Card>

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center">
                <Link2 className="w-4.5 h-4.5 text-blue-600" />
              </div>
              <DialogTitle className="text-base font-bold">Configurar Meta Pixel</DialogTitle>
            </div>
          </DialogHeader>

          <div className="px-4 pb-4 space-y-4">
            <p className="text-xs text-muted-foreground">
              Informe o ID do seu Pixel do Meta (Facebook). Você encontra no Gerenciador de Eventos do Meta.
            </p>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase text-muted-foreground">
                Pixel ID
              </Label>
              <Input
                value={pixelId}
                onChange={(e) => setPixelId(e.target.value)}
                placeholder="Ex: 1234567890123456"
              />
            </div>

            {savedId && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
                <Check className="w-4 h-4 text-emerald-600" />
                <span className="text-xs text-emerald-800">
                  Pixel ativo: {savedId}
                </span>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={handleSave} className="flex-1">
                Salvar
              </Button>
              {savedId && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setPixelId("");
                    setMetaPixelId("");
                    setSavedId("");
                    toast.success("Meta Pixel removido.");
                    setOpen(false);
                  }}
                >
                  Remover
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
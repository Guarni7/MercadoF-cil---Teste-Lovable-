import React, { useMemo, useState } from "react";
import { Search, Filter, ScanLine, Users, Banknote, BarChart3, Undo2, Printer, Package, ArrowDownToLine, ArrowUpCircle, Scale, QrCode, Keyboard, UtensilsCrossed } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";

const quickActions = [
  { id: "sangria", label: "Sangria", shortcut: "F1", icon: ArrowDownToLine, color: "text-orange-600" },
  { id: "suprimento", label: "Suprimento", shortcut: "F2", icon: ArrowUpCircle, color: "text-green-700" },
  { id: "consult", label: "Consulta", shortcut: "F4", icon: ScanLine },
  { id: "customer", label: "Cliente", shortcut: "F5", icon: Users },
  { id: "cash", label: "Fechar Caixa", shortcut: "F6", icon: Banknote },
  { id: "summary", label: "Resumo", shortcut: "F7", icon: BarChart3 },
  { id: "weigh", label: "Pesagem", shortcut: "F8", icon: Scale, color: "text-primary" },
  { id: "return", label: "Devolução", icon: Undo2 },
  { id: "reprint", label: "Reimprimir", shortcut: "F9", icon: Printer },
];

// Só aparece para quem ativou Mesas (Configurações → Vendas).
// O QR/número identifica o CARTÃO/comanda; a mesa é opcional no atendimento.
const acoesCartao = [
  { id: "cartao", label: "Ler cartão", icon: QrCode },
  { id: "cartao_numero", label: "Informar nº do cartão", icon: Keyboard },
];

// QR/número da MESA: o caixa lê o QR fixo da mesa (ou digita o número) e abre o atendimento daquela mesa.
const acoesMesa = [
  { id: "mesa_qr", label: "Ler QR da mesa", icon: QrCode },
  { id: "mesa_numero", label: "Informar nº da mesa", icon: Keyboard },
];

export default function PosLeftPanel({
  mesasAtivas = false,
  cartoesVisiveis = false,
  products,
  search,
  setSearch,
  onAddToCart,
  onQuickAction,
  onBrowseProducts,
}) {
  const [qty, setQty] = useState(1);
  const [showResults, setShowResults] = useState(false);

  const searchResults = useMemo(() => {
    if (!search) return [];
    const q = search.toLowerCase();
    return products
      .filter(
        (p) =>
          p.name?.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.includes(search))
      )
      .slice(0, 6);
  }, [products, search]);

  const handleSelectProduct = (product) => {
    for (let i = 0; i < (qty || 1); i++) {
      onAddToCart(product);
    }
    setSearch("");
    setShowResults(false);
    setQty(1);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // Exact barcode/code match → auto-add (barcode scanner workflow)
      const exact = products.find(
        (p) => p.barcode === search || p.code === search
      );
      if (exact) {
        handleSelectProduct(exact);
        return;
      }
      // Single result → add it
      if (searchResults.length === 1) {
        handleSelectProduct(searchResults[0]);
      }
    }
  };

  return (
    <div className="w-full flex flex-col h-full bg-card">
      <div className="p-4 border-b">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
            Produto (Código / Nome)
          </h2>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Digite ou escaneie o código..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setShowResults(true);
            }}
            onKeyDown={handleSearchKeyDown}
            onFocus={() => setShowResults(true)}
            onBlur={() => setTimeout(() => setShowResults(false), 200)}
            className="pl-10"
          />
          {showResults && searchResults.length > 0 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-card border rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {searchResults.map((p) => (
                <button
                  key={p.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelectProduct(p)}
                  className="w-full flex items-center justify-between p-2.5 hover:bg-muted text-left border-b last:border-0"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.barcode || "Sem código"} · Estq: {p.stock || 0}
                    </div>
                  </div>
                  <span className="font-bold text-primary text-sm ml-2">
                    {formatBRL(p.price)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="p-4 border-b grid grid-cols-3 gap-2">
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">QTD</Label>
          <Input
            type="number"
            min="1"
            value={qty}
            onChange={(e) => setQty(parseInt(e.target.value) || 1)}
            className="text-center font-semibold"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">PREÇO</Label>
          <Input disabled placeholder="—" className="text-center text-muted-foreground" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">TOTAL</Label>
          <Input disabled value="R$ 0,00" className="text-center text-muted-foreground font-semibold" />
        </div>
      </div>

      <div className="p-4 flex-1 overflow-y-auto">
        <h2 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide mb-3">
          Ações Rápidas
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                onClick={() => onQuickAction(action.id)}
                className="flex items-center gap-2 p-2.5 rounded-full border hover:bg-muted hover:border-primary/30 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:shadow-sm transition-all"
              >
                <Icon className={cn("w-4 h-4 shrink-0", action.color || "text-muted-foreground")} />
                <span className={cn("text-xs font-medium flex-1 text-left", action.color || "text-foreground")}>{action.label}</span>
                {action.shortcut && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">{action.shortcut}</span>}
              </button>
            );
          })}
        </div>
        {mesasAtivas && (
          <div className="mt-3 rounded-xl border-2 border-primary/40 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="w-4 h-4 text-primary shrink-0" />
              <h3 className="text-xs font-bold uppercase tracking-wide text-primary">Mesa</h3>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              <strong className="text-foreground">Leia o QR da mesa</strong> ou <strong className="text-foreground">digite o número</strong> e o atendimento abre.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {acoesMesa.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    onClick={() => onQuickAction(action.id)}
                    className="flex flex-col items-center justify-center gap-1 p-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 transition-all"
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-xs font-semibold leading-tight text-center">{action.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground">O leitor USB também funciona direto: aponte para o QR da mesa.</p>
          </div>
        )}
        {mesasAtivas && cartoesVisiveis && (
          <div className="mt-3 rounded-xl border-2 border-primary/40 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <QrCode className="w-4 h-4 text-primary shrink-0" />
              <h3 className="text-xs font-bold uppercase tracking-wide text-primary">Cartão / comanda</h3>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Cliente trouxe o cartão? <strong className="text-foreground">Leia o QR</strong> ou <strong className="text-foreground">digite o número</strong> (23 ou 023) e a comanda abre.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {acoesCartao.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    onClick={() => onQuickAction(action.id)}
                    className="flex flex-col items-center justify-center gap-1 p-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 transition-all"
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-xs font-semibold leading-tight text-center">{action.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground">O leitor USB também funciona direto: aponte para o QR do cartão.</p>
          </div>
        )}
        <button
          onClick={onBrowseProducts}
          className="w-full mt-3 flex items-center justify-center gap-2 p-3 rounded-lg border-2 border-dashed hover:bg-muted hover:border-primary/30 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:shadow-sm transition-all text-sm font-medium"
        >
          <Package className="w-4 h-4" /> Ver todos os produtos
        </button>
      </div>
    </div>
  );
}
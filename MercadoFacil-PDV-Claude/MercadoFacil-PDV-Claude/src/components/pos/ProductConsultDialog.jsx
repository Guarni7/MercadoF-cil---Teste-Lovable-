import React, { useState, useEffect, useRef } from "react";
import {
  Dialog, DialogContent,
} from "@/components/ui/dialog";
import { Search, Package, X, Check, Barcode, Tag, Boxes, FileText } from "lucide-react";
import { formatBRL } from "@/lib/format";

export default function ProductConsultDialog({ open, onClose, products = [], onSelect }) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSearched(false);
      setResults([]);
      setSelectedIndex(-1);
      setSelectedProduct(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const doSearch = () => {
    const q = query.trim().toLowerCase();
    if (!q) {
      setResults([]);
      setSearched(true);
      setSelectedIndex(-1);
      setSelectedProduct(null);
      return;
    }
    const filtered = products
      .filter(
        (p) =>
          p.name?.toLowerCase().includes(q) ||
          (p.code && p.code.toLowerCase().includes(q)) ||
          (p.barcode && p.barcode.includes(query.trim())) ||
          (p.reference && p.reference.toLowerCase().includes(q))
      )
      .slice(0, 50);
    setResults(filtered);
    setSearched(true);
    setSelectedIndex(filtered.length > 0 ? 0 : -1);
    setSelectedProduct(filtered.length > 0 ? filtered[0] : null);
  };

  const insertProduct = (product) => {
    if (!product) return;
    onSelect?.(product);
    onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!searched) {
        doSearch();
      } else if (selectedIndex >= 0 && results[selectedIndex]) {
        insertProduct(results[selectedIndex]);
      } else if (results.length > 0) {
        doSearch();
      }
      return;
    }
    if (!searched || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(selectedIndex + 1, results.length - 1);
      setSelectedIndex(next);
      setSelectedProduct(results[next]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = Math.max(selectedIndex - 1, 0);
      setSelectedIndex(prev);
      setSelectedProduct(results[prev]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setSearched(false);
      setResults([]);
      setSelectedIndex(-1);
      setSelectedProduct(null);
    }
  };

  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const el = listRef.current.children[selectedIndex];
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl p-0 gap-0 overflow-hidden" hideClose>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e0e6e8]">
          <h2 className="text-lg font-bold text-[#2d3748]">Consulta de produto</h2>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[#e6f0f2] text-[#3b7a85] text-xs font-semibold">
              F4
            </span>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#a0aec0] hover:bg-[#f1f5f9] hover:text-[#2d3748] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-6 pt-5 pb-4">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#a0aec0] mb-1.5">
            Produto (código / nome)
          </label>
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#a0aec0]" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite o código ou nome..."
              className="w-full h-11 pl-11 pr-4 rounded-lg border border-[#e0e6e8] bg-white text-sm text-[#2d3748] placeholder:text-[#a0aec0] focus:outline-none focus:border-[#3b7a85] focus:ring-2 focus:ring-[#3b7a85]/15"
            />
          </div>
        </div>

        {/* Split view */}
        <div className="flex border-t border-[#e0e6e8]" style={{ minHeight: 320 }}>
          {/* Left: Results */}
          <div className="w-1/2 flex flex-col border-r border-[#e0e6e8]">
            <div className="px-6 pt-4 pb-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#a0aec0]">
                Resultados
              </div>
              <div className="text-[11px] text-[#a0aec0] mt-0.5">
                Enter busca · ↑↓ navega · Enter insere
              </div>
            </div>
            <div ref={listRef} className="flex-1 overflow-y-auto px-3 pb-4">
              {!searched ? (
                <EmptyState
                  icon={<Search className="w-6 h-6 text-[#3b7a85]" />}
                  title="Digite e pressione Enter"
                  subtitle="Busca por código, EAN ou qualquer trecho do nome. A lista só aparece depois do Enter."
                />
              ) : results.length === 0 ? (
                <EmptyState
                  icon={<Search className="w-6 h-6 text-[#3b7a85]" />}
                  title="Nenhum produto encontrado"
                  subtitle="Tente outro código ou nome."
                />
              ) : (
                <div className="space-y-1">
                  {results.map((p, i) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelectedIndex(i);
                        setSelectedProduct(p);
                      }}
                      onDoubleClick={() => insertProduct(p)}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-colors ${
                        i === selectedIndex
                          ? "bg-[#e6f0f2] ring-1 ring-[#3b7a85]/30"
                          : "hover:bg-[#f1f5f9]"
                      }`}
                    >
                      <div className="w-10 h-10 rounded-lg bg-[#f1f5f9] flex items-center justify-center shrink-0 overflow-hidden">
                        {p.image_url ? (
                          <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                        ) : (
                          <Package className="w-5 h-5 text-[#a0aec0]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-[#2d3748] truncate">{p.name}</div>
                        <div className="text-xs text-[#a0aec0] truncate">
                          {p.code || p.barcode || "Sem código"} · Estq: {p.stock || 0}
                        </div>
                      </div>
                      <span className="text-sm font-bold text-[#2d3748] shrink-0">{formatBRL(p.price)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Details */}
          <div className="w-1/2 flex flex-col">
            {!selectedProduct ? (
              <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
                <div className="w-14 h-14 rounded-xl bg-[#d1e2e6] flex items-center justify-center mb-3">
                  <Search className="w-7 h-7 text-[#3b7a85]" />
                </div>
                <p className="text-sm text-[#a0aec0]">
                  Busque um produto para ver preço, estoque e dados fiscais.
                </p>
              </div>
            ) : (
              <ProductDetails product={selectedProduct} onInsert={() => insertProduct(selectedProduct)} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-6">
      <div className="w-14 h-14 rounded-xl bg-[#d1e2e6] flex items-center justify-center mb-3">
        {icon}
      </div>
      <p className="text-sm font-semibold text-[#2d3748] mb-1">{title}</p>
      <p className="text-xs text-[#a0aec0] max-w-[260px] leading-relaxed">{subtitle}</p>
    </div>
  );
}

function ProductDetails({ product, onInsert }) {
  return (
    <div className="flex-1 flex flex-col">
      <div className="px-6 pt-4 pb-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#a0aec0]">
          Detalhes
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-4">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-16 h-16 rounded-xl bg-[#f1f5f9] flex items-center justify-center shrink-0 overflow-hidden">
            {product.image_url ? (
              <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
            ) : (
              <Package className="w-8 h-8 text-[#a0aec0]" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-[#2d3748] leading-tight">{product.name}</h3>
            {product.brand && (
              <p className="text-xs text-[#a0aec0] mt-0.5">{product.brand}</p>
            )}
          </div>
        </div>

        <div className="space-y-2.5">
          <DetailRow icon={<Tag className="w-4 h-4" />} label="Código" value={product.code || "—"} />
          <DetailRow icon={<Barcode className="w-4 h-4" />} label="EAN" value={product.barcode || "—"} />
          <DetailRow icon={<Boxes className="w-4 h-4" />} label="Estoque" value={`${product.stock || 0} ${product.unit || "UN"}`} />
          <DetailRow icon={<FileText className="w-4 h-4" />} label="Grupo" value={product.category || "—"} />
          <DetailRow icon={<FileText className="w-4 h-4" />} label="Info Fiscal" value={product.fiscal_info || "—"} />
        </div>

        <div className="mt-5 p-4 rounded-xl bg-[#f1f5f9] flex items-center justify-between">
          <span className="text-sm text-[#a0aec0]">Preço de venda</span>
          <span className="text-xl font-bold text-[#2d3748]">{formatBRL(product.price)}</span>
        </div>
      </div>

      <div className="px-6 py-4 border-t border-[#e0e6e8]">
        <button
          onClick={onInsert}
          className="w-full h-11 rounded-lg bg-[#006666] text-white text-sm font-bold flex items-center justify-center gap-2 hover:bg-[#005555] transition-colors"
        >
          <Check className="w-4 h-4" />
          Inserir no carrinho
        </button>
      </div>
    </div>
  );
}

function DetailRow({ icon, label, value }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-8 h-8 rounded-lg bg-[#f1f5f9] flex items-center justify-center text-[#3b7a85] shrink-0">
        {icon}
      </div>
      <span className="text-xs text-[#a0aec0] w-20 shrink-0">{label}</span>
      <span className="text-sm text-[#2d3748] font-medium truncate">{value}</span>
    </div>
  );
}
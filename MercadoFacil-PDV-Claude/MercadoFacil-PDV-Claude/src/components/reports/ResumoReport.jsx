import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/dataClient";
import { LineChart, DollarSign, ShoppingCart, Tag, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatBRL } from "@/lib/format";
import { saleNumberLabel } from "@/lib/saleNumber";
import ReportShell from "./ReportShell";
import KpiCard from "./KpiCard";
import { reportLoadError } from "./reportError";
import { useReportFilters } from "./useReportFilters";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export default function ResumoReport({ onBack }) {
  const [sales, setSales] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const filtros = useReportFilters();

  useEffect(() => {
    Promise.all([
      api.entities.Sale.list("-created_date", 500),
      api.entities.Product.list("name", 500),
    ])
      .then(([s, p]) => {
        setSales(s);
        setProducts(p);
      })
      .catch(reportLoadError("o resumo"))
      .finally(() => setLoading(false));
  }, []);

  const { noPeriodo, combina, status } = filtros;
  const vendas = useMemo(
    () =>
      sales.filter(
        (s) =>
          (status === "todas" || s.status === "concluida") &&
          noPeriodo(s.created_date) &&
          combina(s.customer_name, s.number),
      ),
    [sales, status, noPeriodo, combina],
  );

  const stats = useMemo(() => {
    const valid = vendas;
    const faturamento = valid.reduce((sum, s) => sum + s.total, 0);
    const descontos = valid.reduce((sum, s) => sum + (s.discount || 0), 0);
    const itens = valid.reduce(
      (sum, s) =>
        sum +
        (s.items?.reduce((q, i) => q + (i.quantity || 0), 0) || 0),
      0
    );
    const ticket = valid.length ? faturamento / valid.length : 0;
    const custo = valid.reduce((sum, s) => {
      const itemCost =
        s.items?.reduce((c, i) => {
          const prod = products.find((p) => p.id === i.product_id);
          return c + (prod?.cost || 0) * (i.quantity || 0);
        }, 0) || 0;
      return sum + itemCost;
    }, 0);
    const lucro = faturamento - custo;
    const margem = faturamento ? (lucro / faturamento) * 100 : 0;
    return { faturamento, lucro, margem, vendasCount: valid.length, itens, ticket, descontos };
  }, [vendas, products]);

  const byProduct = useMemo(() => {
    const map = {};
    vendas
      .forEach((s) => {
        s.items?.forEach((i) => {
          if (!map[i.product_id])
            map[i.product_id] = { name: i.name, total: 0, qty: 0 };
          // Item sem `total` (venda migrada ou de versão antiga do PDV) vira
          // preço × quantidade; somar zero fazia o produto sumir do ranking.
          const valor =
            i.total != null ? Number(i.total) : (Number(i.price) || 0) * (Number(i.quantity) || 0);
          map[i.product_id].total += valor;
          map[i.product_id].qty += i.quantity || 0;
        });
      });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [vendas]);

  const byCustomer = useMemo(() => {
    const map = {};
    vendas
      .forEach((s) => {
        // Sem cliente identificado: não entra no ranking (fica só em "Por Venda").
        const key = s.customer_id || s.customer_name;
        if (!key) return;
        if (!map[key])
          map[key] = { name: s.customer_name || "Cliente", total: 0, count: 0 };
        map[key].total += s.total;
        map[key].count++;
      });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [vendas]);

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );

  return (
    <ReportShell
      title="Resumo"
      icon={LineChart}
      onBack={onBack}
      filters={filtros}
      searchPlaceholder="Buscar por cliente ou nº da venda"
      statusLabels={{ ativas: "Concluídas", todas: "Todas" }}
    >
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <KpiCard label="Faturamento" value={formatBRL(stats.faturamento)} icon={DollarSign} colorClass="text-emerald-600" />
        <KpiCard label="Lucro" value={formatBRL(stats.lucro)} subtitle={`Margem: ${stats.margem.toFixed(1)}%`} icon={TrendingUp} colorClass="text-emerald-600" />
        <KpiCard label="Vendas" value={String(stats.vendasCount)} subtitle={`${stats.itens} itens`} icon={ShoppingCart} colorClass="text-blue-600" />
        <KpiCard label="Ticket Médio" value={formatBRL(stats.ticket)} icon={LineChart} colorClass="text-purple-600" />
        <KpiCard label="Descontos" value={formatBRL(stats.descontos)} icon={Tag} colorClass="text-orange-500" valueClass="text-orange-500" />
      </div>

      <Card className="p-0 overflow-hidden">
        <Accordion type="single" collapsible>
          <AccordionItem value="produto" className="border-b">
            <AccordionTrigger className="px-4 hover:no-underline">
              <span className="flex items-center gap-2 font-medium">
                Por Produto ({byProduct.length})
              </span>
              <span className="ml-auto pr-4 font-semibold text-primary">
                {formatBRL(byProduct.reduce((s, p) => s + p.total, 0))}
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              {byProduct.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum produto vendido no período.
                </p>
              ) : (
                <div className="space-y-1">
                  {byProduct.slice(0, 20).map((p, i) => (
                    <div key={i} className="flex justify-between text-sm py-1.5 border-b last:border-0">
                      <span>{p.name} ({p.qty}x)</span>
                      <span className="font-medium">{formatBRL(p.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="cliente" className="border-b">
            <AccordionTrigger className="px-4 hover:no-underline">
              <span className="flex items-center gap-2 font-medium">
                Por Cliente ({byCustomer.length})
              </span>
              <span className="ml-auto pr-4 font-semibold text-primary">
                {formatBRL(byCustomer.reduce((s, c) => s + c.total, 0))}
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              {byCustomer.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum cliente no período.
                </p>
              ) : (
                <div className="space-y-1">
                  {byCustomer.slice(0, 20).map((c, i) => (
                    <div key={i} className="flex justify-between text-sm py-1.5 border-b last:border-0">
                      <span>{c.name} ({c.count}x)</span>
                      <span className="font-medium">{formatBRL(c.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="venda" className="border-b-0">
            <AccordionTrigger className="px-4 hover:no-underline">
              <span className="flex items-center gap-2 font-medium">
                Por Venda ({stats.vendasCount})
              </span>
              <span className="ml-auto pr-4 font-semibold text-primary">
                {formatBRL(stats.faturamento)}
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              {/* A lista precisa ser a mesma do total do cabeçalho: antes ela
                  vinha de `sales` cru e ignorava período, busca e status. */}
              {vendas.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhuma venda no período.
                </p>
              ) : (
                <div className="space-y-1">
                  {vendas.slice(0, 20).map((s) => (
                    <div key={s.id} className="flex justify-between text-sm py-1.5 border-b last:border-0">
                      <span>{saleNumberLabel(s)} · {s.customer_name || "Consumidor"}</span>
                      <span className="font-medium">{formatBRL(s.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>
    </ReportShell>
  );
}
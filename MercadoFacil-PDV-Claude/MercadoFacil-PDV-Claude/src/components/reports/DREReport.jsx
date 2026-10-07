import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/dataClient";
import { TrendingUp, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBRL } from "@/lib/format";
import ReportShell from "./ReportShell";
import { reportLoadError } from "./reportError";

export default function DREReport({ onBack }) {
  const [bills, setBills] = useState([]);
  const [sales, setSales] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detalhar, setDetalhar] = useState(false);
  const [base, setBase] = useState("baixa");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [status, setStatus] = useState("baixadas");
  const [busca, setBusca] = useState("");

  useEffect(() => {
    Promise.all([
      api.entities.Bill.list("-created_date", 500),
      api.entities.Sale.list("-created_date", 500),
      api.entities.Product.list("name", 500),
    ])
      .then(([b, s, p]) => {
        setBills(b);
        setSales(s);
        setProducts(p);
      })
      .catch(reportLoadError("o DRE"))
      .finally(() => setLoading(false));
  }, []);

  const noPeriodo = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return bills.filter((b) => {
      if (status === "baixadas" && !b.paid) return false;
      // "Data Baixa" só faz sentido em conta baixada; em "Todas" o lançamento
      // ainda aberto não tem paid_date e cairia fora de qualquer intervalo.
      const data = base === "baixa" ? b.paid_date || b.due_date : b.due_date;
      if (de && (!data || data < de)) return false;
      if (ate && (!data || data > ate)) return false;
      if (termo) {
        const alvo = `${b.description || ""} ${b.supplier || ""} ${b.category || ""}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });
  }, [bills, base, de, ate, status, busca]);

  const receitasDetalhadas = useMemo(
    () => noPeriodo.filter((b) => b.type === "receber"),
    [noPeriodo],
  );
  const despesasDetalhadas = useMemo(
    () => noPeriodo.filter((b) => b.type === "pagar"),
    [noPeriodo],
  );

  // Numa loja a receita nasce no PDV, não no contas a receber. Sem as vendas o
  // DRE mostrava "nenhuma receita" num mês inteiro de caixa e transformava toda
  // despesa em prejuízo.
  const vendasNoPeriodo = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return sales.filter((s) => {
      if (s.status !== "concluida") return false;
      // Crediário só vira dinheiro quando o cliente paga: em "somente baixadas"
      // ele fica de fora, como qualquer conta ainda em aberto.
      if (status === "baixadas" && s.payment_method === "crediario") return false;
      const data = (s.created_date || s.created_at || "").slice(0, 10);
      if (de && (!data || data < de)) return false;
      if (ate && (!data || data > ate)) return false;
      if (termo) {
        const alvo = `${s.customer_name || ""} ${s.number || ""} ${s.payment_method || ""}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });
  }, [sales, de, ate, status, busca]);

  const stats = useMemo(() => {
    const soma = (lista) => lista.reduce((s, b) => s + (b.amount || 0), 0);
    const vendas = vendasNoPeriodo.reduce((s, v) => s + (v.total || 0), 0);
    const outrasReceitas = soma(receitasDetalhadas);
    const receitas = vendas + outrasReceitas;
    const cmv = vendasNoPeriodo.reduce(
      (s, v) =>
        s +
        (v.items?.reduce((c, i) => {
          const prod = products.find((p) => p.id === i.product_id);
          const custo = i.cost != null ? Number(i.cost) : prod?.cost || 0;
          return c + custo * (i.quantity || 0);
        }, 0) || 0),
      0,
    );
    const lucroBruto = receitas - cmv;
    const despesas = soma(despesasDetalhadas);
    const resultado = lucroBruto - despesas;
    const margem = receitas ? (resultado / receitas) * 100 : 0;
    return { vendas, outrasReceitas, receitas, cmv, lucroBruto, despesas, resultado, margem };
  }, [vendasNoPeriodo, receitasDetalhadas, despesasDetalhadas, products]);

  const positivo = stats.resultado >= 0;
  // Classes completas: o Tailwind varre o código como texto, `bg-${cor}-50`
  // seria descartado no build e o card sairia sem fundo.
  const cor = positivo
    ? { card: "bg-emerald-50 border-emerald-200", valor: "text-emerald-600", faixa: "bg-emerald-50", texto: "text-emerald-700" }
    : { card: "bg-rose-50 border-rose-200", valor: "text-rose-600", faixa: "bg-rose-50", texto: "text-rose-700" };

  const linhas = (lista, vazio) =>
    lista.length === 0 ? (
      <p className="text-sm text-muted-foreground">{vazio}</p>
    ) : detalhar ? (
      <div className="space-y-1">
        {lista.map((b) => (
          <div key={b.id} className="flex justify-between text-sm py-1 border-b last:border-0">
            <span className="text-muted-foreground">{b.supplier || b.description || "—"}</span>
            <span>{formatBRL(b.amount || 0)}</span>
          </div>
        ))}
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">
        {lista.length} lançamento(s) — ative "Detalhar" para ver a lista
      </p>
    );

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );

  return (
    <ReportShell
      title="DRE"
      icon={TrendingUp}
      onBack={onBack}
      showSearch={false}
      showStatus={false}
    >
      <div className="flex items-center gap-2 mb-4 flex-wrap p-3 rounded-lg bg-muted/40 border">
        <Select value={base} onValueChange={setBase}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="baixa">Data Baixa</SelectItem>
            <SelectItem value="venc">Vencimento</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" className="w-auto" value={de} onChange={(e) => setDe(e.target.value)} />
        <span className="text-muted-foreground text-sm">a</span>
        <Input type="date" className="w-auto" value={ate} onChange={(e) => setAte(e.target.value)} />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="baixadas">Somente baixadas</SelectItem>
            <SelectItem value="todas">Todas</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <Search className="w-4 h-4 text-muted-foreground" />
          <Input
            className="w-[180px]"
            placeholder="Buscar lançamento"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <Switch checked={detalhar} onCheckedChange={setDetalhar} id="detalhar" />
          <label htmlFor="detalhar" className="text-sm text-muted-foreground">Detalhar</label>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <Card className="p-4 bg-emerald-50 border-emerald-200">
          <div className="text-xs text-muted-foreground uppercase">Receitas</div>
          <div className="text-xl font-bold text-emerald-600">{formatBRL(stats.receitas)}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {vendasNoPeriodo.length} venda(s) no PDV
          </div>
        </Card>
        <Card className="p-4 bg-amber-50 border-amber-200">
          <div className="text-xs text-muted-foreground uppercase">CMV</div>
          <div className="text-xl font-bold text-amber-600">{formatBRL(stats.cmv)}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">custo do que foi vendido</div>
        </Card>
        <Card className="p-4 bg-rose-50 border-rose-200">
          <div className="text-xs text-muted-foreground uppercase">Despesas</div>
          <div className="text-xl font-bold text-rose-600">{formatBRL(stats.despesas)}</div>
        </Card>
        <Card className={`p-4 ${cor.card}`}>
          <div className="text-xs text-muted-foreground uppercase">Resultado</div>
          <div className={`text-xl font-bold ${cor.valor}`}>{formatBRL(stats.resultado)}</div>
        </Card>
        <Card className={`p-4 ${cor.card}`}>
          <div className="text-xs text-muted-foreground uppercase">Margem</div>
          <div className={`text-xl font-bold ${cor.valor}`}>{stats.margem.toFixed(1)}%</div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b">
          <div className="flex items-center justify-between px-4 py-3 bg-emerald-50/50">
            <span className="font-bold text-emerald-700 text-sm uppercase">(+) Receitas Brutas</span>
            <span className="font-bold text-emerald-700">{formatBRL(stats.receitas)}</span>
          </div>
          <div className="px-4 py-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                Vendas no PDV ({vendasNoPeriodo.length})
              </span>
              <span>{formatBRL(stats.vendas)}</span>
            </div>
            <div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Outras receitas ({receitasDetalhadas.length})
                </span>
                <span>{formatBRL(stats.outrasReceitas)}</span>
              </div>
              {detalhar && receitasDetalhadas.length > 0 && (
                <div className="pl-4 mt-1">{linhas(receitasDetalhadas, "")}</div>
              )}
            </div>
          </div>
        </div>

        <div className="border-b">
          <div className="flex items-center justify-between px-4 py-3 bg-amber-50/50">
            <span className="font-bold text-amber-700 text-sm uppercase">
              (-) Custo das Mercadorias Vendidas
            </span>
            <span className="font-bold text-amber-700">{formatBRL(stats.cmv)}</span>
          </div>
        </div>

        <div className="border-b">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="font-bold text-sm uppercase">(=) Lucro Bruto</span>
            <span className="font-bold">{formatBRL(stats.lucroBruto)}</span>
          </div>
        </div>

        <div className="border-b">
          <div className="flex items-center justify-between px-4 py-3 bg-rose-50/50">
            <span className="font-bold text-rose-700 text-sm uppercase">(-) Despesas Operacionais</span>
            <span className="font-bold text-rose-700">{formatBRL(stats.despesas)}</span>
          </div>
          <div className="px-4 py-3">
            {linhas(despesasDetalhadas, "Nenhuma despesa no período")}
          </div>
        </div>

        <div className={`flex items-center justify-between px-4 py-4 ${cor.faixa}`}>
          <div>
            <span className={`font-bold ${cor.texto} text-sm uppercase`}>
              (=) Resultado Líquido do Período
            </span>
            <p className="text-xs text-muted-foreground mt-0.5">
              {status === "baixadas"
                ? "Somente lançamentos baixados e vendas já recebidas (sem crediário em aberto)"
                : "Todos os lançamentos e vendas"}{" "}
              · {base === "baixa" ? "Data de baixa" : "Vencimento"}
            </p>
          </div>
          <span className={`font-bold ${cor.texto} text-lg`}>
            {positivo ? "+ " : "− "}
            {formatBRL(Math.abs(stats.resultado))}
          </span>
        </div>
      </Card>
    </ReportShell>
  );
}

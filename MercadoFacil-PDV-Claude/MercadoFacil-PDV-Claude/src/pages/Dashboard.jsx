import React, { useState, useEffect, useMemo } from "react";
import { api } from "@/api/dataClient";
import { Link } from "react-router-dom";
import {
  ShoppingCart,
  DollarSign,
  Package,
  AlertTriangle,
  ArrowRight,
  CreditCard,
  Trophy,
  Users,
  LineChart as LineChartIcon,
  RefreshCw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatBRL, formatDateTime } from "@/lib/format";
import { saleNumberLabel } from "@/lib/saleNumber";
import BirthdaysCard from "@/components/dashboard/BirthdaysCard";
import MissingCustomersCard from "@/components/dashboard/MissingCustomersCard";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const chartColor = "hsl(164 75% 34%)";

export default function Dashboard() {
  const [sales, setSales] = useState([]);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [s, p, c] = await Promise.all([
        api.entities.Sale.list("-created_date", 500),
        api.entities.Product.list("-created_date", 500),
        api.entities.Customer.list("name", 500),
      ]);
      setSales(s);
      setProducts(p);
      setCustomers(c);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const todaySales = sales.filter(
    (s) => new Date(s.created_date).getTime() >= startToday && s.status === "concluida"
  );
  const todayTotal = todaySales.reduce((sum, s) => sum + s.total, 0);
  const lowStock = products.filter((p) => (p.stock || 0) <= (p.min_stock || 5));

  const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const weeklyData = useMemo(() => {
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const dayStart = new Date(startOfWeek);
      dayStart.setDate(startOfWeek.getDate() + i);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayStart.getDate() + 1);
      const total = sales
        .filter((s) => {
          const d = new Date(s.created_date);
          return d >= dayStart && d < dayEnd && s.status === "concluida";
        })
        .reduce((sum, s) => sum + s.total, 0);
      return { day: weekDays[i], total: Math.round(total * 100) / 100 };
    });
  }, [sales]);

  const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const monthlyData = useMemo(() => {
    const year = today.getFullYear();
    return months.map((m, i) => {
      const total = sales
        .filter((s) => {
          const d = new Date(s.created_date);
          return d.getFullYear() === year && d.getMonth() === i && s.status === "concluida";
        })
        .reduce((sum, s) => sum + s.total, 0);
      return { month: m, total: Math.round(total * 100) / 100 };
    });
  }, [sales]);

  const paymentsToday = useMemo(() => {
    const methods = {};
    todaySales.forEach((s) => {
      methods[s.payment_method] = (methods[s.payment_method] || 0) + s.total;
    });
    return Object.entries(methods).map(([method, total]) => ({ method, total }));
  }, [todaySales]);

  const bestSellers = useMemo(() => {
    const productSales = {};
    sales
      .filter((s) => s.status === "concluida")
      .forEach((s) => {
        s.items?.forEach((item) => {
          if (!productSales[item.name])
            productSales[item.name] = { name: item.name, qty: 0, total: 0 };
          productSales[item.name].qty += item.quantity;
          productSales[item.name].total += item.total;
        });
      });
    return Object.values(productSales)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  }, [sales]);

  const hourlyData = useMemo(() => {
    const date = new Date(selectedDate + "T00:00:00");
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const daySales = sales.filter(
      (s) =>
        new Date(s.created_date).getTime() >= dayStart &&
        new Date(s.created_date).getTime() < dayEnd &&
        s.status === "concluida"
    );
    const hours = Array.from({ length: 24 }, (_, h) => {
      const hourStart = dayStart + h * 60 * 60 * 1000;
      const hourEnd = hourStart + 60 * 60 * 1000;
      const total = daySales
        .filter((s) => {
          const t = new Date(s.created_date).getTime();
          return t >= hourStart && t < hourEnd;
        })
        .reduce((sum, s) => sum + s.total, 0);
      return { hour: `${h}h`, total: Math.round(total * 100) / 100 };
    });
    return { hours, daySales };
  }, [sales, selectedDate]);

  const recentSales = useMemo(() => {
    return sales
      .filter((s) => s.status === "concluida")
      .sort((a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime())
      .slice(0, 6);
  }, [sales]);

  const methodLabels = {
    dinheiro: "Dinheiro",
    pix: "PIX",
    credito: "Crédito",
    debito: "Débito",
    crediario: "Crediário",
  };

  const statCards = [
    { label: "Vendas Hoje", value: todaySales.length, icon: ShoppingCart, color: "text-blue-600 bg-blue-50" },
    { label: "Total Hoje", value: formatBRL(todayTotal), icon: DollarSign, color: "text-emerald-600 bg-emerald-50" },
    { label: "Clientes", value: customers.length, icon: Users, color: "text-purple-600 bg-purple-50" },
    { label: "Produtos", value: products.length, icon: Package, color: "text-amber-600 bg-amber-50" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Visão geral do negócio</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadData(true)}
          disabled={refreshing}
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} className="p-4">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-2.5 ${card.color}`}>
                <Icon className="w-4.5 h-4.5" />
              </div>
              <div className="text-xl font-bold font-heading">{card.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{card.label}</div>
            </Card>
          );
        })}
      </div>

      {/* Aniversariantes + Clientes sumidos */}
      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <BirthdaysCard customers={customers} />
        <MissingCustomersCard customers={customers} sales={sales} />
      </div>

      {/* Weekly chart + Payments today */}
      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <Card className="p-5 lg:col-span-2">
          <h2 className="font-heading font-semibold text-base mb-4">Vendas da Semana</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="hsl(200 5% 45%)" />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(200 5% 45%)" tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v)} />
              <Tooltip formatter={(v) => formatBRL(v)} contentStyle={{ borderRadius: 8, border: "1px solid hsl(210 14% 90%)", fontSize: 13 }} />
              <Bar dataKey="total" fill={chartColor} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-5">
          <h2 className="font-heading font-semibold text-base mb-4 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" /> Pagamentos Hoje
          </h2>
          {paymentsToday.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Sem vendas hoje</p>
          ) : (
            <div className="space-y-3">
              {paymentsToday.map((p) => (
                <div key={p.method} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                    <span className="text-sm">{methodLabels[p.method] || p.method}</span>
                  </div>
                  <span className="font-semibold text-sm">{formatBRL(p.total)}</span>
                </div>
              ))}
              <div className="pt-3 border-t flex justify-between font-bold">
                <span>Total</span>
                <span className="text-primary">{formatBRL(todayTotal)}</span>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Monthly chart + Best sellers */}
      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading font-semibold text-base">Vendas por Mês</h2>
            <Badge variant="secondary" className="text-xs">{today.getFullYear()}</Badge>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(200 5% 45%)" />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(200 5% 45%)" tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v)} />
              <Tooltip formatter={(v) => formatBRL(v)} contentStyle={{ borderRadius: 8, border: "1px solid hsl(210 14% 90%)", fontSize: 13 }} />
              <Bar dataKey="total" fill={chartColor} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-5">
          <h2 className="font-heading font-semibold text-base mb-4 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" /> Mais Vendidos
          </h2>
          {bestSellers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Sem dados de produto</p>
          ) : (
            <div className="space-y-2.5">
              {bestSellers.map((p, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.qty} unid.</div>
                  </div>
                  <span className="text-sm font-semibold">{formatBRL(p.total)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Low stock */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-heading font-semibold text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" /> Estoque Baixo
          </h2>
          <Link to="/produtos" className="text-sm text-primary hover:underline flex items-center gap-1">
            Gerenciar <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {lowStock.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Todos os produtos com estoque adequado.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {lowStock.slice(0, 8).map((p) => (
              <div key={p.id} className="flex items-center justify-between p-2.5 rounded-lg border">
                <div className="text-sm font-medium truncate">{p.name}</div>
                <Badge variant="destructive" className="text-xs shrink-0 ml-2">
                  {p.stock} {p.unit || "UN"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Vendas por Hora + Vendas Recentes */}
      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="font-heading font-semibold text-base flex items-center gap-2">
              <LineChartIcon className="w-4 h-4 text-primary" /> Vendas por Hora
            </h2>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            />
          </div>
          {hourlyData.daySales.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              Sem vendas neste dia
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={hourlyData.hours.filter((h) => h.total > 0)}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} stroke="hsl(200 5% 45%)" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(200 5% 45%)" tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v)} />
                <Tooltip formatter={(v) => formatBRL(v)} contentStyle={{ borderRadius: 8, border: "1px solid hsl(210 14% 90%)", fontSize: 13 }} />
                <Bar dataKey="total" fill={chartColor} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-heading font-semibold text-base mb-4 flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-primary" /> Vendas Recentes
          </h2>
          {recentSales.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              Nenhuma venda
            </p>
          ) : (
            <div className="space-y-2">
              {recentSales.map((sale) => (
                <div key={sale.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <div className="text-sm font-medium">{saleNumberLabel(sale)}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(sale.created_date)}
                    </div>
                  </div>
                  <span className="font-semibold text-sm">{formatBRL(sale.total)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
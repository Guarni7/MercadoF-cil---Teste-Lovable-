import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import CurrencyInput from "@/components/ui/currency-input";
import {
  UtensilsCrossed, UserPlus, Trash2, Plus, Minus, ShoppingCart, CreditCard, Loader2, Scale, Split, X,
} from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "@/lib/format";
import { mensagemDeErro } from "@/lib/mensagemErro";
import {
  novaPessoa, atualizarPessoa, removerPessoa, adicionarProduto, removerProduto, valorItem,
  totaisDaMesa, dividirIgual, descricaoPeso, rotuloDoAtendimento, codigoDoAtendimento,
} from "@/lib/mesas";
import { normalizarMesa } from "@/lib/cartaoQr";
import { definirMesaDoCartao } from "@/lib/mesasApi";
import { salvarAtendimento, cancelarAtendimento } from "@/lib/mesasApi";
import ProductBrowserDialog from "@/components/pos/ProductBrowserDialog";

const paraNumero = (txt) => {
  const n = Number(String(txt).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const paraTexto = (n) => (n ? String(n).replace(".", ",") : "");

/** Peso informado à mão (v1: sem balança). Mantém o texto digitado e só aplica o número ao sair do campo. */
function PessoaLinha({ pessoa, indice, onChange, onRemove }) {
  const [pesoTxt, setPesoTxt] = useState(paraTexto(pessoa.peso));
  const bloqueada = pessoa.paga;
  return (
    <div className={`rounded-lg border p-3 space-y-2 ${bloqueada ? "bg-muted/40" : ""}`}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold shrink-0">Pessoa {indice + 1}</span>
        <Input
          value={pessoa.label}
          placeholder="Identificação (opcional)"
          className="h-8 text-sm"
          disabled={bloqueada}
          onChange={(e) => onChange({ label: e.target.value })}
        />
        {bloqueada ? (
          <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200 shrink-0">Paga</Badge>
        ) : (
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-red-600" onClick={onRemove} aria-label="Remover pessoa">
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px] uppercase text-muted-foreground">Peso (kg)</Label>
          <Input
            inputMode="decimal"
            value={pesoTxt}
            placeholder="0,000"
            className="h-9"
            disabled={bloqueada}
            onChange={(e) => setPesoTxt(e.target.value)}
            onBlur={() => onChange({ peso: paraNumero(pesoTxt) })}
          />
        </div>
        <div>
          <Label className="text-[10px] uppercase text-muted-foreground">Preço/kg</Label>
          <CurrencyInput value={pessoa.preco_kg} className="h-9" disabled={bloqueada} onChange={(v) => onChange({ preco_kg: v })} />
        </div>
        <div>
          <Label className="text-[10px] uppercase text-muted-foreground">
            Valor {pessoa.manual && <span className="normal-case text-amber-600">(ajustado)</span>}
          </Label>
          <CurrencyInput value={pessoa.valor} className="h-9 font-semibold" disabled={bloqueada} onChange={(v) => onChange({ valor: v })} />
        </div>
      </div>
      {pessoa.manual && !bloqueada && (
        <button type="button" className="text-xs text-primary underline" onClick={() => onChange({ manual: false })}>
          Voltar ao cálculo automático (peso × preço/kg)
        </button>
      )}
    </div>
  );
}

/** Mesa opcional do atendimento de cartão: pode ficar em branco, mudar durante o atendimento e nunca prende o cartão. */
function MesaDoCartao({ order, onChanged }) {
  const [txt, setTxt] = useState(order.table_number ?? "");
  useEffect(() => setTxt(order.table_number ?? ""), [order.id, order.table_number]);
  const salvar = async () => {
    const mesa = normalizarMesa(txt);
    if (mesa === (order.table_number ?? null)) return;
    try {
      await definirMesaDoCartao(order.id, mesa);
      onChanged({ ...order, table_number: mesa });
    } catch (e) {
      toast.error(mensagemDeErro(e, "salvar a mesa do cartão"));
    }
  };
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground shrink-0">Mesa (opcional)</Label>
      <Input value={txt} maxLength={20} placeholder="sem mesa" className="h-8 w-32" onChange={(e) => setTxt(e.target.value)} onBlur={salvar} />
    </div>
  );
}

export default function MesaDialog({ open, onClose, order, config, products = [], categories = [], onChanged, onCharge }) {
  const [saving, setSaving] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [dividirEm, setDividirEm] = useState(2);
  const [selPessoas, setSelPessoas] = useState(null); // null = tudo que está pendente
  const [selItens, setSelItens] = useState(null);

  const people = order?.people || [];
  const items = order?.items || [];
  const totais = useMemo(() => totaisDaMesa(order), [order]);
  // Estado mais recente (síncrono) + fila de gravação: cliques seguidos não perdem alteração nem gravam fora de ordem.
  const atual = useRef({ people: [], items: [] });
  const fila = useRef(Promise.resolve());
  const pendentes = useRef(0);
  if (order && pendentes.current === 0) atual.current = { people, items };

  if (!order) return null;

  const persist = (nextPeople, nextItems) => {
    atual.current = { people: nextPeople, items: nextItems };
    onChanged({ ...order, people: nextPeople, items: nextItems });
    pendentes.current++;
    setSaving(true);
    fila.current = fila.current.then(async () => {
      try {
        await salvarAtendimento(order.id, { people: nextPeople, items: nextItems });
      } catch (e) {
        toast.error(mensagemDeErro(e, "salvar o atendimento"));
      } finally {
        pendentes.current--;
        if (pendentes.current === 0) setSaving(false);
      }
    });
  };

  const addPessoa = () => persist([...atual.current.people, novaPessoa({ precoKg: config.precoKg || 0 })], atual.current.items);
  const mudarPessoa = (id, patch) => persist(atual.current.people.map((p) => (p.id === id ? atualizarPessoa(p, patch) : p)), atual.current.items);
  const tirarPessoa = (id) => {
    try {
      persist(removerPessoa(atual.current.people, id), atual.current.items);
    } catch (e) {
      toast.error(e.message);
    }
  };
  const addProduto = (product) => {
    if (product.semEstoque) return;
    persist(atual.current.people, adicionarProduto(atual.current.items, product, 1));
    toast.success(`${product.name} adicionado`);
  };
  const mudarQtd = (id, delta) => {
    const lista = atual.current.items;
    const alvo = lista.find((i) => i.id === id);
    if (!alvo || alvo.paga) return;
    const q = alvo.quantity + delta;
    persist(atual.current.people, q <= 0 ? lista.filter((i) => i.id !== id) : lista.map((i) => (i.id === id ? { ...i, quantity: q } : i)));
  };
  const tirarItem = (id) => {
    try {
      persist(atual.current.people, removerProduto(atual.current.items, id));
    } catch (e) {
      toast.error(e.message);
    }
  };

  const pendentesP = people.filter((p) => !p.paga);
  const pendentesI = items.filter((i) => !i.paga);
  const pessoaMarcada = (id) => (selPessoas ? selPessoas.includes(id) : true);
  const itemMarcado = (id) => (selItens ? selItens.includes(id) : true);
  const alternar = (lista, setLista, todos, id) => {
    const atual = lista || todos;
    setLista(atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]);
  };
  const idsP = pendentesP.map((p) => p.id);
  const idsI = pendentesI.map((i) => i.id);
  const marcadosP = pendentesP.filter((p) => pessoaMarcada(p.id));
  const marcadosI = pendentesI.filter((i) => itemMarcado(i.id));
  const totalSelecionado = [...marcadosP.map((p) => p.valor), ...marcadosI.map(valorItem)].reduce((s, v) => s + Math.round(v * 100), 0) / 100;
  const nada = marcadosP.length + marcadosI.length === 0;

  const cobrar = async () => {
    await fila.current; // só segue para o checkout com tudo gravado
    onCharge({ pessoaIds: marcadosP.map((p) => p.id), itemIds: marcadosI.map((i) => i.id) });
  };

  const cancelar = async () => {
    if (!window.confirm(`Cancelar o atendimento de ${rotuloDoAtendimento(order)}? Nada será cobrado.`)) return;
    setSaving(true);
    try {
      await fila.current;
      await cancelarAtendimento(order.id);
      onChanged({ ...order, status: "cancelada" });
      onClose();
    } catch (e) {
      toast.error(mensagemDeErro(e, "cancelar o atendimento"));
    } finally {
      setSaving(false);
    }
  };
  const algumPago = people.some((p) => p.paga) || items.some((i) => i.paga);
  const partes = totais.pendente > 0 ? dividirIgual(totais.pendente, dividirEm) : [];

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UtensilsCrossed className="w-5 h-5 text-primary" />
              {rotuloDoAtendimento(order)}
              <span className="rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary" title="Código do atendimento">Cód. {codigoDoAtendimento(order)}</span>
              <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200">{order.card_number ? "EM USO" : "OCUPADA"}</Badge>
              {saving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </DialogTitle>
          </DialogHeader>
          {order.card_number && <MesaDoCartao order={order} onChanged={onChanged} />}

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 overflow-y-auto pr-1">
            {/* Esquerda: lançamentos */}
            <div className="lg:col-span-3 space-y-4">
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5"><Scale className="w-4 h-4 text-primary" /> Almoço por peso</h3>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={addPessoa} disabled={saving}>
                    <UserPlus className="w-4 h-4" /> Adicionar pessoa
                  </Button>
                </div>
                {people.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhuma pessoa lançada. Cada pessoa tem peso, preço/kg e valor próprios.</p>
                )}
                {people.map((p, idx) => (
                  <PessoaLinha
                    key={p.id}
                    pessoa={p}
                    indice={idx}
                    onChange={(patch) => mudarPessoa(p.id, patch)}
                    onRemove={() => tirarPessoa(p.id)}
                  />
                ))}
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5"><ShoppingCart className="w-4 h-4 text-primary" /> Outros produtos</h3>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setBrowserOpen(true)} disabled={saving}>
                    <Plus className="w-4 h-4" /> Adicionar produto
                  </Button>
                </div>
                {items.length === 0 && <p className="text-xs text-muted-foreground">Nenhum produto lançado.</p>}
                {items.map((i) => (
                  <div key={i.id} className={`flex items-center gap-2 rounded-lg border p-2 ${i.paga ? "bg-muted/40" : ""}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{i.name}</p>
                      <p className="text-xs text-muted-foreground">{formatBRL(i.price)} un.</p>
                    </div>
                    {i.paga ? (
                      <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200">Pago</Badge>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => mudarQtd(i.id, -1)} aria-label="Diminuir"><Minus className="w-3.5 h-3.5" /></Button>
                        <span className="w-8 text-center text-sm">{i.quantity}</span>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => mudarQtd(i.id, 1)} aria-label="Aumentar"><Plus className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600" onClick={() => tirarItem(i.id)} aria-label="Remover produto"><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    )}
                    <span className="w-20 text-right text-sm font-semibold">{formatBRL(valorItem(i))}</span>
                  </div>
                ))}
              </section>
            </div>

            {/* Direita: resumo e pagamento */}
            <div className="lg:col-span-2 space-y-3">
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Resumo — {rotuloDoAtendimento(order)}{order.card_number && order.table_number ? ` · Mesa ${order.table_number}` : ""}</p>
                <p className="text-sm">{totais.qtdPessoas} {totais.qtdPessoas === 1 ? "pessoa" : "pessoas"}</p>
                {people.map((p, idx) => (
                  <div key={p.id} className="flex justify-between text-sm">
                    <span className="truncate">
                      Pessoa {idx + 1}{p.label ? ` (${p.label})` : ""}
                      <span className="block text-[11px] text-muted-foreground">{descricaoPeso(p)}</span>
                    </span>
                    <span className="font-medium">{formatBRL(p.valor)}</span>
                  </div>
                ))}
                {items.length > 0 && <p className="text-xs font-semibold text-muted-foreground pt-1">Outros produtos</p>}
                {items.map((i) => (
                  <div key={i.id} className="flex justify-between text-sm">
                    <span className="truncate">{i.quantity > 1 ? `${i.quantity}x ` : ""}{i.name}</span>
                    <span className="font-medium">{formatBRL(valorItem(i))}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t pt-2 text-base font-bold text-primary">
                  <span>TOTAL</span><span>{formatBRL(totais.total)}</span>
                </div>
                {algumPago && (
                  <div className="flex justify-between text-sm font-semibold">
                    <span>A pagar</span><span>{formatBRL(totais.pendente)}</span>
                  </div>
                )}
              </div>

              {(pendentesP.length + pendentesI.length) > 0 && (
                <div className="rounded-lg border p-3 space-y-2">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Cobrar</p>
                  <p className="text-[11px] text-muted-foreground">Marque o que será pago agora: tudo para pagamento único, ou uma pessoa por vez.</p>
                  {pendentesP.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={pessoaMarcada(p.id)} onCheckedChange={() => alternar(selPessoas, setSelPessoas, idsP, p.id)} />
                      <span className="flex-1 truncate">{p.label || `Pessoa ${people.indexOf(p) + 1}`}</span>
                      <span>{formatBRL(p.valor)}</span>
                    </label>
                  ))}
                  {pendentesI.map((i) => (
                    <label key={i.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={itemMarcado(i.id)} onCheckedChange={() => alternar(selItens, setSelItens, idsI, i.id)} />
                      <span className="flex-1 truncate">{i.quantity > 1 ? `${i.quantity}x ` : ""}{i.name}</span>
                      <span>{formatBRL(valorItem(i))}</span>
                    </label>
                  ))}
                  <Button className="w-full gap-2" onClick={cobrar} disabled={nada || saving}>
                    <CreditCard className="w-4 h-4" /> Finalizar venda — {formatBRL(totalSelecionado)}
                  </Button>
                </div>
              )}

              {totais.pendente > 0 && (
                <div className="rounded-lg border p-3 space-y-2">
                  <p className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1"><Split className="w-3.5 h-3.5" /> Dividir a conta</p>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Em</Label>
                    <Input type="number" min={1} max={30} value={dividirEm} className="h-8 w-20"
                      onChange={(e) => setDividirEm(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
                    <Label className="text-xs">partes</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {partes.map((v, i) => `${i + 1}ª ${formatBRL(v)}`).join(" · ")}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Na hora de pagar, lance cada parte como uma forma de pagamento no checkout.</p>
                </div>
              )}

              {!algumPago && (
                <Button variant="ghost" className="w-full gap-2 text-red-600" onClick={cancelar} disabled={saving}>
                  <X className="w-4 h-4" /> Cancelar atendimento
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ProductBrowserDialog
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        products={products}
        categories={categories}
        onAddToCart={addProduto}
      />
    </>
  );
}

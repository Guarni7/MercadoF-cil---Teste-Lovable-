import React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Smartphone, Loader2, Check, AlertCircle, CreditCard } from "lucide-react";
import { formatBRL } from "@/lib/format";

const TITULO = {
  ocioso: "Envie a cobrança para o Smart POS",
  enviando: "Enviando para o Smart POS...",
  aguardando: "Aguardando pagamento no Smart POS",
  indeterminado: "Situação da cobrança indeterminada",
  aprovado: "Pagamento aprovado!",
  recusado: "Pagamento recusado.",
  falhou: "A cobrança não foi iniciada.",
  erro: "Não foi possível enviar a cobrança.",
  offline: "Sem internet.",
};

/** Cobrança de crédito/débito no Smart POS (ConnectTEF). Só "aprovado" libera a venda. */
export default function ConnectTefCardPanel({ estado, cobranca, valor, method, installments, onInstallments }) {
  const { fase, erro, longa } = estado;
  const emAndamento = cobranca.emAndamento;
  const podeEnviar = !emAndamento && fase !== "aprovado";
  return (
    <div className="space-y-3">
      <div className="flex flex-col items-center gap-3 p-4 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          {fase === "enviando" || fase === "aguardando" ? (
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          ) : (
            <Smartphone className="w-8 h-8 text-primary" />
          )}
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">{TITULO[fase]}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Valor: {formatBRL(valor)}</p>
          {erro && <p className="text-xs text-destructive mt-1">{erro}</p>}
          {fase === "indeterminado" && (
            <p className="text-xs text-amber-700 mt-1">
              Não sabemos se o cliente foi cobrado. Confira no Smart POS e use "Verificar situação". Não envie de novo.
            </p>
          )}
        </div>
        {fase === "aprovado" && (
          <div className="flex items-center gap-2 text-emerald-600">
            <Check className="w-5 h-5" strokeWidth={3} />
            <span className="text-sm font-bold">Aprovado</span>
          </div>
        )}
      </div>
      {method === "credito" && (
        <div>
          <Label className="mb-2 block">Parcelas</Label>
          <Select value={installments} onValueChange={onInstallments} disabled={!podeEnviar}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }).map((_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {i + 1}x de {formatBRL(valor / (i + 1))}{i === 0 ? " (à vista)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {podeEnviar && (
        <Button
          variant="outline"
          className="w-full gap-2"
          disabled={!(valor > 0)}
          onClick={() => cobranca.iniciar({ valorReais: valor, formaPagamento: method, parcelas: method === "credito" ? Number(installments) : 1 })}
        >
          <CreditCard className="w-4 h-4" />
          {fase === "erro" || fase === "offline" ? "Tentar novamente" : "Enviar para o Smart POS"}
        </Button>
      )}
      {(fase === "aguardando" || fase === "indeterminado") && (
        <Button variant="outline" className="w-full gap-2" onClick={() => cobranca.verificarAgora()}>
          <AlertCircle className="w-4 h-4" />
          Verificar situação
        </Button>
      )}
      {longa && emAndamento && (
        <Button
          variant="ghost"
          className="w-full text-xs text-muted-foreground"
          onClick={() => {
            if (window.confirm("Abandonar esta cobrança? Se o cliente já pagou no Smart POS, o valor foi cobrado e NÃO entrará nesta venda. Confira antes.")) cobranca.abandonar();
          }}
        >
          Abandonar cobrança
        </Button>
      )}
    </div>
  );
}

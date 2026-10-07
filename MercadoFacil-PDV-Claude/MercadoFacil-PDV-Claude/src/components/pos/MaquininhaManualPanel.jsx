import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreditCard, Check, AlertCircle } from "lucide-react";
import { formatBRL } from "@/lib/format";

// Botões de confirmação em verde cheio: é a ação que o operador precisa achar e clicar (o
// "outline" cinza parecia desabilitado). Desabilitado (sem valor) volta a ficar cinza.
const BOTAO_VERDE =
  "text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 shadow-sm " +
  "disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none";

/**
 * Cartão pela maquininha independente. O sistema NÃO enxerga a maquininha, então nunca aprova
 * sozinho: só vale depois que o operador confirma, em dois passos, que a maquininha aprovou.
 * O pagamento fica marcado como confirmação manual (channel "maquininha").
 * Confirmar só marca "aprovado na maquininha" e libera o Finalizar; NÃO finaliza a venda.
 */
export default function MaquininhaManualPanel({ valor, method, installments, onInstallments, aprovado, nsu, onNsu, onConfirmar, onDesfazer }) {
  const [confirmando, setConfirmando] = useState(false);
  // Duplo clique em "Sim, foi aprovado": a segunda chamada é ignorada até a confirmação ser desfeita
  // ou o operador recomeçar o passo (o pai também ignora se já estiver aprovado).
  const travado = useRef(false);
  useEffect(() => {
    if (!aprovado) travado.current = false;
  }, [aprovado]);
  return (
    <div className="space-y-3">
      <div className="flex flex-col items-center gap-3 p-4 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <CreditCard className="w-8 h-8 text-primary" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">
            {aprovado ? "Pagamento aprovado na maquininha" : "Passe o cartão na maquininha"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Valor: {formatBRL(valor)}</p>
          {!aprovado && (
            <p className="text-xs text-amber-700 mt-1">
              O sistema não vê a maquininha. Só confirme depois que ela mostrar APROVADO.
            </p>
          )}
        </div>
        {aprovado && (
          <div className="flex items-center gap-2 text-emerald-600">
            <Check className="w-5 h-5" strokeWidth={3} />
            <span className="text-sm font-bold">Aprovado na maquininha (confirmado manualmente)</span>
          </div>
        )}
        {aprovado && (
          <p className="text-xs text-muted-foreground text-center">
            Agora clique em FINALIZAR - F10 para concluir a venda.
          </p>
        )}
      </div>

      {method === "credito" && (
        <div>
          <Label className="mb-2 block">Parcelas</Label>
          <Select value={installments} onValueChange={onInstallments} disabled={aprovado}>
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

      <div>
        <Label className="mb-2 block">NSU / autorização (opcional)</Label>
        <Input value={nsu} onChange={(e) => onNsu(e.target.value)} disabled={aprovado} placeholder="Número do comprovante da maquininha" className="h-9" />
      </div>

      {!aprovado && !confirmando && (
        <Button
          className={`w-full h-11 gap-2 font-semibold ${BOTAO_VERDE}`}
          disabled={!(valor > 0)}
          onClick={() => {
            travado.current = false;
            setConfirmando(true);
          }}
        >
          <Check className="w-4 h-4" />
          Confirmar pagamento aprovado na maquininha
        </Button>
      )}
      {!aprovado && confirmando && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
            <AlertCircle className="w-4 h-4 shrink-0" />
            A maquininha aprovou {formatBRL(valor)}?
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmando(false)}>Não</Button>
            <Button
              className={`flex-1 font-semibold ${BOTAO_VERDE}`}
              onClick={() => {
                if (travado.current) return;
                travado.current = true;
                setConfirmando(false);
                onConfirmar({ nsu: nsu.trim() });
              }}
            >
              Sim, foi aprovado
            </Button>
          </div>
        </div>
      )}
      {aprovado && (
        <Button variant="ghost" className="w-full text-xs text-muted-foreground" onClick={onDesfazer}>
          Desfazer confirmação
        </Button>
      )}
    </div>
  );
}

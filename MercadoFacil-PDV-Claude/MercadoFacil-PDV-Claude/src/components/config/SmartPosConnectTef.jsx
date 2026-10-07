// Configurações > Pagamento > Smart POS (ConnectTEF).
//
// Estrutura mínima para iniciar o pareamento: informa o documento do cliente no
// ConnectTEF, mostra o QR Code e fica "Aguardando Smart POS" até o webhook
// registrar o smartposId. Não cobra, não estorna e não mexe no TEF atual.

import React, { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, Loader2, QrCode, Smartphone } from "lucide-react";
import { buscarPareamento, iniciarPareamentoSmartPos, listarSmartPos, qrAindaValido } from "@/lib/connectTef";

const INTERVALO_MS = 3000;

export default function SmartPosConnectTef() {
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [documento, setDocumento] = useState("");
  const [gerando, setGerando] = useState(false);
  // { id, referencia, qrImagem, expiresAt, status, smartposId }
  const [pareamento, setPareamento] = useState(null);
  const [agora, setAgora] = useState(Date.now());
  const ativo = useRef(true);

  const carregar = useCallback(async () => {
    try {
      setLista((await listarSmartPos()) || []);
    } catch (e) {
      console.error("Falha ao carregar os Smart POS:", e);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    ativo.current = true;
    carregar();
    return () => {
      ativo.current = false;
    };
  }, [carregar]);

  const pareamentoId = pareamento?.id;
  const aguardando = pareamento && pareamento.status === "aguardando";

  // Aguardando: confere o pareamento a cada 3 s até o webhook vincular o aparelho.
  useEffect(() => {
    if (!pareamentoId || !aguardando) return undefined;
    const t = setInterval(async () => {
      setAgora(Date.now());
      try {
        const atual = await buscarPareamento(pareamentoId);
        if (!ativo.current || !atual) return;
        if (atual.status === "vinculado") {
          setPareamento((p) => (p ? { ...p, status: "vinculado", smartposId: atual.smartpos_id } : p));
          toast.success("Smart POS vinculado");
          carregar();
        }
      } catch (e) {
        console.error("Falha ao consultar o pareamento:", e);
      }
    }, INTERVALO_MS);
    return () => clearInterval(t);
  }, [pareamentoId, aguardando, carregar]);

  const gerar = async () => {
    setGerando(true);
    try {
      const r = await iniciarPareamentoSmartPos(documento);
      const qrImagem = await QRCode.toDataURL(r.qrCode, { margin: 1, width: 240 });
      setPareamento({ id: r.id, referencia: r.referencia, qrImagem, expiresAt: r.expiresAt, status: "aguardando", smartposId: null });
      setAgora(Date.now());
    } catch (e) {
      toast.error(e.message || "Não foi possível gerar o QR Code");
    } finally {
      setGerando(false);
    }
  };

  const expirado = aguardando && !qrAindaValido(pareamento.expiresAt, agora);
  const vinculados = lista.filter((s) => s.status === "vinculado");

  return (
    <Card className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-sky-50 flex items-center justify-center">
          <Smartphone className="w-5 h-5 text-sky-600" />
        </div>
        <div>
          <h2 className="font-heading font-semibold text-lg">Smart POS (ConnectTEF)</h2>
          <p className="text-sm text-muted-foreground">
            Vincule o Smart POS da loja lendo um QR Code. Em homologação o ConnectTEF simula a leitura.
          </p>
        </div>
      </div>

      {carregando ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
        </div>
      ) : vinculados.length ? (
        <div className="divide-y rounded-lg border mb-4">
          {vinculados.map((s) => (
            <div key={s.id} className="flex items-center justify-between p-3 text-sm">
              <span className="font-medium">{s.smartpos_id}</span>
              <Badge variant="outline">Vinculado</Badge>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground mb-4">Nenhum Smart POS vinculado ainda.</p>
      )}

      {!pareamento || pareamento.status === "vinculado" || expirado ? (
        <div className="space-y-3 max-w-sm">
          <div>
            <Label className="mb-1.5 block">CPF/CNPJ do cliente no ConnectTEF</Label>
            <Input
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              placeholder="Somente números"
              inputMode="numeric"
            />
          </div>
          <Button onClick={gerar} disabled={gerando || !documento.trim()} className="gap-2">
            {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
            {expirado ? "Gerar novo QR Code" : "Parear Smart POS"}
          </Button>
          {expirado && <p className="text-sm text-amber-700">O QR Code expirou.</p>}
          {pareamento?.status === "vinculado" && (
            <div className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="w-4 h-4" /> Smart POS {pareamento.smartposId} vinculado.
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-lg border p-4 max-w-sm">
          <img src={pareamento.qrImagem} alt="QR Code do Smart POS" className="w-60 h-60" />
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="w-4 h-4 animate-spin" /> Aguardando Smart POS
          </div>
          {pareamento.expiresAt && (
            <p className="text-xs text-muted-foreground">
              Válido até {new Date(pareamento.expiresAt).toLocaleTimeString("pt-BR")}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

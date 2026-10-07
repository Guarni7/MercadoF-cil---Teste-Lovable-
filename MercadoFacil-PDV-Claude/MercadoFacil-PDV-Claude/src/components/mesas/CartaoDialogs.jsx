import React, { useEffect, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QrCode, Printer, Camera, Loader2, ScanLine, Keyboard, CreditCard } from "lucide-react";
import { toast } from "sonner";
import {
  payloadDoCartao, qrSvg, montarFolhaCartoes, interpretarEntradaCartao, rotuloDoCartao, numeroExibicao, MAX_CARTOES, LAYOUTS_CARTAO,
} from "@/lib/cartaoQr";
import { imprimirFolhaHtml } from "@/lib/imprimirFolha";
import { cameraQrDisponivel, iniciarLeituraCamera } from "@/lib/qrCamera";

async function svgsDosCartoes(companyId, numeros) {
  return Promise.all(numeros.map(async (numero) => ({ numero: String(numero), svg: await qrSvg(await payloadDoCartao(companyId, numero)) })));
}

async function imprimir(cartoes, empresa, layout) {
  const r = await imprimirFolhaHtml(montarFolhaCartoes(cartoes, { empresa, layout }));
  if (!r.ok) toast.error(r.error || "Não foi possível imprimir.");
}

/** QR de um cartão: ver e imprimir. */
export function QrCartaoDialog({ open, onClose, numero, companyId, empresa }) {
  const [cartao, setCartao] = useState(null);
  useEffect(() => {
    if (!open || !numero || !companyId) return;
    let vivo = true;
    setCartao(null);
    svgsDosCartoes(companyId, [numero]).then((l) => vivo && setCartao(l[0]));
    return () => {
      vivo = false;
    };
  }, [open, numero, companyId]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><QrCode className="w-5 h-5 text-primary" /> QR do {numero ? rotuloDoCartao(numero).toLowerCase() : "cartão"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          <div className="w-56 rounded-xl border-2 border-dashed border-primary/40 bg-white p-4 text-center text-[#12343b]">
            <p className="text-[10px] font-extrabold tracking-[0.2em] text-primary">{(empresa || "MercadoFácil").toUpperCase()}</p>
            <p className="text-[10px] tracking-[0.3em] text-muted-foreground">CARTÃO</p>
            <p className="text-4xl font-extrabold leading-tight">{numero ? numeroExibicao(numero) : ""}</p>
            {cartao ? (
              <div className="mx-auto mt-2 w-32 h-32" dangerouslySetInnerHTML={{ __html: cartao.svg }} />
            ) : (
              <div className="mx-auto mt-2 w-32 h-32 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            )}
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Este QR fica no <strong>cartão físico</strong>: o cliente entrega o cartão ao caixa e o operador lê o QR (ou digita {numero ? numeroExibicao(numero) : "o número"}). Vale para qualquer mesa, não é um link e só funciona no MercadoFácil desta empresa.
          </p>
          <Button className="w-full gap-2" disabled={!cartao} onClick={() => imprimir([cartao], empresa, "grande")}>
            <Printer className="w-4 h-4" /> Imprimir este cartão
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Imprimir cartões/comandas: faixa de números, vários por folha A4, para recortar e plastificar. */
export function ImprimirCartoesDialog({ open, onClose, inicial, final, companyId, empresa }) {
  const [de, setDe] = useState(inicial || 1);
  const [ate, setAte] = useState(final || 100);
  const [layout, setLayout] = useState("medio");
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (open) {
      setDe(inicial || 1);
      setAte(final || 100);
    }
  }, [open, inicial, final]);
  const limite = (v) => Math.max(1, Math.min(MAX_CARTOES, Number(v) || 1));
  const total = Math.max(0, limite(ate) - limite(de) + 1);
  const porFolha = LAYOUTS_CARTAO[layout].colunas * LAYOUTS_CARTAO[layout].linhas;

  const imprimirFolha = async () => {
    setOcupado(true);
    try {
      const numeros = Array.from({ length: total }, (_, i) => limite(de) + i);
      await imprimir(await svgsDosCartoes(companyId, numeros), empresa, layout);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Printer className="w-5 h-5 text-primary" /> Imprimir cartões/comandas</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Do cartão</Label>
              <Input type="number" min={1} max={MAX_CARTOES} value={de} onChange={(e) => setDe(limite(e.target.value))} />
            </div>
            <div className="flex-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Até o cartão</Label>
              <Input type="number" min={1} max={MAX_CARTOES} value={ate} onChange={(e) => setAte(limite(e.target.value))} />
            </div>
          </div>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Tamanho</Label>
            <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={layout} onChange={(e) => setLayout(e.target.value)}>
              {Object.entries(LAYOUTS_CARTAO).map(([k, l]) => <option key={k} value={k}>{l.rotulo}</option>)}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            {total} {total === 1 ? "cartão" : "cartões"} · {porFolha} por folha A4 com borda tracejada para recortar.
          </p>
          <Button className="w-full gap-2" disabled={ocupado || total < 1 || !companyId} onClick={imprimirFolha}>
            {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />} Imprimir
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Ler cartão: leitor USB (digita o QR e dá Enter), câmera quando o navegador sabe ler QR, ou número digitado.
 * QR e número chegam ao mesmo ponto (`onEntrada(numero)`), sempre resolvidos dentro da empresa da sessão.
 * @param {any} props  { open, onClose, companyId, modo?: "qr" | "numero", onResolvido(numero) }
 */
export function LerCartaoDialog({ open, onClose, companyId, modo = "qr", onResolvido }) {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState("");
  const [camera, setCamera] = useState(false);
  const [cameraLigada, setCameraLigada] = useState(false);
  const videoRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setTexto("");
    setErro("");
    setCameraLigada(false);
    cameraQrDisponivel().then(setCamera);
  }, [open]);

  const resolver = async (lido) => {
    const r = await interpretarEntradaCartao(lido, companyId);
    if (!r.ok) {
      setErro(r.mensagem);
      return false;
    }
    setErro("");
    onResolvido(r.numero);
    return true;
  };

  useEffect(() => {
    if (!cameraLigada || !videoRef.current) return;
    const parar = iniciarLeituraCamera(
      videoRef.current,
      async (lido) => {
        if (await resolver(lido)) setCameraLigada(false);
      },
      () => {
        setErro("Não foi possível abrir a câmera. Use o leitor USB ou digite o número do cartão.");
        setCameraLigada(false);
      },
    );
    return parar;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraLigada]);

  const porNumero = modo === "numero";
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {porNumero ? <Keyboard className="w-5 h-5 text-primary" /> : <ScanLine className="w-5 h-5 text-primary" />}
            {porNumero ? "Informar número do cartão" : "Ler cartão"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {porNumero
              ? "O cliente trouxe o cartão: digite o número impresso nele (23 ou 023) e tecle Enter para abrir a comanda."
              : "O cliente trouxe o cartão: aponte o leitor para o QR do cartão (o código aparece aqui) ou digite o número. A comanda abre."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              resolver(texto);
            }}
          >
            <Input
              autoFocus
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              inputMode={porNumero ? "numeric" : undefined}
              placeholder={porNumero ? "Nº do cartão" : "QR do cartão ou nº"}
              aria-label="QR ou número do cartão"
            />
          </form>
          {erro && <p className="text-xs text-red-600">{erro}</p>}
          {!porNumero &&
            (camera ? (
              <>
                <Button type="button" variant="outline" className="w-full gap-2" onClick={() => setCameraLigada((v) => !v)}>
                  <Camera className="w-4 h-4" /> {cameraLigada ? "Desligar câmera" : "Ler pela câmera"}
                </Button>
                {cameraLigada && <video ref={videoRef} muted playsInline className="w-full rounded-lg border bg-black aspect-square object-cover" />}
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">Câmera indisponível neste aparelho/navegador: use o leitor USB ou digite o número.</p>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Cartão DISPONÍVEL: oferece abrir um novo atendimento (mesa opcional). */
export function AbrirCartaoDialog({ open, onClose, numero, onAbrir, abrindo }) {
  const [mesa, setMesa] = useState("");
  useEffect(() => {
    if (open) setMesa("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CreditCard className="w-5 h-5 text-primary" /> {numero ? rotuloDoCartao(numero) : "Cartão"} disponível</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onAbrir(mesa);
          }}
        >
          <p className="text-xs text-muted-foreground">Este cartão não tem atendimento aberto. Deseja abrir um novo atendimento?</p>
          <div>
            <Label className="text-[10px] uppercase text-muted-foreground">Mesa (opcional)</Label>
            <Input value={mesa} onChange={(e) => setMesa(e.target.value)} placeholder="Ex.: 5 — pode ficar em branco" maxLength={20} autoFocus />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Agora não</Button>
            <Button type="submit" className="flex-1" disabled={abrindo}>
              {abrindo ? <Loader2 className="w-4 h-4 animate-spin" /> : "Abrir atendimento"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

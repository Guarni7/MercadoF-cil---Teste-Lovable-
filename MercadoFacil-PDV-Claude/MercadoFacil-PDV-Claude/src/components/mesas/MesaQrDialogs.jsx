import React, { useEffect, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QrCode, Printer, Camera, Loader2, ScanLine, Keyboard, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { linkDaMesa, caminhoDaMesa, qrSvg, montarFolhaMesas, interpretarEntradaMesa, baseDoApp, versaoDaMesa } from "@/lib/mesaQr";
import { mensagemDeErro } from "@/lib/mensagemErro";
import { imprimirFolhaHtml } from "@/lib/imprimirFolha";
import { cameraQrDisponivel, iniciarLeituraCamera } from "@/lib/qrCamera";

/** Imprime plaquinhas ("MESA N" + QR) — uma ou várias, 6 por folha A4. */
export async function imprimirQrDasMesas(companyId, numeros, empresa, versoes = {}) {
  const mesas = await Promise.all(numeros.map(async (numero) => ({ numero: String(numero), svg: await qrSvg(await linkDaMesa(companyId, numero, { versao: versaoDaMesa(versoes, numero) })) })));
  const r = await imprimirFolhaHtml(montarFolhaMesas(mesas, { empresa }));
  if (!r.ok) toast.error(r.error || "Não foi possível imprimir.");
}

/** QR — Mesa N: o QR é o link fixo da mesa; ver, copiar, testar e imprimir. */
export function QrMesaDialog({ open, onClose, numero, companyId, empresa, versoes = {}, onInvalidar }) {
  const [dados, setDados] = useState(null); // { svg, link }
  const [confirmando, setConfirmando] = useState(false);
  const [invalidando, setInvalidando] = useState(false);
  const versao = versaoDaMesa(versoes, numero);
  useEffect(() => {
    if (!open || !numero || !companyId) return;
    let vivo = true;
    setDados(null);
    (async () => {
      const link = await linkDaMesa(companyId, numero, { versao });
      const caminho = await caminhoDaMesa(companyId, numero, versao);
      const svg = await qrSvg(link);
      if (vivo) setDados({ svg, link, caminho });
    })();
    return () => {
      vivo = false;
    };
  }, [open, numero, companyId, versao]);

  const invalidar = async () => {
    setInvalidando(true);
    try {
      await onInvalidar(numero);
      toast.success(`QR da Mesa ${numero} invalidado. Imprima o novo QR e substitua o antigo.`);
      setConfirmando(false);
    } catch (e) {
      toast.error(mensagemDeErro(e, "invalidar o QR da mesa"));
    } finally {
      setInvalidando(false);
    }
  };

  const temBase = !!baseDoApp();
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(dados.link);
      toast.success("Link copiado");
    } catch {
      toast.error("Não foi possível copiar. Selecione o link e copie manualmente.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><QrCode className="w-5 h-5 text-primary" /> QR — Mesa {numero}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
            <strong className="text-foreground">QR fixo da mesa</strong> — imprima uma vez e pregue na mesa. Não muda ao abrir/fechar atendimento. O link é permanente desta mesa nesta loja.
          </p>
          <div className="mx-auto w-52 h-52 rounded-xl border-2 border-primary/40 bg-white p-3">
            {dados ? <div dangerouslySetInnerHTML={{ __html: dados.svg }} /> : <div className="w-full h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}
          </div>
          <Input readOnly value={dados ? (temBase ? dados.link : dados.caminho) : ""} className="font-mono text-xs" aria-label="Link da mesa" />
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" disabled={!dados} onClick={copiar}><Copy className="w-4 h-4" /> Copiar link</Button>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={!dados || !temBase} onClick={() => window.open(dados.link, "_blank", "noopener")}><ExternalLink className="w-4 h-4" /> Testar</Button>
            <Button size="sm" className="gap-1.5" disabled={!dados} onClick={() => imprimirQrDasMesas(companyId, [numero], empresa, versoes)}><Printer className="w-4 h-4" /> Imprimir</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            O link abre a mesa no MercadoFácil para quem está logado nesta empresa; quem não está logado não vê nenhum dado. Não é uma página pública.
            {!temBase && " Sem endereço web neste aparelho (versão desktop): o QR usa o caminho acima; abra no navegador para ver o link completo."}
          </p>
          {onInvalidar && (
            <button type="button" className="mx-auto block text-xs text-red-600 underline underline-offset-2 hover:text-red-700" onClick={() => setConfirmando(true)}>
              Invalidar QR antigo (se o QR code vazou ou foi perdido)
            </button>
          )}
        </div>
      </DialogContent>
      <Dialog open={confirmando} onOpenChange={(v) => !v && !invalidando && setConfirmando(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Invalidar QR da Mesa {numero}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Isso gera um token novo. O QR impresso na mesa <strong className="text-foreground">para de funcionar</strong> e você precisará imprimir outro. Use apenas se o QR antigo vazou ou foi perdido.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmando(false)} disabled={invalidando}>Cancelar</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={invalidar} disabled={invalidando}>
              {invalidando ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sim, invalidar e gerar novo"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

/**
 * Ler QR da mesa: leitor USB (digita o link e dá Enter), câmera quando o navegador sabe ler QR, ou número da mesa.
 * Resolve só dentro da empresa da sessão. `onResolvido(numero)`.
 * @param {any} props  { open, onClose, companyId, modo?: "qr" | "numero", versoes?, onResolvido }
 */
export function LerMesaDialog({ open, onClose, companyId, modo = "qr", versoes = {}, onResolvido }) {
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
    const r = await interpretarEntradaMesa(lido, companyId, versoes);
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
        setErro("Não foi possível abrir a câmera. Use o leitor USB ou digite o número da mesa.");
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
            {porNumero ? "Informar nº da mesa" : "Ler QR da mesa"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {porNumero
              ? "Digite o número da mesa (ex.: 5) e tecle Enter."
              : "Aponte o leitor para o QR da mesa (o código aparece aqui) ou digite o número da mesa."}
          </p>
          <form onSubmit={(e) => { e.preventDefault(); resolver(texto); }}>
            <Input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} inputMode={porNumero ? "numeric" : undefined}
              placeholder={porNumero ? "Nº da mesa" : "QR da mesa ou nº"} aria-label="QR ou número da mesa" />
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

/** Confirmação antes de ocupar uma mesa LIVRE. */
export function ConfirmarAberturaDialog({ open, numero, abrindo, onCancelar, onConfirmar }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancelar()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Abrir Mesa {numero}?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">A mesa ficará ocupada e o atendimento será aberto. O QR fixo da mesa continua o mesmo.</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancelar}>Cancelar</Button>
          <Button onClick={onConfirmar} disabled={abrindo}>
            {abrindo ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar abertura"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

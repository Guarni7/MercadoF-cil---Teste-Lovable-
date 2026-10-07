import React, { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { Loader2, QrCode } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { resolverLinkMesa, ROTA_MESA } from "@/lib/mesaQr";
import { obterCompanyId, carregarVersoesQr } from "@/lib/mesasApi";

/**
 * Destino do link/QR fixo da mesa (/m/<token>). Rota do app, atrás do login (não é página pública): resolve o token
 * dentro da empresa da SESSÃO e abre a mesa em Mesas. Link de outra empresa ou inválido é recusado.
 */
export default function MesaLink() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await resolverLinkMesa(`${ROTA_MESA}${token}`, await obterCompanyId(), await carregarVersoesQr());
        if (!vivo) return;
        if (r.ok) navigate("/mesas", { replace: true, state: { abrirMesa: r.numero } });
        else setErro(r.mensagem);
      } catch {
        if (vivo) setErro("Não foi possível abrir a mesa agora. Verifique a conexão e tente de novo.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [token, navigate]);

  return (
    <div className="p-6 max-w-md mx-auto">
      <Card className="p-8 text-center space-y-4">
        {erro ? (
          <>
            <QrCode className="w-10 h-10 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">{erro}</p>
            <Button asChild variant="outline"><Link to="/mesas">Ir para Mesas</Link></Button>
          </>
        ) : (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">Abrindo a mesa…</p>
          </>
        )}
      </Card>
    </div>
  );
}

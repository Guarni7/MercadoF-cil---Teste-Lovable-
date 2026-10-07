import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { montarCarrinho, faltandoNoProdutoFiscal, rotuloDoAtendimento } from "@/lib/mesas";
import { nfceHabilitada } from "@/lib/fiscalConfig";

/**
 * Cobrança de um atendimento (mesa OU cartão/comanda): monta o carrinho e entrega ao checkout do PDV.
 * O alerta fiscal só existe para quem emite NFC-e; a validação na emissão continua em fiscalConfig.emitirDocumento.
 */
export function useCobrarAtendimento({ products, config }) {
  const navigate = useNavigate();
  const produtoFiscal = useMemo(() => products.find((p) => p.id === config.produtoFiscalId) || null, [products, config.produtoFiscalId]);
  const faltaFiscal = config.produtoFiscalId ? faltandoNoProdutoFiscal(produtoFiscal) : [];
  const usaFiscal = nfceHabilitada();

  const cobrar = (atendimento, { pessoaIds, itemIds }) => {
    const produtosPorId = Object.fromEntries(products.map((p) => [p.id, p]));
    const m = montarCarrinho(atendimento, { pessoaIds, itemIds, produtosPorId, produtoFiscal });
    if (m.faltando.length) {
      toast.error(`Produto não encontrado no cadastro: ${m.faltando.join(", ")}. Remova-o do atendimento para cobrar.`);
      return;
    }
    if (m.cart.length === 0) {
      toast.error("Nada selecionado para cobrar.");
      return;
    }
    // Só avisa quem emite NFC-e: restaurante sem emissão fiscal vende, recebe e fecha o atendimento normalmente, sem alerta.
    if (usaFiscal && m.cart.some((l) => l.product.origem === "almoco_peso") && (!produtoFiscal || faltaFiscal.length)) {
      toast.warning("Almoço por peso sem produto fiscal completo: a venda será feita, mas a NFC-e dessa venda não poderá ser emitida.");
    }
    navigate("/pdv", {
      state: { mesa: { orderId: atendimento.id, rotulo: rotuloDoAtendimento(atendimento), pessoaIds: m.pessoaIds, itemIds: m.itemIds, cart: m.cart } },
    });
  };

  return { cobrar, produtoFiscal, faltaFiscal, usaFiscal };
}

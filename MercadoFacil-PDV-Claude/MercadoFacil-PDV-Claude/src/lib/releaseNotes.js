/**
 * Notas da próxima versão e módulos comerciais.
 * Features listadas NÃO estão implementadas — só UI de atualização / lembrete.
 * Quando o usuário pedir a lista, use este arquivo.
 */
import { ADDONS, formatAddonPrice } from "@/lib/plans";


export const PENDING_RELEASE = {
  version: "3.79.2",
  fromVersion: "1.0.0",
  status: "planned", // planned | shipping | shipped
  implemented: false,
  notes: [
    "Possível configurar juros no parcelamento via Crediário",
    "Bot para Whatsapp melhorado",
    "Possível personalizar mensagens de status do delivery",
    "Melhorada Impressão de NFe",
    "Ao baixar PDF ou XML da NFe, pode escolher o destino do arquivo",
    "Melhorada busca de produtos",
    "Melhorado layout do F4 no PDV",
    "Possível ativar PDV em nova Janela (tela cheia/dedicada)",
    "Ao incluir item com observação no PDV, ele mostra sua OBS",
    "Na lista de produtos, Estoque>Relatório de Produtos, melhorado filtro",
    "Possível preenchimento automático dos códigos sugeridos no Cadastro do Produto",
    "Possível inserir apelido da pessoa no cadastro do cliente",
    "Integração de pagamento integrado agora melhorado (via smart)",
    "Melhoria nas Etiquetas",
    "APP - Na lista de produtos, possível ver custo",
    "Integração PIX Mercado Pago e Sicredi no PDV (confirmação automática)",
  ],
};

/** Módulos comerciais (trial) — UI pronta; lógica de ativação depois. */
export const COMMERCIAL_MODULES = [
  {
    id: "mesas",
    title: "Mesas",
    description: "Mapa do salão: cada mesa com sua conta, garçom e fechamento no caixa.",
    // Adicional pago: o preço vem do catálogo de planos (uma fonte só).
    priceLabel: formatAddonPrice(ADDONS.find((a) => a.id === "mesas")),
  },
  {
    id: "comandas",
    title: "Comandas",
    description: "Abre comanda por cliente ou ficha e fecha tudo de uma vez no caixa.",
  },
  {
    id: "orcamentos",
    title: "Orçamentos",
    description: "Monta orçamento, envia para o cliente e vira venda quando aprovado.",
  },
  {
    id: "condicionais",
    title: "Condicionais",
    description: "Leva peças para o cliente experimentar e cobra só o que ficou.",
  },
  {
    id: "os_veiculo",
    title: "OS Veículo",
    description: "Ordem de serviço de mecânica: veículo, peças, mão de obra e histórico.",
  },
  {
    id: "os_geral",
    title: "OS Geral",
    description: "Assistência de equipamentos: entrada, laudo, aprovação e entrega.",
  },
  {
    id: "at_cel",
    title: "AT-Cel",
    description: "Assistência de celular com checklist de entrada, senha e peças.",
  },
];

export function formatReleaseNotesList(release = PENDING_RELEASE) {
  return release.notes.map((n) => `* ${n}`).join("\n");
}

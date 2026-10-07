// Fonte única de verdade dos planos comerciais (nome, preço, desconto anual,
// recursos). PlanSelection.jsx, Plano.jsx, MeuPlanoTab.jsx e LandingPlans.jsx
// consomem daqui — evita preço/recurso divergente entre telas.
import { Zap, Crown } from "lucide-react";
import { formatBRL, roundMoney } from "@/lib/format";

export const TRIAL_DAYS = 7;
export const ANNUAL_DISCOUNT_PCT = 17;

// Só 2 planos-base. TEF NÃO é incluso em nenhum plano: é adicional pago (PAYMENT_ADDONS.tef_sitef).
export const PLANS = [
  {
    id: "mei",
    name: "MEI",
    subtitle: "Para o MEI organizar as vendas do dia a dia",
    tagline: "Comece a vender e organize seu negócio.",
    icon: Zap,
    monthlyPrice: 119.9,
    features: [
      "PDV completo e rápido",
      "Produtos, preços e estoque",
      "Promoções e preços de atacado",
      "Clientes e crediário",
      "Controle de caixa",
      "Vendas online e offline",
      "Relatórios de vendas",
      "Cadastro de serviços",
      "Agenda",
    ],
    notIncluded: ["NFC-e e NF-e", "XML para o contador", "Fila fiscal offline"],
  },
  {
    id: "simples",
    name: "Simples Nacional",
    subtitle: "Para negócios que precisam de gestão completa e emissão fiscal",
    tagline: "Tenha gestão completa e emissão fiscal.",
    icon: Crown,
    monthlyPrice: 169.9,
    features: [
      "Tudo do MEI",
      "NFC-e e NF-e",
      "Operação fiscal integrada ao PDV",
      "Fila fiscal offline",
      "XML para o contador",
      "Relatórios fiscais",
      "Controle financeiro completo",
      "Contas a pagar e receber",
      "Fluxo de caixa",
      "Gestão de fornecedores",
    ],
    notIncluded: [],
    highlighted: true,
  },
];

// Frase de destaque dos adicionais (Planos, Landing).
export const ADDONS_TAGLINE = "Ative somente os recursos que sua empresa precisa.";

// Texto contratual do reajuste anual (ainda não exibido em nenhuma tela; pronto para os termos de uso/contrato).
// Nenhum reajuste é aplicado hoje: ver supabase/functions/_shared/reajuste.ts e a tabela price_adjustments.
export const TEXTO_REAJUSTE_ANUAL =
  "Os valores das assinaturas poderão ser reajustados anualmente, após o período mínimo de 12 meses, com base na variação do IPCA acumulado no período, ou outro índice que venha a substituí-lo, mediante comunicação prévia ao cliente.";

// Adicionais do construtor "Monte o seu" (PlanSelection.jsx), em 2 grupos.
// Preços exatamente como definidos no projeto — nenhum inventado aqui.
// Espelho de preços no servidor: supabase/functions/_shared/plans.ts (mudou aqui, muda lá).
export const PAYMENT_ADDONS = [
  {
    id: "pdv_pos",
    label: "PDV POS (por equipamento)",
    monthlyPrice: 50,
    priceSuffix: " por equipamento",
    description: "Integração com maquininha Smart compatível.",
  },
  {
    id: "tef_sitef",
    label: "TEF (SiTef)",
    monthlyPrice: 90,
    fromPrice: true, // "a partir de"
    description: "Pinpad no caixa / adquirente.",
  },
];

export const EXTRA_ADDONS = [
  { id: "whatsapp", label: "WhatsApp", monthlyPrice: 19.9, description: "Comprovantes e cobrança de parcelas pelo WhatsApp." },
  { id: "nfse", label: "NFS-e", monthlyPrice: 29.9, description: "Emissão de Nota Fiscal de Serviço." },
  { id: "mesas", label: "Mesas", monthlyPrice: 19.9, description: "Mapa do salão: cada mesa com sua conta, garçom e fechamento no caixa." },
];

export const ADDONS = [...PAYMENT_ADDONS, ...EXTRA_ADDONS];

export const getPlanById = (id) => PLANS.find((p) => p.id === id) || PLANS[0];

export const getAddons = (addonIds = []) => ADDONS.filter((a) => addonIds.includes(a.id));

export const isAddonIncluded = (addonId, planId) => {
  const addon = ADDONS.find((a) => a.id === addonId);
  return !!addon?.includedInPlanIds?.includes(planId);
};

export const getMonthlyTotal = (planId, addonIds = []) =>
  roundMoney(
    getPlanById(planId).monthlyPrice +
      getAddons(addonIds).reduce((sum, a) => sum + (isAddonIncluded(a.id, planId) ? 0 : a.monthlyPrice), 0)
  );

export const getAnnualPrice = (monthlyPrice) => roundMoney(monthlyPrice * 12 * (1 - ANNUAL_DISCOUNT_PCT / 100));

export const getAnnualMonthlyEquivalent = (monthlyPrice) => roundMoney(getAnnualPrice(monthlyPrice) / 12);

export const formatMonthlyPrice = (monthlyPrice) => `${formatBRL(monthlyPrice)}/mês`;

/** Preço de um adicional como na tabela comercial: "+ R$ 50,00/mês por equipamento", "a partir de + R$ 90,00/mês". */
export const formatAddonPrice = (addon) => `${addon.fromPrice ? "a partir de " : ""}+ ${formatBRL(addon.monthlyPrice)}/mês${addon.priceSuffix || ""}`;

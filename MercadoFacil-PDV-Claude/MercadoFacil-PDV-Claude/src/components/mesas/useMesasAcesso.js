import { useMemo } from "react";
import { useAuth } from "@/lib/AuthContext";
import { isTrialExpired } from "@/lib/planAccess";
import { PLANS, ADDONS, getMonthlyTotal } from "@/lib/plans";
import { mesasLiberadas, modoDeAtivacao, reajusteDoPlano } from "@/lib/mesasAcesso";

/** Estado de acesso a Mesas a partir do usuário/empresa (plan_status, plan_addons e validade vêm do servidor). */
export function estadoDeAcessoMesas(user) {
  const expirado = isTrialExpired(user);
  const estado = { plataforma: !!user?.platform_admin, status: user?.plan_status || "none", expirado, addons: Array.isArray(user?.plan_addons) ? user.plan_addons : [] };
  const plano = PLANS.some((p) => p.id === user?.plan) ? user.plan : "mei";
  const adicional = ADDONS.find((a) => a.id === "mesas");
  return {
    liberadas: mesasLiberadas(estado),
    modo: modoDeAtivacao(estado),
    plano,
    addons: estado.addons,
    reajuste: reajusteDoPlano({ planoAtualMensal: getMonthlyTotal(plano, estado.addons), adicionalMensal: adicional?.monthlyPrice || 0 }),
    precoAdicional: adicional?.monthlyPrice || 0,
  };
}

/** Acesso + "precisa do diálogo Ativar Mesas?" (teste sem aceite registrado, ou sem direito de uso). */
export function useMesasAcesso(config) {
  const { user } = useAuth();
  return useMemo(() => {
    const a = estadoDeAcessoMesas(user);
    return { ...a, precisaAceite: a.liberadas ? a.modo === "teste" && !config?.aceiteMesas : true };
  }, [user, config?.aceiteMesas]);
}

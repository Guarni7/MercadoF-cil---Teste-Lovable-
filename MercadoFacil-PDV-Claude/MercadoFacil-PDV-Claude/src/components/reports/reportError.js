import { toast } from "sonner";

/**
 * Falha ao carregar um relatório precisa aparecer.
 *
 * Todos os relatórios usavam `.catch(() => {})`: se a consulta quebrasse (RLS,
 * coluna faltando, rede), a tela mostrava "nenhum dado" — indistinguível de um
 * período sem movimento. O lojista concluiria que não vendeu nada.
 */
export function reportLoadError(nome) {
  return (erro) => {
    console.error(`Erro ao carregar ${nome}:`, erro);
    toast.error(
      erro?.message
        ? `Não foi possível carregar ${nome}: ${erro.message}`
        : `Não foi possível carregar ${nome}.`,
      { duration: 8000 },
    );
  };
}

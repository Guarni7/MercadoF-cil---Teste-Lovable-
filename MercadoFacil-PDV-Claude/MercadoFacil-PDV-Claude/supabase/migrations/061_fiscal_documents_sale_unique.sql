-- Duplicidade de emissão fiscal: duas NFC-e/NF-e para a mesma venda.
--
-- fiscal-emit (Edge Function) ganhou uma checagem de aplicação (existe
-- documento draft/validating/transmitting/pending/authorized para o sale_id?
-- bloqueia ou devolve o existente) — mas isso sozinho tem janela de corrida
-- entre o select e o insert: duas requisições simultâneas (duplo clique,
-- retry automático) podem passar pela checagem antes de qualquer uma
-- inserir. Este índice único parcial é quem garante isso sob concorrência
-- real — a segunda inserção simultânea falha com unique_violation (23505),
-- que fiscal-emit trata devolvendo o documento vencedor em vez de estourar
-- erro genérico.
--
-- Terminal states ficam FORA do índice de propósito: rejected/cancelled/error
-- não bloqueiam nova tentativa — uma nota rejeitada pela SEFAZ (CFOP errado
-- etc.) precisa poder ser corrigida e reemitida para a mesma venda (flow.ts:
-- ALLOWED['rejected'] e ALLOWED['error'] já permitem voltar para
-- draft/validating/transmitting NA MESMA LINHA — não é um insert novo).
--
-- Não resolve aqui o caso do documento travado em 'transmitting' por falha
-- entre a SEFAZ autorizar e o transition() gravar isso — gap conhecido, fora
-- de escopo desta correção.
create unique index if not exists fiscal_documents_sale_active_idx
  on public.fiscal_documents (company_id, sale_id)
  where sale_id is not null
    and status in ('draft', 'validating', 'transmitting', 'pending', 'authorized');

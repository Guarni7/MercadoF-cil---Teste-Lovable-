-- CPF/CNPJ na nota.
--
-- O checkout já perguntava "CPF na nota?" e guardava a resposta em
-- cupomDocument, mas ela morria no diálogo: a venda era gravada sem o
-- documento. Na hora de emitir a NFC-e, o destinatário só existia se houvesse
-- um cliente cadastrado — justamente o caso que o CPF avulso resolve.
--
-- Campo na venda, e não em customers, porque consumidor final que informa CPF
-- no cupom não vira cadastro de cliente.

alter table public.sales
  add column if not exists customer_document text;

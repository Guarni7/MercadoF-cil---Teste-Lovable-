export const duvidaResolveSteps = {
  "Cadastro": [
    { text: "Vá em **Produtos** e clique em **Novo Produto**" },
    { text: "Preencha nome, preço, código/EAN e o grupo" },
    { text: "Defina o estoque inicial e a unidade (UN, KG, LT...)" },
    { text: "Salve — o produto já aparece disponível no PDV" },
  ],
  "Importação de XML": [
    { text: "Vá em **Importar XML** no menu lateral" },
    { text: "Selecione os arquivos .xml da NF-e de compra" },
    { text: "O sistema importa produtos, preços e estoque automaticamente" },
    { text: "Revise os itens importados em **Produtos**" },
  ],
  "PDV (Ponto de Venda)": [
    { text: "Use a busca ou leia o código de barras para adicionar itens" },
    { text: "Ajuste a quantidade clicando no item do carrinho" },
    { text: "Selecione o cliente (opcional) e a forma de pagamento" },
    { text: "Clique em **Finalizar** para concluir a venda" },
  ],
  "Devolução (Vestuário)": [
    { text: "Vá em **Gerenciador** e localize a venda original" },
    { text: "Abra a venda e clique em **Devolução/Troca**" },
    { text: "Selecione os itens devolvidos e informe o motivo" },
    { text: "Confirme — o estoque é reintegrado automaticamente" },
  ],
  "Cancelamento / Reimpressão": [
    { text: "Vá em **Gerenciador** e localize a venda" },
    { text: "Para cancelar, abra a venda e clique em **Cancelar**" },
    { text: "Para reimprimir, clique em **Imprimir** ou **Cupom**" },
    { text: "Cancelamentos são permitidos apenas no mesmo dia da venda" },
  ],
};

export const nfResolveSteps = {
  "Certificado digital vencido / inválido": [
    { text: "Vá em **Configurações** → aba **Fiscal**" },
    { text: "Verifique a data de validade do certificado" },
    { text: "Se vencido, adquira um novo certificado A1 junto à sua CA (Certisign, Serasa etc.)" },
    { text: "Importe o novo arquivo **.pfx** e informe a senha" },
    { text: "Salve e tente emitir novamente" },
  ],
  "Rejeição da SEFAZ (código de erro)": [
    { text: "Anote o código de rejeição exibido (ex: 562, 204...)" },
    {
      text: "Os mais comuns:",
      subItems: [
        "562 — IE do destinatário inválida",
        "204 — Duplicidade de NF-e",
        "302 — IE do emitente inválida",
        "539 — CSOSN incompatível com o regime",
      ],
    },
    { text: "Corrija o campo indicado no erro e tente novamente" },
    { text: "Se o código não estiver na lista, clique em **Ainda preciso de ajuda** informando o código" },
  ],
  "SEFAZ fora do ar / timeout": [
    { text: "A venda já foi concluída e registrada: a falha é só na emissão da nota" },
    { text: "Em **Configurações → Fiscal**, use **Testar conexão** para ver se o autorizador respondeu" },
    { text: "Aguarde alguns minutos e emita novamente pela própria venda" },
    { text: "Se o erro voltar, clique em **Ainda preciso de ajuda** com a mensagem exibida" },
  ],
  "Dados fiscais incorretos (NCM, CFOP...)": [
    { text: "A mensagem da recusa diz qual item e qual campo estão errados" },
    { text: "Acesse **Produtos** e localize o produto com erro" },
    {
      text: "Edite o produto e corrija os campos fiscais:",
      subItems: [
        "NCM — 8 dígitos obrigatórios",
        "CSOSN — compatível com o regime tributário",
        "CFOP — geralmente 5102 ou 5405",
      ],
    },
    { text: "Salve e tente emitir a nota novamente" },
  ],
  "Emitente / IE com problema": [
    { text: "Verifique se o **CNPJ** e a **IE** em **Configurações → Fiscal** estão corretos" },
    { text: "Consulte a situação da **IE** no site da **SEFAZ do seu estado**" },
    { text: "Se os dados estiverem corretos e o erro persistir, contate o suporte com o código de rejeição" },
  ],
};
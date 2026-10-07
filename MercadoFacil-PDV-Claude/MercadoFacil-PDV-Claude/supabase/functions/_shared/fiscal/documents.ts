// Montagem dos documentos fiscais.
//
// O XML é montado no servidor, com os dados que estão no banco, e não no
// navegador. Um ponto que vale registrar: calcular a chave de acesso localmente
// não é o problema — o cNF é mesmo um código numérico sorteado pelo emitente,
// conforme o leiaute. O problema do código antigo era declarar "autorizada" uma
// nota que nunca foi transmitida. Aqui a chave é só um identificador do
// documento montado; ela só vira nota quando volta protocolo do autorizador.
//
// Referências:
//   NF-e/NFC-e — leiaute 4.00 + NT 2025.002-RTC (grupo UB e totais W03)
//   NFS-e Nacional — ANEXO I, leiaute DPS/NFS-e v1.01

import type { TaxedItem } from "./taxEngine.ts";
import type { FiscalSettings } from "./validation.ts";

const UF_CODES: Record<string, string> = {
  AC: "12", AL: "27", AP: "16", AM: "13", BA: "29", CE: "23", DF: "53",
  ES: "32", GO: "52", MA: "21", MT: "51", MS: "50", MG: "31", PA: "15",
  PB: "25", PR: "41", PE: "26", PI: "22", RJ: "33", RN: "24", RS: "43",
  RO: "11", RR: "14", SC: "42", SP: "35", SE: "28", TO: "17",
};

const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const money = (value: number) => (Number(value) || 0).toFixed(2);
const rate = (value: number) => (Number(value) || 0).toFixed(4);

// DV da chave de acesso — módulo 11 com pesos 2 a 9, conforme o Manual de
// Orientação do Contribuinte.
const checkDigit = (key: string) => {
  let sum = 0;
  let weight = 2;
  for (let i = key.length - 1; i >= 0; i--) {
    sum += Number(key[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return String(rest < 2 ? 0 : 11 - rest);
};

export const buildAccessKey = (opts: {
  uf: string;
  issuedAt: Date;
  cnpj: string;
  model: string;
  series: number;
  number: number;
  tpEmis?: string;
}) => {
  const cUF = UF_CODES[opts.uf] ?? "";
  if (!cUF) throw new Error(`UF inválida para a chave de acesso: ${opts.uf}`);

  // AAMM da chave tem de ser o mesmo mês do dhEmi: recebe a data já em hora local
  // (ver emissaoLocal) e lê os campos UTC dela, sem depender do fuso do servidor.
  const yy = String(opts.issuedAt.getUTCFullYear()).slice(2);
  const mm = String(opts.issuedAt.getUTCMonth() + 1).padStart(2, "0");
  const cnpj = digits(opts.cnpj).padStart(14, "0").slice(0, 14);
  const serie = String(opts.series).padStart(3, "0");
  const numero = String(opts.number).padStart(9, "0");
  const tpEmis = opts.tpEmis ?? "1";
  const cNF = String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0");

  const base = `${cUF}${yy}${mm}${cnpj}${opts.model}${serie}${numero}${tpEmis}${cNF}`;
  return { key: base + checkDigit(base), cNF };
};

// dhEmi é TDateTimeUTC: AAAA-MM-DDThh:mm:ss±hh:mm, sem milissegundos nem "Z".
// ponytail: offset fixo -03:00 (GO e demais UFs de Brasília); AC/AM/MT/MS/RO/RR
// têm outro fuso — derivar o offset da UF quando houver emitente nelas.
const emissaoLocal = (now: Date) => {
  const local = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return { local, dhEmi: `${local.toISOString().slice(0, 19)}-03:00` };
};

// Em homologação o xProd do primeiro item é fixo (Manual de Orientação, regra de
// NF-e/NFC-e em tpAmb=2).
const XPROD_HOMOLOGACAO = "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

const PAYMENT_CODES: Record<string, string> = {
  dinheiro: "01",
  cheque: "02",
  credito: "03",
  debito: "04",
  crediario: "05",
  pix: "17",
};

export type SalePayment = {
  method?: string | null;
  channel?: string | null;
  provider?: string | null;
  transactionId?: string | null;
  nsu?: string | null;
};

// Grupo card (YA04) do detPag. A NFC-e com tPag 03/04 sem ele é rejeitada (cStat 391).
// Só cobre cartão da maquininha, que não conversa com o sistema: tpIntegra=2
// (NT 2016.002/2023.004). CNPJ da credenciadora e bandeira são opcionais nesse caso e
// não existem no MercadoFácil, então não saem; o NSU digitado vai em cAut (1 a 128).
// Cartão integrado (Smart POS/TEF, tpIntegra=1) exige CNPJ e cAut e fica de fora aqui.
// ponytail: cartão TEF/Smart POS continua sem card (rejeição 391) até haver o CNPJ da credenciadora.
const cardMaquininha = (tPag: string, payments?: SalePayment[] | null) => {
  if (tPag !== "03" && tPag !== "04") return "";
  const p = (payments || []).find((x) => PAYMENT_CODES[x.method ?? ""] === tPag);
  // Mesma dedução de cardChannel.canalDoPagamento: venda antiga sem channel segue a forma do registro.
  const canal = p?.channel || (p?.provider === "connecttef" ? "smartpos" : p?.transactionId ? "tef" : "maquininha");
  if (canal !== "maquininha") return "";
  const nsu = String(p?.nsu ?? "").trim().slice(0, 128);
  return `
          <card>
            <tpIntegra>2</tpIntegra>${nsu ? `
            <cAut>${esc(nsu)}</cAut>` : ""}
          </card>`;
};

// Grupo UB — det/imposto/IBSCBS, conforme NT 2025.002-RTC.
const ibsCbsGroup = (item: TaxedItem) => {
  const g = item.taxes.ibscbs;
  if (!g) return "";
  const c = g.gIBSCBS;
  return `
          <IBSCBS>
            <CST>${esc(g.CST)}</CST>
            <cClassTrib>${esc(g.cClassTrib)}</cClassTrib>
            <gIBSCBS>
              <vBC>${money(c.vBC)}</vBC>
              <gIBSUF>
                <pIBSUF>${rate(c.gIBSUF.pIBSUF)}</pIBSUF>
                <pAliqEfet>${rate(c.gIBSUF.pAliqEfet)}</pAliqEfet>
                <vIBSUF>${money(c.gIBSUF.vIBSUF)}</vIBSUF>
              </gIBSUF>
              <gIBSMun>
                <pIBSMun>${rate(c.gIBSMun.pIBSMun)}</pIBSMun>
                <pAliqEfet>${rate(c.gIBSMun.pAliqEfet)}</pAliqEfet>
                <vIBSMun>${money(c.gIBSMun.vIBSMun)}</vIBSMun>
              </gIBSMun>
              <vIBS>${money(c.vIBS)}</vIBS>
              <gCBS>
                <pCBS>${rate(c.gCBS.pCBS)}</pCBS>
                <pAliqEfet>${rate(c.gCBS.pAliqEfet)}</pAliqEfet>
                <vCBS>${money(c.gCBS.vCBS)}</vCBS>
              </gCBS>
            </gIBSCBS>
          </IBSCBS>`;
};

const icmsGroup = (item: TaxedItem) => {
  const icms = item.taxes.icms as Record<string, unknown> | undefined;
  if (!icms) return "";
  const orig = esc(icms.origem ?? item.origin ?? "0");

  // CSOSN é do Simples Nacional; CST é do regime normal. Nunca os dois.
  if (icms.csosn) {
    return `
          <ICMS>
            <ICMSSN${esc(icms.csosn)}>
              <orig>${orig}</orig>
              <CSOSN>${esc(icms.csosn)}</CSOSN>
            </ICMSSN${esc(icms.csosn)}>
          </ICMS>`;
  }

  return `
          <ICMS>
            <ICMS${esc(icms.cst)}>
              <orig>${orig}</orig>
              <CST>${esc(icms.cst)}</CST>
              <vBC>${money(Number(icms.vBC))}</vBC>
              <pICMS>${rate(Number(icms.pICMS))}</pICMS>
              <vICMS>${money(Number(icms.vICMS))}</vICMS>
            </ICMS${esc(icms.cst)}>
          </ICMS>`;
};

const federalGroup = (item: TaxedItem, tag: "PIS" | "COFINS") => {
  const data = item.taxes[tag.toLowerCase() as "pis" | "cofins"] as Record<string, unknown> | undefined;
  if (!data) return "";
  return `
          <${tag}>
            <${tag}Aliq>
              <CST>${esc(data.cst)}</CST>
              <vBC>${money(Number(data.vBC))}</vBC>
              <p${tag}>${rate(Number(data.aliquota))}</p${tag}>
              <v${tag}>${money(Number(data.valor))}</v${tag}>
            </${tag}Aliq>
          </${tag}>`;
};

export type BuildInput = {
  settings: FiscalSettings;
  items: TaxedItem[];
  totals: Record<string, number>;
  recipient: Record<string, unknown> | null;
  series: number;
  number: number;
  environment: "homologacao" | "producao";
  model?: "55" | "65";
  saleNumber?: number;
  paymentMethod?: string;
  /** sales.payments[] da venda — só usado para o grupo card da NFC-e (canal e NSU). */
  payments?: SalePayment[] | null;
};

export const buildNfceXml = (input: BuildInput) => {
  const { settings, items, totals, recipient } = input;
  const model = input.model ?? "65";
  const { local, dhEmi } = emissaoLocal(new Date());
  const tpAmb = input.environment === "producao" ? "1" : "2";

  const { key, cNF } = buildAccessKey({
    uf: settings.uf!,
    issuedAt: local,
    cnpj: settings.cnpj!,
    model,
    series: input.series,
    number: input.number,
  });

  const detalhes = items
    .map((item, i) => `
      <det nItem="${i + 1}">
        <prod>
          <cProd>${esc(item.product_id ?? i + 1)}</cProd>
          <cEAN>${esc(item.gtin || "SEM GTIN")}</cEAN>
          <xProd>${esc(i === 0 && tpAmb === "2" ? XPROD_HOMOLOGACAO : item.name)}</xProd>
          <NCM>${esc(item.ncm)}</NCM>${item.cest ? `
          <CEST>${esc(item.cest)}</CEST>` : ""}
          <CFOP>${esc(item.cfop)}</CFOP>
          <uCom>${esc(item.unit)}</uCom>
          <qCom>${Number(item.quantity).toFixed(4)}</qCom>
          <vUnCom>${Number(item.price).toFixed(10)}</vUnCom>
          <vProd>${money(item.total)}</vProd>
          <cEANTrib>${esc(item.gtin || "SEM GTIN")}</cEANTrib>
          <uTrib>${esc(item.unit)}</uTrib>
          <qTrib>${Number(item.quantity).toFixed(4)}</qTrib>
          <vUnTrib>${Number(item.price).toFixed(10)}</vUnTrib>
          <indTot>1</indTot>
        </prod>
        <imposto>${icmsGroup(item)}${federalGroup(item, "PIS")}${federalGroup(item, "COFINS")}${ibsCbsGroup(item)}
        </imposto>
      </det>`)
    .join("");

  const totalNota = items.reduce((acc, i) => acc + Number(i.total || 0), 0);
  const tPag = PAYMENT_CODES[input.paymentMethod ?? ""] ?? "99";
  const temIbsCbs = items.some((i) => i.taxes.ibscbs);
  const somaFederal = (tag: "pis" | "cofins") =>
    items.reduce((acc, i) => acc + Number((i.taxes[tag] as Record<string, unknown> | undefined)?.valor || 0), 0);

  const destinatario = recipient?.document
    ? `
      <dest>
        <${digits(recipient.document).length === 11 ? "CPF" : "CNPJ"}>${digits(recipient.document)}</${digits(recipient.document).length === 11 ? "CPF" : "CNPJ"}>
        <xNome>${esc(recipient.name)}</xNome>
        <indIEDest>${esc(recipient.ie_indicator || "9")}</indIEDest>
      </dest>`
    : "";

  // Totais W03 — IBSCBSTot, presente só quando há grupo IBS/CBS nos itens.
  const totaisIbsCbs = temIbsCbs
    ? `
        <IBSCBSTot>
          <vBCIBSCBS>${money(totals.vBCIBSCBS)}</vBCIBSCBS>
          <gIBS>
            <gIBSUF><vIBSUF>${money(totals.vIBSUF)}</vIBSUF></gIBSUF>
            <gIBSMun><vIBSMun>${money(totals.vIBSMun)}</vIBSMun></gIBSMun>
            <vIBS>${money(totals.vIBS)}</vIBS>
          </gIBS>
          <gCBS><vCBS>${money(totals.vCBS)}</vCBS></gCBS>
        </IBSCBSTot>`
    : "";

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe${key}" versao="4.00">
    <ide>
      <cUF>${UF_CODES[settings.uf!]}</cUF>
      <cNF>${cNF}</cNF>
      <natOp>Venda ao consumidor</natOp>
      <mod>${model}</mod>
      <serie>${input.series}</serie>
      <nNF>${input.number}</nNF>
      <dhEmi>${dhEmi}</dhEmi>
      <tpNF>1</tpNF>
      <idDest>1</idDest>
      <cMunFG>${esc(settings.city_ibge_code)}</cMunFG>
      <tpImp>${model === "65" ? "4" : "1"}</tpImp>
      <tpEmis>1</tpEmis>
      <cDV>${key.slice(-1)}</cDV>
      <tpAmb>${tpAmb}</tpAmb>
      <finNFe>1</finNFe>
      <indFinal>1</indFinal>
      <indPres>1</indPres>
      <procEmi>0</procEmi>
      <verProc>MercadoFacilPDV</verProc>
    </ide>
    <emit>
      <CNPJ>${digits(settings.cnpj)}</CNPJ>
      <xNome>${esc(settings.legal_name)}</xNome>
      <xFant>${esc(settings.trade_name || settings.legal_name)}</xFant>
      <enderEmit>
        <xLgr>${esc(settings.address)}</xLgr>
        <nro>${esc(settings.address_number)}</nro>
        <xBairro>${esc(settings.neighborhood)}</xBairro>
        <cMun>${esc(settings.city_ibge_code)}</cMun>
        <xMun>${esc(settings.city_name)}</xMun>
        <UF>${esc(settings.uf)}</UF>
        <CEP>${digits(settings.cep)}</CEP>
      </enderEmit>
      <IE>${settings.ie_isento ? "ISENTO" : digits(settings.ie)}</IE>
      <CRT>${esc(settings.crt)}</CRT>
    </emit>${destinatario}${detalhes}
    <total>
      <ICMSTot>
        <vBC>0.00</vBC>
        <vICMS>0.00</vICMS>
        <vICMSDeson>0.00</vICMSDeson>
        <vFCP>0.00</vFCP>
        <vBCST>0.00</vBCST>
        <vST>0.00</vST>
        <vFCPST>0.00</vFCPST>
        <vFCPSTRet>0.00</vFCPSTRet>
        <vProd>${money(totalNota)}</vProd>
        <vFrete>0.00</vFrete>
        <vSeg>0.00</vSeg>
        <vDesc>0.00</vDesc>
        <vII>0.00</vII>
        <vIPI>0.00</vIPI>
        <vIPIDevol>0.00</vIPIDevol>
        <vPIS>${money(somaFederal("pis"))}</vPIS>
        <vCOFINS>${money(somaFederal("cofins"))}</vCOFINS>
        <vOutro>0.00</vOutro>
        <vNF>${money(totalNota)}</vNF>
      </ICMSTot>${totaisIbsCbs}
    </total>
    <transp>
      <modFrete>9</modFrete>
    </transp>
    <pag>
      <detPag>
        <tPag>${tPag}</tPag>
        <vPag>${money(totalNota)}</vPag>${cardMaquininha(tPag, input.payments)}
      </detPag>
    </pag>
  </infNFe>
</NFe>`;
  return xml.replace(/>\s+</g, "><");
};

// DPS — Declaração de Prestação de Serviços, o documento que o contribuinte
// envia no POST /nfse da Sefin Nacional. A NFS-e é o que volta de lá.
//
// Id da DPS: "DPS" + cLocEmi(7) + tpInsc(1) + CNPJ/CPF(14) + série(5) + nDPS(15).
export const buildDpsXml = (input: BuildInput) => {
  const { settings, items, recipient } = input;
  const issuedAt = new Date();
  const tpAmb = input.environment === "producao" ? "1" : "2";

  const cLocEmi = digits(settings.city_ibge_code).padStart(7, "0");
  const cnpj = digits(settings.cnpj).padStart(14, "0");
  const serie = String(input.series).padStart(5, "0");
  const nDPS = String(input.number).padStart(15, "0");
  const dpsId = `DPS${cLocEmi}2${cnpj}${serie}${nDPS}`;

  const servico = items[0];
  if (!servico) throw new Error("DPS sem item de serviço");

  const valorTotal = items.reduce((acc, i) => acc + Number(i.total || 0), 0);
  const iss = servico.taxes.iss as Record<string, unknown> | undefined;

  const tomador = recipient?.document
    ? `
      <toma>
        <${digits(recipient.document).length === 11 ? "CPF" : "CNPJ"}>${digits(recipient.document)}</${digits(recipient.document).length === 11 ? "CPF" : "CNPJ"}>
        <xNome>${esc(recipient.name)}</xNome>
      </toma>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">
  <infDPS Id="${dpsId}">
    <tpAmb>${tpAmb}</tpAmb>
    <dhEmi>${issuedAt.toISOString()}</dhEmi>
    <verAplic>MercadoFacilPDV</verAplic>
    <serie>${input.series}</serie>
    <nDPS>${input.number}</nDPS>
    <dCompet>${issuedAt.toISOString().slice(0, 10)}</dCompet>
    <tpEmit>1</tpEmit>
    <cLocEmi>${cLocEmi}</cLocEmi>
    <prest>
      <CNPJ>${cnpj}</CNPJ>
      <IM>${esc(settings.im)}</IM>
      <regTrib>
        <opSimpNac>${settings.tax_regime === "mei" ? "3" : settings.tax_regime === "simples" ? "2" : "1"}</opSimpNac>
      </regTrib>
    </prest>${tomador}
    <serv>
      <locPrest>
        <cLocPrestacao>${cLocEmi}</cLocPrestacao>
      </locPrest>
      <cServ>
        <cTribNac>${esc(servico.service_national_code || servico.lc116_item)}</cTribNac>
        <xDescServ>${esc(servico.name)}</xDescServ>
      </cServ>
    </serv>
    <valores>
      <vServPrest>
        <vServ>${money(valorTotal)}</vServ>
      </vServPrest>
      <trib>
        <tribMun>
          <tribISSQN>${iss?.retido ? "2" : "1"}</tribISSQN>
          <pAliq>${rate(Number(iss?.aliquota ?? 0))}</pAliq>
        </tribMun>
      </trib>
    </valores>
  </infDPS>
</DPS>`;
};

/** Motivos oficiais de cancelamento de NFS-e (TSMotivo). */
export const MOTIVOS_CANCELAMENTO = {
  "1": "Erro na emissão",
  "2": "Serviço não prestado",
  "9": "Outros",
} as const;

export type MotivoCancelamento = keyof typeof MOTIVOS_CANCELAMENTO;

/**
 * Pedido de registro do evento de cancelamento de NFS-e (tpEvento 101101).
 *
 * Vai assinado em XMLDSig e compactado no POST /nfse/{chave}/eventos. Cancelar
 * a nota só no nosso banco não cancelaria nada perante o fisco — o cancelamento
 * existe quando o autorizador registra o evento.
 *
 * Fonte: gov.br/nfse — leiaute do Pedido de Registro de Evento (TCInfPedReg),
 * bloco e101101 com xDesc, cMotivo e xMotivo.
 */
export const buildCancelamentoNfseXml = (input: {
  accessKey: string;
  cnpjAutor: string;
  motivo: MotivoCancelamento;
  justificativa: string;
  environment: "homologacao" | "producao";
}) => {
  const chNFSe = digits(input.accessKey);
  const cnpj = digits(input.cnpjAutor).padStart(14, "0");
  const tpAmb = input.environment === "producao" ? "1" : "2";
  const tpEvento = "101101";

  // xMotivo tem mínimo de 15 caracteres no tipo oficial (TSMotivo). Recusar
  // aqui evita queimar uma ida ao autorizador para receber rejeição de schema.
  const justificativa = input.justificativa.trim();
  if (justificativa.length < 15 || justificativa.length > 255) {
    throw new Error(
      "A justificativa do cancelamento precisa ter entre 15 e 255 caracteres " +
        `(informados: ${justificativa.length})`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">
  <infPedReg Id="PRE${chNFSe}${tpEvento}">
    <tpAmb>${tpAmb}</tpAmb>
    <verAplic>MercadoFacilPDV</verAplic>
    <dhEvento>${isoComFuso(new Date())}</dhEvento>
    <CNPJAutor>${cnpj}</CNPJAutor>
    <chNFSe>${chNFSe}</chNFSe>
    <e101101>
      <xDesc>Cancelamento de NFS-e</xDesc>
      <cMotivo>${input.motivo}</cMotivo>
      <xMotivo>${esc(justificativa)}</xMotivo>
    </e101101>
  </infPedReg>
</pedRegEvento>`;
};

/**
 * Evento de cancelamento de NF-e/NFC-e (tpEvento 110111).
 *
 * Vai assinado em XMLDSig (infEvento) e transmitido ao webservice
 * NFeRecepcaoEvento4 da SEFAZ da UF — cancelar só no nosso banco não cancela
 * nada perante o fisco, precisa do evento registrado lá.
 *
 * Id do evento: "ID" + tpEvento(6) + chNFe(44) + nSeqEvento(2, zero à
 * esquerda). nSeqEvento é sempre "1" aqui — cancelamento não se repete para a
 * mesma nota, diferente de Carta de Correção.
 *
 * Fonte: MOC 7.0 — Evento de Cancelamento (schema envEvento/infEvento,
 * grupo detEvento com descEvento/nProt/xJust); exemplo oficial de referência
 * (nfephp-org/sped-nfe, docs/metodos/Cancelamento.md).
 */
export const buildCancelamentoNfeXml = (input: {
  accessKey: string;
  cnpjAutor: string;
  uf: string;
  protocol: string;
  justificativa: string;
  environment: "homologacao" | "producao";
}) => {
  const chave = digits(input.accessKey).padStart(44, "0");
  const cnpj = digits(input.cnpjAutor).padStart(14, "0");
  const tpAmb = input.environment === "producao" ? "1" : "2";
  const tpEvento = "110111";
  const nSeqEvento = "1";
  const cOrgao = UF_CODES[input.uf] ?? "";
  if (!cOrgao) throw new Error(`UF inválida para o evento de cancelamento: ${input.uf}`);

  // xJust tem mínimo de 15 caracteres no tipo oficial (TSJust). Recusar aqui
  // evita queimar uma transmissão para receber rejeição de schema.
  const justificativa = input.justificativa.trim();
  if (justificativa.length < 15 || justificativa.length > 255) {
    throw new Error(
      "A justificativa do cancelamento precisa ter entre 15 e 255 caracteres " +
        `(informados: ${justificativa.length})`,
    );
  }
  if (!input.protocol) {
    throw new Error("Cancelamento exige o protocolo de autorização original da nota");
  }

  const idLote = String(Date.now()).slice(-15);
  const idEvento = `ID${tpEvento}${chave}${nSeqEvento.padStart(2, "0")}`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
  <idLote>${idLote}</idLote>
  <evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
    <infEvento Id="${idEvento}">
      <cOrgao>${cOrgao}</cOrgao>
      <tpAmb>${tpAmb}</tpAmb>
      <CNPJ>${cnpj}</CNPJ>
      <chNFe>${chave}</chNFe>
      <dhEvento>${isoComFuso(new Date())}</dhEvento>
      <tpEvento>${tpEvento}</tpEvento>
      <nSeqEvento>${nSeqEvento}</nSeqEvento>
      <verEvento>1.00</verEvento>
      <detEvento versao="1.00">
        <descEvento>Cancelamento</descEvento>
        <nProt>${esc(input.protocol)}</nProt>
        <xJust>${esc(justificativa)}</xJust>
      </detEvento>
    </infEvento>
  </evento>
</envEvento>`;
  // Sem espaço entre tags: o digest do infEvento é calculado sem eles (signature.ts), então o que é
  // transmitido tem de ser exatamente o que foi assinado, senão a SEFAZ recalcula outro digest.
  return xml.replace(/>\s+</g, "><");
};

/** O leiaute exige data-hora com fuso explícito, não o "Z" do toISOString. */
function isoComFuso(d: Date) {
  const offset = -d.getTimezoneOffset();
  const sinal = offset >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const mm = String(Math.abs(offset) % 60).padStart(2, "0");
  const local = new Date(d.getTime() + offset * 60000).toISOString().slice(0, 19);
  return `${local}${sinal}${hh}:${mm}`;
}

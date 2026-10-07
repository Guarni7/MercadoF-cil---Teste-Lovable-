// QR Code da NFC-e — NT 2015.002, leiaute simplificado (versão de QR Code 2,
// em vigor desde a retirada do leiaute antigo com dhEmi/vNF/vICMS/digVal, que
// só valia para contingência offline — fora de escopo aqui, pois emitimos
// sempre em tpEmis=1, online).
//
// String do QR Code: <urlConsulta>?p=<chave>|<versaoQR>|<tpAmb>|<idCSC>|<hash>
// hash = SHA-1("<chave>|<versaoQR>|<tpAmb>|<idCSC>" + CSC), hex maiúsculo — os
// quatro primeiros parâmetros separados por "|" e o CSC colado no fim, sem
// separador (Manual de Padrões Técnicos do DANFE NFC-e e QR Code v6.0, itens
// 4.3.1 e 4.3.4, com exemplo calculado em 4.3.6.1).
//
// idCSC vai SEM zeros não significativos ("1", não "000001"), tanto na URL quanto
// no hash (Manual 4.3.1, 4º parâmetro; o XSD aceita só (0|[1-9][0-9]{0,5})).
//
// O CSC nunca aparece na URL nem no XML — só entra no hash. idCSC (idToken)
// aparece em texto puro, porque é assim que o autorizador identifica qual CSC
// foi usado sem o contribuinte revelar o segredo.
//
// ponytail: só QR Code v2 (exige CSC). A v3 online é `?p=<chave>|3|<tpAmb>`, sem CSC
// nem hash (NT 2025.001); migrar para ela elimina o cadastro de CSC.
const QR_VERSAO = "2";

export type NfceQrCodeInput = {
  accessKey: string;
  environment: "homologacao" | "producao";
  idCsc: string;
  csc: string;
  /** URL pública de consulta da NFC-e por ambiente, vinda de fiscal_sefaz_endpoints (service "qrcode"). */
  baseUrl: string;
};

export async function buildNfceQrCode(input: NfceQrCodeInput): Promise<{ url: string; urlChave: string }> {
  const tpAmb = input.environment === "producao" ? "1" : "2";
  const idCsc = String(input.idCsc).trim().replace(/^0+(?=\d)/, "");
  if (!/^(0|[1-9]\d{0,5})$/.test(idCsc)) {
    throw new Error(`ID do CSC inválido para o QR Code: "${input.idCsc}" (1 a 6 dígitos)`);
  }
  const payload = `${input.accessKey}|${QR_VERSAO}|${tpAmb}|${idCsc}${input.csc}`;

  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(payload));
  const hash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  const url = `${input.baseUrl}?p=${input.accessKey}|${QR_VERSAO}|${tpAmb}|${idCsc}|${hash}`;
  return { url, urlChave: input.baseUrl };
}

/**
 * Insere o grupo infNFeSupl (qrCode + urlChave) no XML já assinado, entre o
 * fechamento de </infNFe> e a abertura de <Signature> — ordem exigida pelo
 * schema TNFe (infNFe, infNFeSupl, Signature). signXml() grava a assinatura
 * logo após </infNFe>, então este passo roda depois de assinar.
 */
export function insertInfNFeSupl(xmlAssinado: string, qrCode: { url: string; urlChave: string }): string {
  const grupo = `<infNFeSupl><qrCode><![CDATA[${qrCode.url}]]></qrCode><urlChave>${qrCode.urlChave}</urlChave></infNFeSupl>`;
  const marcador = "</infNFe><Signature";
  const posicao = xmlAssinado.indexOf(marcador);
  if (posicao === -1) {
    throw new Error("XML assinado não tem o formato esperado para inserir infNFeSupl");
  }
  return (
    xmlAssinado.slice(0, posicao + "</infNFe>".length) +
    grupo +
    xmlAssinado.slice(posicao + "</infNFe>".length)
  );
}

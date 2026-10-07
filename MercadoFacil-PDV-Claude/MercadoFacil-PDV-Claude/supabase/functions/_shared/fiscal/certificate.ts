// Certificado digital A1.
//
// O .pfx (PKCS#12) chega em base64, é aberto aqui no servidor com a senha da
// empresa e nunca volta para o navegador. O que a tela recebe é só o titular e
// a validade — o suficiente para mostrar "válido até tal dia" sem expor a
// chave privada.
//
// O material fica em company_fiscal_secrets, tabela com RLS ligada e zero
// policies: nem o dono da loja lê com a chave anônima.

import forge from "https://esm.sh/node-forge@1.3.1";

export type ParsedCertificate = {
  certPem: string;
  keyPem: string;
  subject: string;
  issuer: string;
  validFrom: Date;
  validTo: Date;
  cnpj: string | null;
};

const extractCnpj = (cert: forge.pki.Certificate): string | null => {
  // No e-CNPJ ICP-Brasil o CNPJ fica numa extensão subjectAltName
  // (otherName 2.16.76.1.3.3). Quando não dá para ler, o campo volta nulo em
  // vez de um palpite — quem confere é a validação da emissão.
  try {
    const ext = cert.getExtension("subjectAltName") as { altNames?: { value?: string }[] } | null;
    const joined = (ext?.altNames || []).map((a) => a.value || "").join(" ");
    const match = joined.match(/\d{14}/);
    if (match) return match[0];
  } catch {
    // Extensão ausente ou em formato inesperado: segue sem CNPJ.
  }

  const cn = cert.subject.getField("CN")?.value as string | undefined;
  const match = cn?.match(/(\d{14})/);
  return match ? match[1] : null;
};

export const parsePfx = (pfxBase64: string, password: string): ParsedCertificate => {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const der = forge.util.decode64(pfxBase64);
    const asn1 = forge.asn1.fromDer(der);
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  } catch (e) {
    const msg = String((e as Error).message || "");
    if (/mac|password|invalid/i.test(msg)) {
      throw new Error("Senha do certificado incorreta ou arquivo .pfx inválido");
    }
    throw new Error(`Não foi possível ler o certificado: ${msg}`);
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const keyBags =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ||
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ||
    [];

  const key = keyBags[0]?.key;
  if (!key) throw new Error("Certificado não contém chave privada utilizável");

  // Um .pfx da ICP-Brasil traz a cadeia inteira. O certificado do titular é o
  // que corresponde à chave privada; pegar o primeiro da lista pega a AC por
  // engano em alguns arquivos.
  const publicKeyPem = forge.pki.publicKeyToPem(
    forge.pki.setRsaPublicKey((key as forge.pki.rsa.PrivateKey).n, (key as forge.pki.rsa.PrivateKey).e),
  );

  const holder =
    certBags.find((bag) => {
      const c = bag.cert;
      if (!c) return false;
      try {
        return forge.pki.publicKeyToPem(c.publicKey) === publicKeyPem;
      } catch {
        return false;
      }
    })?.cert || certBags[0]?.cert;

  if (!holder) throw new Error("Certificado não contém o certificado do titular");

  const subject = holder.subject.attributes
    .map((a) => `${a.shortName || a.name}=${a.value}`)
    .join(", ");
  const issuer = holder.issuer.attributes
    .map((a) => `${a.shortName || a.name}=${a.value}`)
    .join(", ");

  return {
    certPem: forge.pki.certificateToPem(holder),
    keyPem: forge.pki.privateKeyToPem(key as forge.pki.rsa.PrivateKey),
    subject,
    issuer,
    validFrom: holder.validity.notBefore,
    validTo: holder.validity.notAfter,
    cnpj: extractCnpj(holder),
  };
};

/** Nome do titular, para a tela mostrar sem receber o certificado. */
export const certificateHint = (parsed: ParsedCertificate) => {
  const cn = parsed.subject.match(/CN=([^,]+)/)?.[1];
  return cn || parsed.subject.slice(0, 60);
};

// Gerador de BR Code (PIX Copia e Cola) para qualquer banco
// Padrão EMV QR Code do Banco Central do Brasil

function field(id, value) {
  const len = value.length.toString().padStart(2, "0");
  return id + len + value;
}

function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Gera o BR Code (string copia e cola) do PIX
 * @param {string} key - Chave PIX (CPF, email, telefone, aleatória)
 * @param {number|null} amount - Valor (opcional)
 * @param {string} merchantName - Nome do recebedor (max 25 chars)
 * @param {string} merchantCity - Cidade do recebedor (max 15 chars)
 * @param {string} txid - ID da transação (default ***)
 * @returns {string} BR Code string
 */
export function generateBRCode(key, amount = null, merchantName = "MERCADO FACIL", merchantCity = "SAO PAULO", txid = "***") {
  // Sanitiza
  const name = (merchantName || "MERCADO FACIL").substring(0, 25).toUpperCase().replace(/[^A-Z0-9 ]/g, "");
  const city = (merchantCity || "SAO PAULO").substring(0, 15).toUpperCase().replace(/[^A-Z0-9 ]/g, "");

  // Merchant Account Information (PIX)
  const gui = field("00", "br.gov.bcb.pix");
  const keyField = field("01", key);
  const merchantAccount = field("26", gui + keyField);

  const mcc = field("52", "0000");
  const currency = field("53", "986");
  const amountField = amount && amount > 0 ? field("54", amount.toFixed(2)) : "";
  const country = field("58", "BR");
  const nameField = field("59", name);
  const cityField = field("60", city);
  const additional = field("62", field("05", txid));

  const payload = "000201" + merchantAccount + mcc + currency + amountField + country + nameField + cityField + additional + "6304";

  const crc = crc16(payload);
  return payload + crc;
}

/**
 * Gera URL de imagem QR Code a partir de um BR Code
 * Usa api.qrserver.com (gratuito, não requer instalação de pacote)
 */
export function getQrCodeUrl(brCode, size = 300) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(brCode)}`;
}
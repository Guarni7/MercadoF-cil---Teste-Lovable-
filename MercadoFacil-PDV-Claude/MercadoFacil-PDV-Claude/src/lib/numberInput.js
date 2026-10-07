// Campos numéricos digitados (type="number"): o navegador devolve o texto como está, então
// "0" + digitar 1 vira "01". Tira os zeros à esquerda da parte inteira e mantém o resto:
// "01" → "1", "007" → "7", "0" → "0", "0.5" → "0.5", "" → "", "-01" → "-1".
export function semZerosAEsquerda(valor) {
  return String(valor ?? "").replace(/^(-?)0+(?=\d)/, "$1");
}

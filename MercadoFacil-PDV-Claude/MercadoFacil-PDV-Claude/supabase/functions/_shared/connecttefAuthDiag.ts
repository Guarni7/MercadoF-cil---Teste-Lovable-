// Diagnóstico SEGURO de um 401 no connecttef-webhook.
//
// O log da plataforma não registra o cabeçalho Authorization, e a função só respondia 401, sem
// distinguir cabeçalho ausente, formato errado e token diferente. Isto devolve só fatos que NÃO
// revelam o token nem o secret: booleanos, tamanhos e o nome do esquema (de uma lista fixa).
// Nunca devolve, nem de leve, o valor do cabeçalho ou do secret.
//
// Não participa da decisão de autenticar: quem decide continua sendo o código do webhook.

/** Esquemas que podem aparecer no log pelo nome. Qualquer outra palavra vira "outro" (podia ser parte de um token). */
const ESQUEMAS_CONHECIDOS = ["bearer", "basic", "token", "apikey", "api-key"];

export type DiagnosticoAutorizacao = {
  /** O cabeçalho Authorization chegou (não vazio)? */
  presente: boolean;
  /** "ausente" | "sem-esquema" (uma palavra só, sem espaço) | nome conhecido | "outro". */
  esquema: string;
  tamanhoRecebido: number;
  tamanhoEsperado: number;
  tamanhosIguais: boolean;
  /** Espaço, quebra de linha ou tab DENTRO do valor recebido. */
  comEspacoInterno: boolean;
  /** O valor recebido vem entre aspas. */
  comAspasNasPontas: boolean;
  /** O valor (depois do esquema) bate com o secret? Com esquema bearer, é exatamente o que autentica. */
  valorBate: boolean;
  /** O cabeçalho INTEIRO, sem esquema nenhum, bate com o secret? true = o portal mandou o token puro, sem "Bearer". */
  cabecalhoInteiroBate: boolean;
  /** O valor bate com o secret depois de tirar aspas das pontas? true = há aspas sobrando num dos lados. */
  valorSemAspasBate: boolean;
};

type Igual = (recebido: string, esperado: string) => Promise<boolean>;

const tiraAspas = (v: string) => v.replace(/^(["'])([\s\S]*)\1$/, "$2");

/** `igual` é a MESMA comparação usada na autenticação (tempo constante); aqui só serve de oráculo booleano. */
export async function diagnosticarAutorizacao(
  authorization: string | null | undefined,
  esperado: string,
  igual: Igual,
): Promise<DiagnosticoAutorizacao> {
  const bruto = (authorization ?? "").trim();
  const presente = bruto !== "";
  const partes = bruto.match(/^(\S+)\s+([\s\S]*)$/);
  const palavra = partes ? partes[1].toLowerCase() : null;
  const esquema = !presente ? "ausente" : !partes ? "sem-esquema" : ESQUEMAS_CONHECIDOS.includes(palavra!) ? palavra! : "outro";
  const valor = partes ? partes[2].trim() : bruto;
  return {
    presente,
    esquema,
    tamanhoRecebido: valor.length,
    tamanhoEsperado: esperado.length,
    tamanhosIguais: valor.length === esperado.length,
    comEspacoInterno: /\s/.test(valor),
    comAspasNasPontas: /^(["'])[\s\S]*\1$/.test(valor) && valor.length >= 2,
    valorBate: presente && (await igual(valor, esperado)),
    cabecalhoInteiroBate: presente && (await igual(bruto, esperado)),
    valorSemAspasBate: presente && (await igual(tiraAspas(valor), esperado)),
  };
}

/** Só os NOMES dos cabeçalhos recebidos (nunca os valores): mostra se o token veio em outro cabeçalho. */
export function nomesDosCabecalhos(headers: Headers): string[] {
  const nomes: string[] = [];
  for (const nome of headers.keys()) {
    if (/^[a-z0-9-]{1,40}$/.test(nome)) nomes.push(nome);
    if (nomes.length >= 30) break;
  }
  return nomes.sort();
}

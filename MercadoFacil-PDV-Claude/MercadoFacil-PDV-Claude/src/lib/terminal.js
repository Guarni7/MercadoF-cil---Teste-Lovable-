/**
 * Identificação única do terminal (CAIXA-01, CAIXA-02, GERENCIA...).
 * Gerado uma vez e persistido em localStorage (não é dado operacional).
 * Cada instalação/terminal possui seu próprio ID para rastreabilidade.
 */

const TERMINAL_KEY = "mf_terminal_id";
const TERMINAL_NAME_KEY = "mf_terminal_name";

function generateId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TERM-${ts}${rand}`;
}

export function getTerminalId() {
  let id = localStorage.getItem(TERMINAL_KEY);
  if (!id) {
    id = generateId();
    localStorage.setItem(TERMINAL_KEY, id);
  }
  return id;
}

export function getTerminalName() {
  let name = localStorage.getItem(TERMINAL_NAME_KEY);
  if (!name) {
    name = "CAIXA-01";
    localStorage.setItem(TERMINAL_NAME_KEY, name);
  }
  return name;
}

export function setTerminalName(name) {
  localStorage.setItem(TERMINAL_NAME_KEY, name);
}

export function getTerminalInfo() {
  return {
    id: getTerminalId(),
    name: getTerminalName(),
  };
}
// Scale reading service — supports Serial (RS232), USB, and Network (HTTP) connections.
// Uses Web Serial API and WebUSB API (Chrome/Edge only) when running in a
// plain browser. Dentro do Electron, a porta COM nunca é acessada direto do
// navegador — vai pelo bridge IPC (electron/main.cjs, via serialport no
// processo main), o mesmo padrão já usado por mf:update:*.
import { electronWindow } from "@/lib/electronWindow";

/** @typedef {Navigator & { serial?: any, usb?: any }} ScaleNavigator */
/** @type {ScaleNavigator} */
const scaleNavigator = /** @type {any} */ (navigator);

const hasElectronScale = () => !!electronWindow().electronAPI?.scale;

export const getScaleConfig = () => {
  try {
    return JSON.parse(localStorage.getItem("scale_config") || "{}");
  } catch {
    return {};
  }
};

// Parse weight from raw scale data string.
// Most Brazilian scales (Toledo, Urano) send formats like:
//   "ST,GS,+0.123 kg\r\n"  or  "=     0.123 kg"  or  "P 0.123 kg"
export const parseWeight = (raw) => {
  if (!raw) return null;
  const match = raw.match(/(-?\d+[\.,]?\d*)\s*(kg|g)?/i);
  if (!match) return null;
  let value = parseFloat(match[1].replace(",", "."));
  const unit = (match[2] || "").toLowerCase();
  // Convert grams to kilograms
  if (unit === "g" && value < 1000) value = value / 1000;
  if (isNaN(value) || value <= 0) return null;
  return value;
};

// --- Electron (porta COM real via serialport no processo main) ---

/** @param {{comport:string, baudrate?:string|number, dataBits?:string|number, parity?:string, stopBits?:string|number}} config */
export const connectElectronScale = async (config) => {
  const scale = electronWindow().electronAPI?.scale;
  if (!scale) throw new Error("Bridge da balança não disponível (fora do app desktop).");
  return scale.connect(config);
};

export const disconnectElectronScale = async () => {
  const scale = electronWindow().electronAPI?.scale;
  if (!scale) return;
  await scale.disconnect();
};

/** Assina mudanças de status (connected/disconnected/error) — retorna função de cancelamento. */
export const onElectronScaleStatus = (handler) => {
  const scale = electronWindow().electronAPI?.scale;
  if (!scale) return () => {};
  return scale.onStatusChange(handler);
};

const readElectronScale = async (config) => {
  const scale = electronWindow().electronAPI?.scale;
  if (!scale) throw new Error("Bridge da balança não disponível (fora do app desktop).");
  if (!config.comport) throw new Error("Porta COM não configurada.");
  // Reabre a porta a cada leitura — mesmo comportamento do caminho Web Serial
  // abaixo (abre/lê/fecha por chamada); evita ficar com estado de conexão
  // dessincronizado entre o main process e a UI.
  await scale.connect(config);
  // decimalPlaces=3 é o padrão da Toledo Prix 8217 (protocolo P05A); balanças
  // não-Toledo configuradas por aqui também usam esse mesmo formato de frame.
  const result = await scale.readWeight({ decimalPlaces: 3 });
  if (result.status !== "stable" || !result.weight) {
    throw new Error("Não foi possível ler o peso da balança.");
  }
  return result.weight;
};

// Connect and read weight from a serial scale via Web Serial API
export const readSerialScale = async (config) => {
  // Dentro do Electron, nunca tenta Web Serial direto — vai pelo bridge IPC
  // (electron/main.cjs), que fala com a porta COM de verdade via serialport.
  if (hasElectronScale()) return readElectronScale(config);

  if (!scaleNavigator.serial) {
    throw new Error("Web Serial API não suportada neste navegador. Use Chrome ou Edge.");
  }
  const port = await scaleNavigator.serial.requestPort();
  await port.open({ baudRate: parseInt(config.baudrate || "9600") });

  const decoder = new TextDecoderStream();
  const readableStreamClosed = port.readable.pipeTo(decoder.writable);
  const reader = decoder.readable.getReader();

  let buffer = "";
  let weight = null;

  try {
    // Read until we get a complete line with weight
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Tempo esgotado lendo balança.")), 5000)
    );
    const readLoop = async () => {
      while (!weight) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        // Try to parse from complete lines
        const lines = buffer.split(/[\r\n]+/);
        for (const line of lines) {
          const w = parseWeight(line);
          if (w) {
            weight = w;
            break;
          }
        }
      }
    };
    await Promise.race([readLoop(), timeout]);
  } finally {
    try {
      reader.releaseLock();
      await readableStreamClosed.catch(() => {});
      await port.close();
    } catch {}
  }

  if (!weight) throw new Error("Não foi possível ler o peso da balança.");
  return weight;
};

// Connect and read weight from a USB scale via WebUSB API
export const readUsbScale = async () => {
  if (!scaleNavigator.usb) {
    throw new Error("WebUSB API não suportada neste navegador. Use Chrome ou Edge.");
  }
  const device = await scaleNavigator.usb.requestDevice({
    filters: [{ classCode: 3 }], // HID class
  });
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  await device.claimInterface(0);

  // USB HID scale protocol (simplified — common for HID scales)
  const endpointNumber = 1;
  const data = await device.transferIn(endpointNumber, 64);
  const bytes = new Uint8Array(data.data.buffer);

  // Common HID scale report: byte[1] = report ID, bytes[4-5] = weight (grams), byte[3] = unit
  let weightGrams = 0;
  if (bytes.length >= 6) {
    weightGrams = (bytes[4] << 8) | bytes[5];
    // Handle scaling flag
    const scaling = bytes[3];
    if (scaling === 1) weightGrams = weightGrams * 10;
    else if (scaling === 2) weightGrams = weightGrams * 100;
    else if (scaling === 3) weightGrams = weightGrams * 1000;
  }

  try {
    await device.close();
  } catch {}

  const weightKg = weightGrams / 1000;
  if (!weightKg || weightKg <= 0) throw new Error("Não foi possível ler o peso da balança.");
  return weightKg;
};

// Read weight from a network scale via HTTP (for scales with HTTP/REST endpoint)
export const readNetworkScale = async (config) => {
  if (!config.ip) throw new Error("Endereço IP da balança não configurado.");
  const url = `http://${config.ip}:${config.port || "5000"}/weight`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Balança respondeu ${res.status}`);
    const data = await res.json();
    const weight = typeof data === "number" ? data : data.weight || data.value;
    if (!weight || weight <= 0) throw new Error("Resposta inválida da balança.");
    // Assume kg if value < 100, otherwise grams
    return weight < 1000 ? weight : weight / 1000;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Tempo esgotado conectando à balança.");
    throw new Error(`Erro de rede: ${e.message}`);
  } finally {
    clearTimeout(timeout);
  }
};

// Main entry point — reads weight based on configured connection type
export const readWeight = async () => {
  const config = getScaleConfig();
  if (!config.brand && !config.connection) {
    throw new Error("Balança não configurada. Vá em Configurações → Balança.");
  }
  switch (config.connection) {
    case "serial":
      return readSerialScale(config);
    case "usb":
      return readUsbScale();
    case "network":
      return readNetworkScale(config);
    default:
      throw new Error("Tipo de conexão não configurado.");
  }
};

export const isScaleSupported = () => {
  const config = getScaleConfig();
  if (config.connection === "network") return true;
  if (config.connection === "serial") return hasElectronScale() || !!scaleNavigator.serial;
  if (config.connection === "usb") return !!scaleNavigator.usb;
  return false;
};
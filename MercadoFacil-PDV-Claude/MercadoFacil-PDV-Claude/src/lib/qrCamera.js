// Leitura de QR pela câmera usando o BarcodeDetector nativo do navegador/Electron (Chromium) — sem biblioteca nem
// serviço externo. Onde o navegador não oferece o formato `qr_code` (comum no Windows), a câmera fica indisponível e
// o caixa usa o leitor USB (que digita o código) ou a digitação manual.

/** @returns {Promise<boolean>} a câmera pode ler QR neste navegador/aparelho? */
export async function cameraQrDisponivel(env = globalThis) {
  try {
    if (!env?.navigator?.mediaDevices?.getUserMedia || typeof env.BarcodeDetector !== "function") return false;
    const formatos = await env.BarcodeDetector.getSupportedFormats?.();
    return Array.isArray(formatos) && formatos.includes("qr_code");
  } catch {
    return false;
  }
}

/**
 * Liga a câmera traseira/padrão no <video> e chama `onCodigo(texto)` a cada QR lido (o chamador decide quando parar).
 * @param {HTMLVideoElement} video  @param {(texto: string) => void} onCodigo  @param {(erro: Error) => void} [onErro]
 * @returns {() => void} função que desliga a câmera
 */
export function iniciarLeituraCamera(video, onCodigo, onErro) {
  let parado = false;
  let stream = null;
  let timer = null;
  (async () => {
    try {
      const detector = new globalThis.BarcodeDetector({ formats: ["qr_code"] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      if (parado) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await video.play();
      let ultimo = "";
      const ler = async () => {
        if (parado) return;
        try {
          const achados = await detector.detect(video);
          const texto = achados?.[0]?.rawValue;
          if (texto && texto !== ultimo) {
            ultimo = texto;
            onCodigo(texto);
          }
        } catch {
          /* quadro sem imagem ainda */
        }
        timer = setTimeout(ler, 250);
      };
      ler();
    } catch (e) {
      onErro?.(e);
    }
  })();
  return () => {
    parado = true;
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
    if (video) video.srcObject = null;
  };
}

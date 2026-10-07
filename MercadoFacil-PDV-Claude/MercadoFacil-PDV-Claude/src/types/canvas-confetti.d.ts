// canvas-confetti não traz tipos. Este arquivo (mapeado em jsconfig.json) evita que o typecheck percorra o código-fonte JS dele.
type Disparador = (opcoes?: Record<string, unknown>) => Promise<null> | null;
declare const confetti: Disparador & { create: (canvas: HTMLCanvasElement, opcoes?: { resize?: boolean; useWorker?: boolean }) => Disparador };
export default confetti;

// Typed accessor for window.electronAPI, injected by the Electron preload
// script (only present when running inside the packaged desktop app).

/**
 * @typedef {{
 *   isElectron?: boolean,
 *   listPrinters?: () => Promise<Array<{ name: string, displayName?: string, isDefault?: boolean }>>,
 *   printHtml?: (opts: { html: string, deviceName?: string, silent?: boolean }) => Promise<{ ok: boolean, error?: string }>,
 *   update?: {
 *     status: () => Promise<{ status: string, info?: string|null, error?: string, percent?: number, transferred?: number, total?: number, bytesPerSecond?: number }>,
 *     installNow: () => Promise<boolean>,
 *     checkNow: () => Promise<boolean>,
 *     onChange: (handler: (payload: { status: string, [key: string]: any }) => void) => () => void,
 *   },
 *   closeFlow?: {
 *     onRequest: (handler: (payload: { updateReady: boolean, version: string|null }) => void) => () => void,
 *     ack: () => Promise<void>,
 *     confirm: () => Promise<void>,
 *     cancel: () => Promise<void>,
 *   },
 *   backup?: {
 *     write: (payload: object) => Promise<{ ok: boolean, fileName?: string, at?: string, error?: string }>,
 *     list: () => Promise<Array<{ fileName: string, size: number, mtime: string }>>,
 *   },
 *   scale?: {
 *     listPorts: () => Promise<Array<{ path: string, manufacturer: string|null }>>,
 *     connect: (config: object) => Promise<{ ok: boolean, comport: string }>,
 *     disconnect: () => Promise<boolean>,
 *     readWeight: (options?: { decimalPlaces?: number }) => Promise<{ status: string, weight: number|null, raw: string }>,
 *     onStatusChange: (handler: (payload: { status: string, [key: string]: any }) => void) => () => void,
 *   },
 * }} ElectronBridge
 */

/** @returns {Window & typeof globalThis & { electronAPI?: ElectronBridge }} */
export const electronWindow = () => /** @type {any} */ (window);

/**
 * Cliente de dados/auth — Supabase (sem SDK Base44).
 */
import {
  entities,
  authMe,
  loginEmailPassword,
  registerEmailPassword,
  loginWithGoogle,
  logoutAuth,
  resetPasswordRequest,
  updatePassword,
  invokeFunction,
  getPublicSettings,
  getMercadoPagoWebhookUrl,
  applyStockMovement,
  applyCashMovement,
} from "@/api/supabaseData";
import { supabase } from "@/lib/supabase";
import { extractDataFromUploadedFile } from "@/lib/extractUploadedFile";

// Único ponto de entrada de upload do app (fotos de produto, logo, importação
// de XML/CSV/XLSX) — mesmo bucket público para todos. Allowlist deliberadamente
// sem html/svg/js/executável: espelha storage.buckets.allowed_mime_types
// (migration 038); qualquer extensão fora daqui é recusada antes mesmo de
// chamar o Storage.
const UPLOAD_MIME_BY_EXT = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  csv: "text/csv",
  txt: "text/plain",
  xml: "text/xml",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const api = {
  entities,
  auth: {
    me: authMe,
    loginViaEmailPassword: loginEmailPassword,
    registerViaEmailPassword: registerEmailPassword,
    /** @param {{ email: string, password: string, full_name?: string }} params */
    register: async ({ email, password, full_name }) =>
      registerEmailPassword(email, password, full_name),
    resetPasswordRequest,
    updatePassword,
    loginWithProvider: async (provider, returnTo = "/") => {
      if (provider === "google") return loginWithGoogle(returnTo);
      throw new Error(`Provider não suportado: ${provider}`);
    },
    logout: async (redirectHref) =>
      logoutAuth(redirectHref || `${window.location.origin}/login`),
    redirectToLogin: (returnTo) => {
      const q = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
      window.location.assign(`${window.location.origin}/login${q}`);
    },
    isAuthenticated: async () => {
      const { data } = await supabase.auth.getSession();
      return !!data?.session;
    },
  },
  functions: {
    invoke: invokeFunction,
  },
  stock: {
    applyMovement: applyStockMovement,
  },
  cash: {
    applyMovement: applyCashMovement,
  },
  users: {
    inviteUser: async (email, role, extras = {}) => {
      const res = await invokeFunction("inviteUser", {
        email,
        role,
        password: extras.password,
        full_name: extras.full_name || extras.name,
      });
      const data = res?.data || res;
      if (data?.error) throw new Error(data.error);
      return data;
    },
  },
  app: {
    getPublicSettings,
  },
  files: {
    upload: async ({ file }) => {
      const ext = (file?.name?.split(".").pop() || "").toLowerCase();
      // Allowlist real (server-side em storage.buckets.allowed_mime_types,
      // migration 038) — isto aqui é só a primeira barreira, com mensagem
      // clara em vez do erro cru do Storage. Nunca confia em file.type
      // (o navegador só "adivinha" e é facilmente forjável); o content-type
      // enviado é sempre o mapeado por extensão validada, não o do browser.
      const contentType = UPLOAD_MIME_BY_EXT[ext];
      if (!contentType) {
        throw new Error(
          `Tipo de arquivo ".${ext || "?"}" não permitido. Aceitos: imagem (png/jpg/webp/gif), XML, CSV/TXT, XLS/XLSX.`
        );
      }
      // A empresa é a primeira pasta: as policies do bucket usam esse trecho
      // para impedir que um tenant escreva no diretório de outro.
      const me = await authMe();
      if (!me?.company_id) {
        throw new Error("Usuário sem empresa vinculada — não é possível enviar arquivos.");
      }
      const path = `${me.company_id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("public").upload(path, file, { contentType });
      if (error) throw error;
      const { data } = supabase.storage.from("public").getPublicUrl(path);
      return { file_url: data.publicUrl };
    },
    extract: extractDataFromUploadedFile,
  },
};

export { supabase, getMercadoPagoWebhookUrl };

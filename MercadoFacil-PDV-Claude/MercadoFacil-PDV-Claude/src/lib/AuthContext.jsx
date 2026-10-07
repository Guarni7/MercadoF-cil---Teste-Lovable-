import React, { createContext, useState, useContext, useEffect, useRef } from "react";
import { api } from "@/api/dataClient";
import { supabase } from "@/lib/supabase";
import { isOfflineError } from "@/api/supabaseData";
import { cacheAuth, getCachedAuth, isOfflineAuthAvailable, clearCachedAuth } from "@/lib/offlineAuth";
import {
  getDemoUser,
  isDemoSession,
  endDemoSession,
  seedDemoCatalog,
} from "@/lib/demoAccount";

const AuthContext = createContext(undefined);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings, setAppPublicSettings] = useState(null);
  // Espelha authChecked, mas em ref: o listener do onAuthStateChange abaixo é
  // registrado uma única vez (useEffect com deps []), então o `checkUserAuth`
  // que ele enxerga fica preso ao closure do primeiro render — lendo o
  // state `authChecked` ali sempre veria `false`. Ref não tem esse problema.
  const authCheckedRef = useRef(false);

  useEffect(() => {
    checkAppState();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
        setIsAuthenticated(false);
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        if (isDemoSession()) return;
        try {
          await checkUserAuth();
        } catch {
          /* ignore */
        }
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const activateDemoUser = async () => {
    const demoUser = getDemoUser();
    await seedDemoCatalog();
    await cacheAuth(demoUser);
    setUser(demoUser);
    setIsAuthenticated(true);
    setIsLoadingAuth(false);
    setAuthChecked(true);
    setAuthError(null);
  };

  const checkAppState = async () => {
    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);

      if (isDemoSession()) {
        try {
          const publicSettings = await api.app.getPublicSettings();
          setAppPublicSettings(publicSettings);
        } catch {
          /* demo funciona sem settings */
        }
        setIsLoadingPublicSettings(false);
        await activateDemoUser();
        return;
      }

      try {
        const publicSettings = await api.app.getPublicSettings();
        setAppPublicSettings(publicSettings);
      } catch {
        setAppPublicSettings({
          id: "mercadofacil-supabase",
          public_settings: { app_name: "MercadoFácil PDV" },
        });
      }
      setIsLoadingPublicSettings(false);

      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        await checkUserAuth();
      } else if (!navigator.onLine) {
        const cachedUser = await getCachedAuth();
        if (cachedUser && (await isOfflineAuthAvailable())) {
          setUser(cachedUser);
          setIsAuthenticated(true);
          setIsLoadingAuth(false);
          setAuthChecked(true);
          return;
        }
        setIsLoadingAuth(false);
        setIsAuthenticated(false);
        setAuthChecked(true);
      } else {
        setIsLoadingAuth(false);
        setIsAuthenticated(false);
        setAuthChecked(true);
      }
    } catch (error) {
      console.error("Unexpected error:", error);

      if (!navigator.onLine) {
        const cachedUser = await getCachedAuth();
        if (cachedUser && (await isOfflineAuthAvailable())) {
          setUser(cachedUser);
          setIsAuthenticated(true);
          setIsLoadingAuth(false);
          setIsLoadingPublicSettings(false);
          setAuthChecked(true);
          return;
        }
      }

      setAuthError({
        type: "unknown",
        message: error.message || "An unexpected error occurred",
      });
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  };

  const checkUserAuth = async () => {
    // O cliente Supabase dispara TOKEN_REFRESHED sozinho quando a aba volta a
    // ficar visível (revalidação em segundo plano) — isso chama checkUserAuth
    // de novo. Sem essa checagem, setIsLoadingAuth(true) fazia ProtectedRoute
    // (isLoadingAuth || !authChecked) desmontar a rota inteira por um
    // instante — Configuracoes.jsx perdia o estado local (floatPanel) e a
    // tela "resetava" ao trocar de aba. Só a primeira verificação real
    // precisa bloquear a tela.
    const isBackgroundRefresh = authCheckedRef.current;
    try {
      if (!isBackgroundRefresh) setIsLoadingAuth(true);
      const currentUser = await api.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      authCheckedRef.current = true;
      setAuthError(null);
      await cacheAuth(currentUser);
    } catch (error) {
      console.error("User auth check failed:", error);

      // Internet caiu com sessão válida guardada: segue com o último usuário
      // conhecido, senão o caixa perderia o app a cada recarga sem rede.
      if (isOfflineError(error)) {
        const cachedUser = await getCachedAuth();
        if (cachedUser && (await isOfflineAuthAvailable())) {
          setUser(cachedUser);
          setIsAuthenticated(true);
          setIsLoadingAuth(false);
          setAuthChecked(true);
          authCheckedRef.current = true;
          setAuthError(null);
          return;
        }
      }

      const isConfirmedAuthFailure = error.status === 401 || error.status === 403;

      // Revalidação em segundo plano (aba voltou a ficar visível) que falhou
      // sem confirmar sessão inválida — ex.: query de perfil/empresa deu
      // timeout — não pode derrubar quem já estava logado: isso jogava o
      // usuário pra tela de não-autenticado no meio do trabalho, mesmo com a
      // sessão do Supabase ainda válida. Só uma falha 401/403 confirmada
      // desloga de verdade.
      if (isBackgroundRefresh && !isConfirmedAuthFailure) {
        setIsLoadingAuth(false);
        setAuthChecked(true);
        return;
      }

      setIsLoadingAuth(false);
      setIsAuthenticated(false);
      setAuthChecked(true);
      authCheckedRef.current = true;

      if (isConfirmedAuthFailure) {
        // Descarta o token inválido para não travar o usuário fora do /login.
        if (navigator.onLine) {
          await supabase.auth.signOut().catch(() => {});
        }
        setAuthError({
          type: "auth_required",
          message: "Authentication required",
        });
      }
    }
  };

  const logout = (shouldRedirect = true) => {
    const wasDemo = isDemoSession();
    setUser(null);
    setIsAuthenticated(false);
    clearCachedAuth().catch(() => {});
    endDemoSession().catch(() => {});

    if (wasDemo) {
      if (shouldRedirect) window.location.href = "/login";
      return;
    }

    if (shouldRedirect) {
      api.auth.logout(`${window.location.origin}/login`);
    } else {
      api.auth.logout();
    }
  };

  const navigateToLogin = () => {
    api.auth.redirectToLogin(window.location.href);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings,
        authError,
        appPublicSettings,
        authChecked,
        logout,
        navigateToLogin,
        checkUserAuth,
        checkAppState,
        activateDemoUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

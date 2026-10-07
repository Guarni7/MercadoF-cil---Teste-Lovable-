import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Smartphone, Monitor, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

const STORAGE_KEY = "mf_device_name";

function getDeviceInfo() {
  const ua = navigator.userAgent;
  let browser = "Navegador";
  let os = "Sistema";

  if (ua.includes("Edg")) browser = "Edge";
  else if (ua.includes("Chrome")) browser = "Chrome";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Safari")) browser = "Safari";

  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac")) os = "macOS";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("Android")) os = "Android";
  else if (/iPhone|iPad/.test(ua)) os = "iOS";

  return { label: `${browser} no ${os}`, isMobile: /Android|iPhone|iPad/.test(ua) };
}

function formatNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export default function DeviceTab({ currentUser }) {
  const navigate = useNavigate();
  const [device, setDevice] = useState(null);
  const [customName, setCustomName] = useState("");
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  useEffect(() => {
    setDevice(getDeviceInfo());
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setCustomName(saved);
  }, []);

  if (!device) return null;

  const Icon = device.isMobile ? Smartphone : Monitor;
  const userName = currentUser?.full_name || currentUser?.email || "Usuário";
  const isAdmin = currentUser?.role === "admin";
  const displayName = customName || device.label;

  const handleSaveName = () => {
    const name = editValue.trim();
    if (!name) {
      toast.error("Informe um nome.");
      return;
    }
    localStorage.setItem(STORAGE_KEY, name);
    setCustomName(name);
    setEditing(false);
    toast.success("Dispositivo renomeado!");
  };

  const openEdit = () => {
    setEditValue(displayName);
    setEditing(true);
  };

  return (
    <>
      <div className="space-y-3">
        {/* Header block */}
        <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/60">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Smartphone className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-sm text-foreground">Dispositivos Conectados</h3>
            <p className="text-xs text-muted-foreground">1 de ∞ dispositivos</p>
          </div>
          <span className="px-3 py-1 rounded-full bg-muted text-xs font-medium text-muted-foreground">
            Grátis
          </span>
        </div>

        {/* Device card */}
        <div className="p-4 rounded-xl border border-primary/20 bg-primary/[0.03]">
          <div className="flex items-start gap-3">
            <div className="relative shrink-0">
              <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center">
                <Icon className="w-6 h-6 text-primary" />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-card" />
            </div>
            <div className="flex-1 min-w-0">
              {editing ? (
                <Input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveName();
                    if (e.key === "Escape") setEditing(false);
                  }}
                  autoFocus
                  className="h-8 max-w-[220px] border-primary text-sm font-semibold"
                />
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-foreground">{displayName}</span>
                  <span className="px-2 py-0.5 rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                    Este
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-green-100 text-[10px] font-medium text-green-700">
                    Online
                  </span>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {userName} • 1min atrás
              </p>
            </div>
            {editing ? (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleSaveName}
                  className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center"
                  title="Salvar"
                >
                  <Check className="w-4 h-4 text-primary-foreground" />
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground"
                  title="Cancelar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={openEdit}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors shrink-0"
                title="Editar nome"
              >
                <Pencil className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>
          <div className="mt-3 pt-3 border-t border-primary/10 text-xs text-muted-foreground">
            Última sessão: {formatNow()} • Conectado desde: {formatToday()}
          </div>
        </div>

        {/* Upsell block - hidden for admins */}
        {!isAdmin && (
          <button
            onClick={() => navigate("/plano")}
            className="w-full text-left p-4 rounded-xl border border-blue-200 bg-blue-50/30 hover:bg-blue-50/60 transition-colors"
          >
            <p className="text-sm text-foreground">
              Faça upgrade para <span className="font-bold text-blue-700">Pro</span> ou{" "}
              <span className="font-bold text-blue-700">Premium</span> para conectar mais dispositivos.
            </p>
          </button>
        )}
      </div>

    </>
  );
}
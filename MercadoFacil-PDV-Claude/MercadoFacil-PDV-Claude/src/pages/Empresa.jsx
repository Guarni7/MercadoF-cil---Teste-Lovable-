import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/api/dataClient";
import { useAuth } from "@/lib/AuthContext";
import { toast } from "sonner";

const empty = {
  trade_name: "",
  legal_name: "",
  document: "",
  phone: "",
  email: "",
  cep: "",
  address: "",
  address_number: "",
  neighborhood: "",
  city: "",
  state: "",
};

export default function Empresa() {
  const { user, checkUserAuth } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const local = localStorage.getItem("company_data");
        if (local) {
          const parsed = JSON.parse(local);
          setForm((f) => ({
            ...f,
            trade_name: parsed.trade_name || parsed.name || f.trade_name,
            legal_name: parsed.legal_name || parsed.razao || f.legal_name,
            document: parsed.document || parsed.cnpj || f.document,
            phone: parsed.phone || f.phone,
            email: parsed.email || user?.email || f.email,
            cep: parsed.cep || f.cep,
            address: parsed.address || f.address,
            address_number: parsed.address_number || f.address_number,
            neighborhood: parsed.neighborhood || f.neighborhood,
            city: parsed.city || f.city,
            state: parsed.state || f.state,
          }));
        }
        if (user?.company_id) {
          try {
            const c = await api.entities.Company.get(user.company_id);
            if (c) {
              setForm({
                trade_name: c.trade_name || "",
                legal_name: c.legal_name || "",
                document: c.document || "",
                phone: c.phone || "",
                email: c.email || "",
                cep: c.cep || "",
                address: c.address || "",
                address_number: c.address_number || "",
                neighborhood: c.neighborhood || "",
                city: c.city || "",
                state: c.state || "",
              });
            }
          } catch {}
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.company_id, user?.email]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.functions.invoke("registerCompany", form);
      const data = res.data || res;
      if (data.error) throw new Error(data.error);
      localStorage.setItem("company_data", JSON.stringify(form));
      await checkUserAuth?.();
      toast.success(data.message || "Empresa salva!");
      if (!user?.plan_status || user.plan_status === "none") {
        navigate("/selecionar-plano");
      } else {
        navigate("/");
      }
    } catch (e) {
      toast.error(e.message || "Erro ao salvar empresa.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-700" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-11 w-11 rounded-xl bg-emerald-50 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-emerald-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Dados da empresa</h1>
            <p className="text-sm text-slate-500">
              Formalize sua loja para ativar o PDV. Status inicial: pendente até trial/ativação.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Nome fantasia *</Label>
            <Input value={form.trade_name} onChange={(e) => set("trade_name", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>Razão social</Label>
            <Input value={form.legal_name} onChange={(e) => set("legal_name", e.target.value)} />
          </div>
          <div>
            <Label>CNPJ / CPF *</Label>
            <Input value={form.document} onChange={(e) => set("document", e.target.value)} />
          </div>
          <div>
            <Label>Telefone</Label>
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>E-mail</Label>
            <Input value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div>
            <Label>CEP</Label>
            <Input value={form.cep} onChange={(e) => set("cep", e.target.value)} />
          </div>
          <div>
            <Label>UF</Label>
            <Input value={form.state} onChange={(e) => set("state", e.target.value)} maxLength={2} />
          </div>
          <div className="sm:col-span-2">
            <Label>Logradouro</Label>
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
          </div>
          <div>
            <Label>Número</Label>
            <Input value={form.address_number} onChange={(e) => set("address_number", e.target.value)} />
          </div>
          <div>
            <Label>Bairro</Label>
            <Input value={form.neighborhood} onChange={(e) => set("neighborhood", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>Cidade</Label>
            <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
          </div>
        </div>

        <Button
          onClick={handleSave}
          disabled={saving}
          className="mt-6 w-full bg-emerald-700 hover:bg-emerald-800 gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar e continuar
        </Button>
      </div>
    </div>
  );
}

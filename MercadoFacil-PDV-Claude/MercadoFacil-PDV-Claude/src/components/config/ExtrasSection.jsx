import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Wallet, Briefcase, Package, Database,
} from "lucide-react";
import BackButton from "./BackButton";
import { api } from "@/api/dataClient";
import { carregarConfigEstoque, salvarConfigEstoque } from "@/lib/stockConfig";
import { toast } from "sonner";

const ADMINS = ["owner", "admin", "platform_admin"];

const FONT_SIZES = [
  { value: "100", label: "Padrão (100%)" },
  { value: "110", label: "Grande (110%)" },
  { value: "125", label: "Maior (125%)" },
  { value: "150", label: "Máximo (150%)" },
];

function SettingRow({ title, desc, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b last:border-0">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-slate-800">{title}</p>
        <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title }) {
  return (
    <div className="flex items-center gap-2 pt-4 pb-2">
      <Icon className="w-4 h-4 text-slate-600" />
      <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">{title}</h3>
    </div>
  );
}

export default function ExtrasSection({ onBack }) {
  const [cfg, setCfg] = useState(/** @type {Record<string, any>} */ ({}));
  const [isAdmin, setIsAdmin] = useState(false);
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  const [savingStock, setSavingStock] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("sales_extras_config");
      if (saved) setCfg(JSON.parse(saved));
    } catch {}

    api.auth.me()
      .then((u) => setIsAdmin(ADMINS.includes(String(u?.company_role || u?.role))))
      .catch(() => setIsAdmin(false));

    carregarConfigEstoque()
      .then((c) => setAllowNegativeStock(!!c?.allow_negative_stock))
      .catch(() => {});
  }, []);

  async function updateAllowNegativeStock(value) {
    setSavingStock(true);
    try {
      await salvarConfigEstoque(value);
      setAllowNegativeStock(value);
      toast.success(value ? "Estoque negativo permitido." : "Estoque negativo bloqueado.");
    } catch (e) {
      console.error("Erro ao salvar config de estoque:", e);
      toast.error(e.message || "Não foi possível salvar. Só admin/owner altera isto.");
    } finally {
      setSavingStock(false);
    }
  }

  function update(field, value) {
    setCfg((prev) => {
      const next = { ...prev, [field]: value };
      localStorage.setItem("sales_extras_config", JSON.stringify(next));
      return next;
    });
  }

  const get = (k, d) => (cfg[k] !== undefined ? cfg[k] : d);

  return (
    <div className="space-y-4">
      <BackButton onBack={onBack} />
      <div className="bg-white rounded-xl border border-slate-200 px-5 py-3">
        {/* Caixa */}
        <SectionHeader icon={Wallet} title="Caixa" />
        <SettingRow title="Controlar Caixa" desc="Habilita abertura/fechamento de caixa, sangria e suprimento">
          <Switch checked={get("control_cash", true)} onCheckedChange={(v) => update("control_cash", v)} />
        </SettingRow>
        <SettingRow title="Justificativa Obrigatória" desc="Exigir justificativa para sangria e suprimento">
          <Switch checked={get("require_justification", false)} onCheckedChange={(v) => update("require_justification", v)} />
        </SettingRow>
        <SettingRow title="Fechamento Detalhado" desc="Informar valores por forma de pagamento no fechamento">
          <Switch checked={get("detailed_closing", true)} onCheckedChange={(v) => update("detailed_closing", v)} />
        </SettingRow>
        <SettingRow title="Cofre" desc="Controle de cofre separado do caixa">
          <Switch checked={get("safe_control", false)} onCheckedChange={(v) => update("safe_control", v)} />
        </SettingRow>
        <SettingRow title="Sugerir Sangria" desc="Quando as vendas do caixa atingirem esse valor (sem contar abertura), um botão flutuante sugerirá realizar sangria">
          <Input
            type="number"
            className="w-28 text-right"
            value={get("suggested_withdrawal", "")}
            onChange={(e) => update("suggested_withdrawal", parseFloat(e.target.value) || 0)}
            placeholder="Desativado"
          />
        </SettingRow>
        <SettingRow title="Unificar Caixas" desc="Todos os dispositivos compartilham o mesmo caixa (padrão: ativado)">
          <Switch checked={get("unified_cash", true)} onCheckedChange={(v) => update("unified_cash", v)} />
        </SettingRow>
        <SettingRow title="Informar Vendedor" desc="Solicitar vendedor ao finalizar vendas e por item nos condicionais">
          <Switch checked={get("require_seller", false)} onCheckedChange={(v) => update("require_seller", v)} />
        </SettingRow>
        <SettingRow title="Informar Cliente" desc="Exige cliente ao finalizar a venda (aceita cadastro incompleto; pode cadastrar na hora)">
          <Switch checked={get("require_customer", false)} onCheckedChange={(v) => update("require_customer", v)} />
        </SettingRow>

        {/* Comercial */}
        <SectionHeader icon={Briefcase} title="Comercial" />
        <SettingRow title="Delivery" desc="Módulo de entregas com painel de acompanhamento">
          <Switch checked={get("delivery", false)} onCheckedChange={(v) => update("delivery", v)} />
        </SettingRow>
        <SettingRow title="Limite p/ Cancelamento" desc="Tempo máximo (em minutos) para cancelar uma venda. 0 = sem limite">
          <Input
            type="number"
            className="w-20 text-right"
            value={get("cancel_limit", 0)}
            onChange={(e) => update("cancel_limit", parseInt(e.target.value) || 0)}
          />
        </SettingRow>

        {/* Estoque */}
        <SectionHeader icon={Package} title="Estoque" />
        <SettingRow
          title="Permitir Estoque Negativo"
          desc={
            isAdmin
              ? "Bloqueado por padrão. Ligando, vendas continuam mesmo com saldo zerado ou insuficiente."
              : "Bloqueado por padrão. Só admin/owner pode alterar."
          }
        >
          <Switch
            checked={allowNegativeStock}
            disabled={!isAdmin || savingStock}
            onCheckedChange={updateAllowNegativeStock}
          />
        </SettingRow>
        <SettingRow title="Controle Estoque na Venda" desc="Oculta produtos sem estoque na tela de vendas">
          <Switch checked={get("stock_control_sale", false)} onCheckedChange={(v) => update("stock_control_sale", v)} />
        </SettingRow>
        <SettingRow title="Enviar Inventário por Email" desc="Envia planilha Excel do inventário para o email da empresa ao finalizar">
          <Switch checked={get("email_inventory", false)} onCheckedChange={(v) => update("email_inventory", v)} />
        </SettingRow>
        <SettingRow title="Impressão Automática" desc="Imprimir comprovante automaticamente (config. deste dispositivo)">
          <Switch checked={get("auto_print", false)} onCheckedChange={(v) => update("auto_print", v)} />
        </SettingRow>
        <SettingRow title="Manter Tela Ligada" desc="Impede que o display desligue (config. deste dispositivo)">
          <Switch checked={get("keep_screen_on", false)} onCheckedChange={(v) => update("keep_screen_on", v)} />
        </SettingRow>
        <SettingRow title="Menu Inferior" desc="Exibir barra de navegação na parte inferior (config. deste dispositivo)">
          <Switch checked={get("bottom_menu", false)} onCheckedChange={(v) => update("bottom_menu", v)} />
        </SettingRow>
        <SettingRow title="Ajuste de tamanho/fonte" desc="Amplia a interface neste dispositivo, dentro da janela (sem scroll extra). A escolha fica salva no PC e permanece após reinstalar. Padrão = 100%.">
          <Select value={get("font_scale", "100")} onValueChange={(v) => update("font_scale", v)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_SIZES.map((f) => (
                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>

        {/* Backup / BD Offline */}
        <SectionHeader icon={Database} title="Backup / BD Offline" />
        <SettingRow title="Modo Offline (BD Local)" desc="Usa banco de dados local (IndexedDB) e sincroniza com a nuvem quando houver internet">
          <Switch checked={get("offline_mode", true)} onCheckedChange={(v) => update("offline_mode", v)} />
        </SettingRow>
        <SettingRow title="Backup Automático" desc="Gera backup dos dados automaticamente ao fechar o caixa">
          <Switch checked={get("auto_backup", false)} onCheckedChange={(v) => update("auto_backup", v)} />
        </SettingRow>
      </div>
    </div>
  );
}
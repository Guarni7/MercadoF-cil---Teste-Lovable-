import React, { useState, useEffect } from "react";
import { Settings, Printer, UtensilsCrossed, Tags, Layers, Apple, PackageCheck } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import PrintPointsDialog from "./PrintPointsDialog";

const STORAGE_KEY = "product_settings_config";

const CADASTRO_ITEMS = [
  { id: "obriga_qtd", label: "Obriga Quantidade", scope: "local", desc: "Exige preenchimento no estoque" },
  { id: "letra_codigo", label: "Permite Letra no Código", scope: "local", desc: "Teclado completo no campo código" },
  { id: "preencher_codigo", label: "Preencher Código", scope: "global", desc: "Preenche o código automaticamente no sequencial" },
  { id: "margem_contribuicao", label: "Margem de Contribuição", scope: "global", desc: 'Exibe campo "Margem %" além do Markup' },
  { id: "precos_alternativos", label: "Preços Alternativos", scope: "global", desc: "Habilita Preço 2 e 3 no cadastro e botões P / 2 / 3 no PDV" },
  { id: "cadastro_rapido_pdv", label: "Cadastro rápido pelo PDV", scope: "local", desc: "Ao bipar EAN desconhecido no PDV, solicita o preço e cadastra ao finalizar a venda" },
  { id: "busca_avancada", label: "Busca avançada", scope: "local", desc: "Consulta por nome ou EAN com sugestão fiscal para cadastro" },
  { id: "foto_item", label: "Foto do Item", scope: "global", desc: "Coluna de foto na listagem e botão no cadastro", default: true },
  { id: "tres_imagens", label: "3 imagens", scope: "global", desc: "Permite até 3 fotos por produto, com escolha da capa" },
  { id: "vale_presente", label: "Vale Presente", scope: "global", desc: "Exibe o toggle no cadastro do produto para emitir vales com código" },
  { id: "controle_validade", label: "Controle de Validade", scope: "global", desc: "Lotes e datas de validade por produto" },
];

const ESTOQUE_TOGGLES = [
  { id: "entrada_detalhada", label: "Entrada Detalhada Manual", scope: "global", desc: "Na setinha de estoque: fornecedor, custo da compra, número e série da nota (sem XML)." },
  { id: "notificar_negativo", label: "Notificar Negativo", scope: "global", desc: "Avisa na notificação quando o estoque estiver zerado ou negativo." },
];

const EXIBICAO_ITEMS = [
  { id: "listagem_grid", label: "Listagem Grid", desc: "" },
  { id: "acoes_lote", label: "Ações em Lote", desc: "" },
  { id: "custo_lucro", label: "Custo / Lucro", desc: "Exibe colunas de custo e lucro na listagem" },
];

const MODULES = [
  { id: "complementos", label: "Complementos", icon: UtensilsCrossed, description: "Adicionais e extras por produto" },
  { id: "combo_delivery", label: "Combo Delivery", icon: PackageCheck, description: "Montar combo por etapas (Delivery/Mesas). Depois use o botão na barra de produtos." },
  { id: "variacoes", label: "Variações", icon: Layers, description: "Tamanhos, sabores e opções" },
  { id: "etiquetas", label: "Etiquetas", icon: Tags, description: "Etiquetas personalizadas para produtos" },
  { id: "tipo_produto", label: "Tipo de Produto", icon: PackageCheck, description: "Simples, Insumo, Combo, Kit e Composto" },
  { id: "nutricional", label: "Nutricional", icon: Apple, description: "Informações nutricionais e etiqueta" },
];

const Dot = ({ scope }) => (
  <span
    className={cn(
      "mt-1 w-2 h-2 rounded-full shrink-0",
      scope === "local" ? "bg-blue-500" : "bg-amber-500"
    )}
  />
);

/** Painel flutuante (sheet à direita) — mesmas opções de antes. */
export default function ProductSettingsDialog({ open, onClose }) {
  const [config, setConfig] = useState(/** @type {Record<string, any>} */ ({}));
  const [printPointsOpen, setPrintPointsOpen] = useState(false);

  useEffect(() => {
    if (open) {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        const initial = {};
        [...CADASTRO_ITEMS, ...ESTOQUE_TOGGLES, ...EXIBICAO_ITEMS, ...MODULES].forEach((item) => {
          initial[item.id] = saved[item.id] ?? item.default ?? false;
        });
        setConfig(initial);
      } catch {
        const initial = {};
        [...CADASTRO_ITEMS, ...ESTOQUE_TOGGLES, ...EXIBICAO_ITEMS, ...MODULES].forEach((item) => {
          initial[item.id] = item.default ?? false;
        });
        setConfig(initial);
      }
    }
  }, [open]);

  const toggle = (id) => {
    setConfig((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const exibicaoActive = EXIBICAO_ITEMS.filter((i) => config[i.id]).length;
  const modulesActive = MODULES.filter((m) => config[m.id]).length;

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-0 flex flex-col gap-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right duration-300"
        >
          <SheetHeader className="p-5 pb-3 border-b text-left space-y-0 shrink-0">
            <SheetTitle className="flex items-center gap-2 text-lg pr-8">
              <Settings className="w-5 h-5 text-primary" />
              Configurações
            </SheetTitle>
          </SheetHeader>

          <div className="px-5 py-3 flex items-center gap-4 text-xs text-muted-foreground border-b bg-muted/30 shrink-0">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500" /> Local
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" /> Global
            </span>
          </div>

          <div className="px-5 py-2 flex-1 overflow-y-auto">
            <Accordion type="multiple" defaultValue={["cadastro"]}>
              <AccordionItem value="cadastro">
                <AccordionTrigger className="text-sm font-semibold uppercase tracking-wide">
                  Cadastro
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-0 -mt-2">
                    {CADASTRO_ITEMS.map((item) => (
                      <div key={item.id} className="flex items-start gap-3 py-2.5 border-b last:border-0">
                        <Dot scope={item.scope} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{item.label}</div>
                          {item.desc && (
                            <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                          )}
                        </div>
                        <Switch checked={!!config[item.id]} onCheckedChange={() => toggle(item.id)} />
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="estoque">
                <AccordionTrigger className="text-sm font-semibold uppercase tracking-wide">
                  Estoque
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4 pt-1">
                    <div>
                      <div className="flex items-start gap-3">
                        <span className="mt-1 w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                        <div className="flex-1">
                          <div className="text-sm font-medium">Base de custo para o preço</div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Custo médio = média das últimas 3 entradas. Padrão da empresa; cada produto pode ter o seu.
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-2 ml-5">
                        <button
                          type="button"
                          onClick={() => {
                            setConfig((p) => {
                              const next = { ...p, base_custo: "ultimo" };
                              localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
                              return next;
                            });
                          }}
                          className={cn(
                            "px-4 py-1.5 rounded-full text-sm font-medium border transition-all",
                            (config.base_custo || "ultimo") === "ultimo"
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-background text-foreground hover:bg-muted"
                          )}
                        >
                          Último custo
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfig((p) => {
                              const next = { ...p, base_custo: "medio" };
                              localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
                              return next;
                            });
                          }}
                          className={cn(
                            "px-4 py-1.5 rounded-full text-sm font-medium border transition-all",
                            config.base_custo === "medio"
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-background text-foreground hover:bg-muted"
                          )}
                        >
                          Custo médio
                        </button>
                      </div>
                    </div>

                    {ESTOQUE_TOGGLES.map((item) => (
                      <div key={item.id} className="flex items-start gap-3 border-t pt-4">
                        <Dot scope={item.scope} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{item.label}</div>
                          <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                        </div>
                        <Switch checked={!!config[item.id]} onCheckedChange={() => toggle(item.id)} />
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="exibicao">
                <AccordionTrigger className="text-sm font-semibold uppercase tracking-wide">
                  <span className="flex items-center gap-2">
                    Exibição
                    {exibicaoActive > 0 && (
                      <Badge className="bg-primary text-primary-foreground text-[10px] h-5 min-w-5 flex items-center justify-center px-1">
                        {exibicaoActive}
                      </Badge>
                    )}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-0 -mt-2">
                    {EXIBICAO_ITEMS.map((item) => (
                      <div key={item.id} className="flex items-start gap-3 py-2.5 border-b last:border-0">
                        <span className="mt-1 w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{item.label}</div>
                          {item.desc && (
                            <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                          )}
                        </div>
                        <Switch checked={!!config[item.id]} onCheckedChange={() => toggle(item.id)} />
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="modulos" className="border-b-0">
                <AccordionTrigger className="text-sm font-semibold uppercase tracking-wide">
                  <span className="flex items-center gap-2">
                    Módulos
                    {modulesActive > 0 && (
                      <Badge className="bg-primary text-primary-foreground text-[10px] h-5 min-w-5 flex items-center justify-center px-1">
                        {modulesActive}
                      </Badge>
                    )}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-1 -mt-2">
                    {MODULES.map((mod) => {
                      const Icon = mod.icon;
                      return (
                        <div key={mod.id} className="flex items-start gap-3 py-2.5 border-b last:border-0">
                          <span className="mt-1 w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 text-sm font-medium">
                              <Icon className="w-4 h-4 text-muted-foreground" />
                              {mod.label}
                            </div>
                            {mod.description && (
                              <p className="text-xs text-muted-foreground mt-0.5">{mod.description}</p>
                            )}
                          </div>
                          <Switch checked={!!config[mod.id]} onCheckedChange={() => toggle(mod.id)} />
                        </div>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>

          <div className="p-5 pt-3 border-t shrink-0">
            <button
              type="button"
              onClick={() => setPrintPointsOpen(true)}
              className="w-full flex items-center justify-center gap-2 p-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-md transition-all text-sm font-semibold"
            >
              <Printer className="w-4 h-4" /> Pontos de Impressão
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <PrintPointsDialog
        open={printPointsOpen}
        onClose={() => setPrintPointsOpen(false)}
      />
    </>
  );
}

import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function Termos() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Link to="/landing" className="inline-flex items-center gap-2 text-sm text-emerald-700 mb-6">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Termos de Uso</h1>
        <p className="text-sm text-slate-500 mb-8">Última atualização: 13 de setembro de 2026</p>
        <div className="prose prose-slate max-w-none space-y-4 text-sm text-slate-700">
          <p>
            Ao criar conta ou usar o MercadoFácil PDV (“Serviço”), você concorda com estes Termos.
            O Serviço é um sistema de gestão e ponto de venda na nuvem para comércios.
          </p>
          <h2 className="text-lg font-semibold text-slate-900">1. Conta e planos</h2>
          <p>
            O acesso depende de login e de um plano ativo ou período de teste (7 dias).
            Valores, recursos e limites estão descritos na página de planos. O pagamento pode ser
            cobrado via PIX (Mercado Pago) conforme configurado pelo provedor.
          </p>
          <h2 className="text-lg font-semibold text-slate-900">2. Uso aceitável</h2>
          <p>
            Você é responsável pelos dados cadastrados, vendas, usuários da loja e conformidade fiscal
            da sua atividade. É proibido uso ilícito, engenharia reversa abusiva ou compartilhamento
            de credenciais.
          </p>
          <h2 className="text-lg font-semibold text-slate-900">3. Fiscal (NFC-e / NF-e / NFS-e)</h2>
          <p>
            A emissão é validada, numerada, assinada e transmitida pelo Serviço, e o documento só
            consta como autorizado mediante protocolo do autorizador oficial. Depende do
            certificado digital A1 da sua empresa e, no caso de NFC-e e NF-e, da homologação junto
            à SEFAZ da sua UF. Não há emissão simulada: quando a autorização não ocorre, o
            documento fica registrado como rejeitado ou com erro, com o motivo.
          </p>
          <h2 className="text-lg font-semibold text-slate-900">4. Disponibilidade</h2>
          <p>
            Nos esforçamos para manter o Serviço disponível, mas podem ocorrer manutenções e
            interrupções. Faça backups regulares dos dados críticos.
          </p>
          <h2 className="text-lg font-semibold text-slate-900">5. Contato</h2>
          <p>
            Dúvidas: WhatsApp (62) 9 9250-6433 · Anápolis, GO. E-mail em configuração.
          </p>
        </div>
      </div>
    </div>
  );
}

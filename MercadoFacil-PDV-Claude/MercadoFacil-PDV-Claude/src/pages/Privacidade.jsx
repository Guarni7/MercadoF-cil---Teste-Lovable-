import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function Privacidade() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Link to="/landing" className="inline-flex items-center gap-2 text-sm text-emerald-700 mb-6">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Política de Privacidade</h1>
        <p className="text-sm text-slate-500 mb-8">Última atualização: 13 de setembro de 2026</p>
        <div className="space-y-4 text-sm text-slate-700">
          <p>
            Esta política descreve como o MercadoFácil PDV trata dados pessoais e de operação da loja,
            em alinhamento à LGPD (Lei 13.709/2018).
          </p>
          <h2 className="text-lg font-semibold text-slate-900">1. Dados que coletamos</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Dados de conta: nome, e-mail, função (admin/operador).</li>
            <li>Dados de loja: produtos, clientes, vendas, caixa, financeiros que você cadastrar.</li>
            <li>Dados técnicos: logs de acesso, dispositivo/terminal, IP quando necessário para segurança.</li>
            <li>Pagamentos: processados por terceiros (ex.: Mercado Pago); não armazenamos cartão no navegador.</li>
          </ul>
          <h2 className="text-lg font-semibold text-slate-900">2. Finalidade</h2>
          <p>
            Prestação do PDV, cobrança de planos, suporte, segurança, melhoria do produto e cumprimento legal.
          </p>
          <h2 className="text-lg font-semibold text-slate-900">3. Compartilhamento</h2>
          <p>
            Com provedores de infraestrutura (hospedagem/nuvem), meios de pagamento e autoridades quando
            exigido por lei. Não vendemos sua base de clientes.
          </p>
          <h2 className="text-lg font-semibold text-slate-900">4. Seus direitos</h2>
          <p>
            Acesso, correção, exclusão, portabilidade e oposição, conforme a LGPD. Solicite pelo
            WhatsApp (62) 9 9250-6433 (e-mail profissional em configuração).
          </p>
          <h2 className="text-lg font-semibold text-slate-900">5. Segurança</h2>
          <p>
            Tokens de pagamento ficam em variáveis de ambiente / Secrets do servidor. Controle de acesso
            por login, papéis e regras de dados (RLS).
          </p>
        </div>
      </div>
    </div>
  );
}

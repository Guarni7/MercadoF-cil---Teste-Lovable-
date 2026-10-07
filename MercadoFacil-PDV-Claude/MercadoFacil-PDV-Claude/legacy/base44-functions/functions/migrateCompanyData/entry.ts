import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

const ENTITIES = [
  'Product',
  'Category',
  'Brand',
  'Customer',
  'Sale',
  'CashRegister',
  'StockMovement',
  'Bill',
  'DeliveryOrder',
  'Nfce',
  'ActivityLog',
];

/** Garante empresa do usuário e atribui company_id a registros órfãos. */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let companyId = user.company_id || null;
    let company = null;

    if (companyId) {
      try {
        company = await base44.asServiceRole.entities.Company.get(companyId);
      } catch {
        companyId = null;
        company = null;
      }
    }

    if (!companyId) {
      const owned = await base44.asServiceRole.entities.Company.filter(
        { owner_user_id: user.id },
        '-created_date',
        1
      );
      if (owned?.[0]) {
        company = owned[0];
        companyId = company.id;
      }
    }

    if (!companyId && user.role === 'admin') {
      company = await base44.asServiceRole.entities.Company.create({
        trade_name: user.full_name || user.email || 'Minha Loja',
        legal_name: user.full_name || user.email || 'Minha Loja',
        document: '00000000000000',
        email: user.email || '',
        status: 'active',
        plan: user.plan || undefined,
        plan_status: user.plan_status || 'none',
        plan_expires_at: user.plan_expires_at || undefined,
        trial_started_at: user.trial_started_at || undefined,
        owner_user_id: user.id,
      });
      companyId = company.id;
    }

    // Usuário comum: vincula à primeira empresa ativa (piloto 1 loja)
    if (!companyId) {
      const companies = await base44.asServiceRole.entities.Company.list('-created_date', 1);
      if (companies?.[0]) {
        company = companies[0];
        companyId = company.id;
      }
    }

    if (!companyId) {
      return Response.json({ error: 'Nenhuma empresa encontrada para vincular.' }, { status: 400 });
    }

    if (user.company_id !== companyId) {
      await base44.asServiceRole.entities.User.update(user.id, {
        company_id: companyId,
        company_role: user.role === 'admin' ? (user.company_role || 'owner') : 'cashier',
      });
    }

    if (user.role === 'admin') {
      try {
        const others = await base44.asServiceRole.entities.User.list('-created_date', 50);
        for (const u of others) {
          if (u.id === user.id || u.company_id) continue;
          await base44.asServiceRole.entities.User.update(u.id, {
            company_id: companyId,
            company_role: 'cashier',
          });
        }
      } catch (e) {
        console.warn('migrate users skip', e);
      }
    }

    const summary: Record<string, number> = {};
    for (const name of ENTITIES) {
      let updated = 0;
      try {
        const rows = await base44.asServiceRole.entities[name].list('-created_date', 5000);
        for (const row of rows) {
          if (row.company_id === companyId) continue;
          if (!row.company_id) {
            await base44.asServiceRole.entities[name].update(row.id, { company_id: companyId });
            updated++;
          }
        }
      } catch (e) {
        console.warn('migrate skip', name, e);
      }
      summary[name] = updated;
    }

    return Response.json({
      success: true,
      company_id: companyId,
      company,
      migrated: summary,
      message: 'Dados vinculados à sua empresa. Recarregue o PDV.',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

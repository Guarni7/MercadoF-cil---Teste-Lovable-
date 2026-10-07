import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

// Atribui um papel a um usuário. Apenas administradores podem usar esta função,
// e nunca podem modificar o próprio papel (evita autoescalonamento de privilégios).
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Apenas admins podem atribuir papéis
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: apenas administradores podem atribuir papéis' }, { status: 403 });
    }

    const body = await req.json();
    const { role, user_id } = body;

    if (role !== 'admin' && role !== 'user') {
      return Response.json({ error: 'Role inválido' }, { status: 400 });
    }

    // Não permite modificar o próprio papel
    if (!user_id || user_id === user.id) {
      return Response.json({ error: 'Não é permitido modificar o próprio papel' }, { status: 400 });
    }

    // Verifica se o usuário alvo existe
    const target = await base44.asServiceRole.entities.User.get(user_id);
    if (!target) {
      return Response.json({ error: 'Usuário alvo não encontrado' }, { status: 404 });
    }

    await base44.asServiceRole.entities.User.update(user_id, { role });

    return Response.json({ success: true, role, user_id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
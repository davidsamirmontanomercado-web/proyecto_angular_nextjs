import { cors, requireUser, mapErrorBD } from '@/lib/api/http';

const CORS = cors('GET, POST, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const userId = auth.usuario.id;
  const { searchParams } = new URL(request.url);
  const asVendedor = searchParams.get('rol') === 'vendedor';

  try {
    let q = auth.db
      .from('pedidos')
      .select(`
        *,
        comprador:usuarios!comprador_id(id, nombre, correo),
        vendedor:usuarios!vendedor_id(id, nombre, correo),
        items:pedido_items(
          id,
          cantidad,
          precio_unitario,
          producto:productos(id, nombre, imagen)
        )
      `);

    if (asVendedor) {
      q = q.eq('vendedor_id', userId);
    } else {
      q = q.eq('comprador_id', userId);
    }

    const { data, error } = await q.order('created_at', { ascending: false });

    if (error) {
      console.error('[Pedidos GET] Error:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped?.mensaje }, mapped?.status || 500);
    }

    return CORS.json(request, { data }, 200);
  } catch (err) {
    console.error('[Pedidos GET] Error inesperado:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  try {
    const body = await request.json();
    const { 
      items, 
      metodo_pago, 
      ciudad, 
      municipio, 
      direccion, 
      referencia_entrega 
    } = body;

    if (!items || !items.length || !ciudad || !municipio || !direccion || !metodo_pago) {
      return CORS.json(request, { error: 'Todos los datos de entrega y pago son obligatorios.' }, 400);
    }

    // Agrupar items por vendedor_id
    // Los items deben venir con producto_id, vendedor_id, cantidad, precio_unitario
    const itemsPorVendedor = items.reduce((acc: any, item: any) => {
      if (!acc[item.vendedor_id]) acc[item.vendedor_id] = [];
      acc[item.vendedor_id].push(item);
      return acc;
    }, {});

    const pedidosCreados = [];

    for (const vendedorId in itemsPorVendedor) {
      const vendedorItems = itemsPorVendedor[vendedorId];
      const total = vendedorItems.reduce((sum: number, item: any) => sum + (item.precio_unitario * item.cantidad), 0);

      // 1. Crear el pedido
      const { data: pedido, error: pedidoErr } = await auth.db
        .from('pedidos')
        .insert({
          comprador_id: auth.usuario.id,
          vendedor_id: vendedorId,
          total,
          estado: 'pendiente',
          metodo_pago,
          ciudad,
          municipio,
          direccion,
          referencia_entrega
        })
        .select()
        .single();

      if (pedidoErr) throw pedidoErr;

      // 2. Crear los items del pedido
      const itemsToInsert = vendedorItems.map((item: any) => ({
        pedido_id: pedido.id,
        producto_id: item.producto_id,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario
      }));

      const { error: itemsErr } = await auth.db
        .from('pedido_items')
        .insert(itemsToInsert);

      if (itemsErr) throw itemsErr;

      pedidosCreados.push(pedido);
    }

    return CORS.json(request, { 
      data: pedidosCreados, 
      message: 'Pedido(s) realizado(s) con éxito.' 
    }, 201);

  } catch (err: any) {
    console.error('[Pedidos POST] Error inesperado:', err);
    const mapped = mapErrorBD(err);
    return CORS.json(request, { error: mapped?.mensaje || 'Error interno del servidor.' }, mapped?.status || 500);
  }
}

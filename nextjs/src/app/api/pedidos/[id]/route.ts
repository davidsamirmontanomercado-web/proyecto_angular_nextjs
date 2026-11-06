import { cors, requireUser, mapErrorBD } from '@/lib/api/http';

const CORS = cors('GET, PATCH, DELETE, OPTIONS');

const ESTADOS_VALIDOS = ['pendiente', 'confirmado', 'enviado', 'entregado', 'cancelado'] as const;

// Un pedido ya despachado no se puede editar ni borrar.
const ESTADOS_EN_CAMINO = ['enviado', 'entregado'];

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const { id } = await params;

  try {
    const { data, error } = await auth.db
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
      `)
      .eq('id', id)
      .single();

    if (error) {
      console.error('[Pedido Individual GET] Error:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped?.mensaje }, mapped?.status || 500);
    }

    // Verificar que el usuario sea el comprador o el vendedor
    if (data.comprador_id !== auth.usuario.id && data.vendedor_id !== auth.usuario.id) {
      return CORS.json(request, { error: 'No tienes permiso para ver este pedido.' }, 403);
    }

    return CORS.json(request, { data }, 200);
  } catch (err) {
    console.error('[Pedido Individual GET] Error inesperado:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

/**
 * Actualiza un pedido. Admite dos tipos de cambio:
 *  - `estado`   : lo cambia el vendedor (flujo de entrega) o el comprador para
 *                 cancelar un pedido pendiente.
 *  - datos de entrega (ciudad, municipio, direccion, referencia_entrega,
 *                 metodo_pago): sólo el comprador y sólo si el pedido sigue
 *                 'pendiente'.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const { id } = await params;

  try {
    const body = await request.json();
    const { estado, ciudad, municipio, direccion, referencia_entrega, metodo_pago } = body ?? {};

    // 1. Obtener el pedido para verificar permisos y estado actual
    const { data: pedido, error: fetchErr } = await auth.db
      .from('pedidos')
      .select('comprador_id, vendedor_id, estado')
      .eq('id', id)
      .single();

    if (fetchErr || !pedido) {
      return CORS.json(request, { error: 'Pedido no encontrado.' }, 404);
    }

    const esVendedor = pedido.vendedor_id === auth.usuario.id;
    const esComprador = pedido.comprador_id === auth.usuario.id;

    if (!esVendedor && !esComprador) {
      return CORS.json(request, { error: 'No tienes permiso para actualizar este pedido.' }, 403);
    }

    const cambios: Record<string, unknown> = {};

    // 2. Cambio de estado
    if (estado !== undefined) {
      if (!ESTADOS_VALIDOS.includes(estado)) {
        return CORS.json(request, { error: 'Estado de pedido no válido.' }, 400);
      }

      // El comprador sólo puede cancelar, y sólo mientras el pedido esté pendiente.
      if (esComprador && !esVendedor) {
        if (estado !== 'cancelado') {
          return CORS.json(request, { error: 'No tienes permiso para cambiar el estado de este pedido.' }, 403);
        }
        if (pedido.estado !== 'pendiente') {
          return CORS.json(request, { error: 'Sólo puedes cancelar pedidos pendientes.' }, 400);
        }
      }

      cambios.estado = estado;
    }

    // 3. Edición de los datos de entrega (sólo comprador y pedido pendiente)
    const tocaEntrega =
      ciudad !== undefined ||
      municipio !== undefined ||
      direccion !== undefined ||
      referencia_entrega !== undefined ||
      metodo_pago !== undefined;

    if (tocaEntrega) {
      if (!esComprador) {
        return CORS.json(request, { error: 'Sólo el comprador puede editar los datos de entrega.' }, 403);
      }
      if (pedido.estado !== 'pendiente') {
        return CORS.json(request, { error: 'Sólo puedes editar la entrega de un pedido pendiente.' }, 400);
      }

      const obligatorios: Array<[string, unknown]> = [
        ['ciudad', ciudad],
        ['municipio', municipio],
        ['direccion', direccion]
      ];
      for (const [campo, valor] of obligatorios) {
        if (valor !== undefined && (typeof valor !== 'string' || !valor.trim())) {
          return CORS.json(request, { error: `El campo ${campo} no puede quedar vacío.` }, 400);
        }
      }

      if (ciudad !== undefined) cambios.ciudad = String(ciudad).trim();
      if (municipio !== undefined) cambios.municipio = String(municipio).trim();
      if (direccion !== undefined) cambios.direccion = String(direccion).trim();
      if (metodo_pago !== undefined) cambios.metodo_pago = String(metodo_pago).trim();
      if (referencia_entrega !== undefined) {
        cambios.referencia_entrega = referencia_entrega ? String(referencia_entrega).trim() : null;
      }
    }

    if (Object.keys(cambios).length === 0) {
      return CORS.json(request, { error: 'No se enviaron cambios para actualizar.' }, 400);
    }

    const { data, error } = await auth.db
      .from('pedidos')
      .update(cambios)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[Pedido PATCH] Error:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped?.mensaje }, mapped?.status || 500);
    }

    return CORS.json(request, { data, message: 'Pedido actualizado con éxito.' }, 200);
  } catch (err) {
    console.error('[Pedido PATCH] Error inesperado:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

/**
 * Elimina un pedido. Reglas:
 *  - Sólo las partes del pedido (comprador o vendedor).
 *  - No se puede eliminar un pedido en camino o entregado.
 *  - El comprador puede eliminar pedidos pendientes o cancelados.
 *  - El vendedor sólo puede eliminar pedidos cancelados.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const { id } = await params;

  try {
    const { data: pedido, error: fetchErr } = await auth.db
      .from('pedidos')
      .select('comprador_id, vendedor_id, estado')
      .eq('id', id)
      .single();

    if (fetchErr || !pedido) {
      return CORS.json(request, { error: 'Pedido no encontrado.' }, 404);
    }

    const esVendedor = pedido.vendedor_id === auth.usuario.id;
    const esComprador = pedido.comprador_id === auth.usuario.id;

    if (!esVendedor && !esComprador) {
      return CORS.json(request, { error: 'No tienes permiso para eliminar este pedido.' }, 403);
    }

    if (ESTADOS_EN_CAMINO.includes(pedido.estado)) {
      return CORS.json(request, { error: 'No puedes eliminar un pedido que ya está en camino o entregado.' }, 400);
    }

    if (esVendedor && !esComprador && pedido.estado !== 'cancelado') {
      return CORS.json(request, { error: 'El vendedor sólo puede eliminar pedidos cancelados.' }, 400);
    }

    const { error } = await auth.db.from('pedidos').delete().eq('id', id);

    if (error) {
      console.error('[Pedido DELETE] Error:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped?.mensaje }, mapped?.status || 500);
    }

    return CORS.json(request, { message: 'Pedido eliminado con éxito.' }, 200);
  } catch (err) {
    console.error('[Pedido DELETE] Error inesperado:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}
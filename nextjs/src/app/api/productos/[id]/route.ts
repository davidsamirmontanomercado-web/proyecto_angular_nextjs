import { cors, requireRole, requireUser, mapErrorBD } from '@/lib/api/http';

const CORS = cors('PATCH, DELETE, OPTIONS');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ id: string }> };

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

async function authorizeSeller(request: Request, id: string) {
  if (!UUID_RE.test(id)) {
    return { response: CORS.json(request, { error: 'Identificador de producto no válido.' }, 400) };
  }

  const auth = await requireUser(request);
  if (!auth.ok) {
    return { response: CORS.json(request, { error: auth.mensaje }, auth.status) };
  }

  const role = await requireRole(auth, ['vendedor']);
  if (!role.ok) {
    return { response: CORS.json(request, { error: role.mensaje }, role.status) };
  }

  const { data: empresa, error } = await auth.db
    .from('perfiles_empresariales')
    .select('id')
    .eq('usuario_id', auth.usuario.id)
    .maybeSingle();

  if (error) {
    const mapped = mapErrorBD(error);
    return {
      response: CORS.json(request, { error: mapped?.mensaje }, mapped?.status || 500)
    };
  }
  if (!empresa) {
    return {
      response: CORS.json(request, { error: 'Tu cuenta no tiene un perfil empresarial.' }, 409)
    };
  }

  return { auth, empresa };
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const authorized = await authorizeSeller(request, id);
  if ('response' in authorized) return authorized.response;

  try {
    const body = await request.json() as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if ('nombre' in body) {
      const nombre = typeof body['nombre'] === 'string' ? body['nombre'].trim() : '';
      if (!nombre || nombre.length > 160) {
        return CORS.json(request, { error: 'El nombre del producto es obligatorio.' }, 400);
      }
      updates['nombre'] = nombre;
    }
    if ('descripcion' in body) {
      updates['descripcion'] = typeof body['descripcion'] === 'string' ? body['descripcion'].trim() || null : null;
    }
    if ('precio' in body) {
      const precio = Number(body['precio']);
      if (!Number.isFinite(precio) || precio <= 0) {
        return CORS.json(request, { error: 'El precio debe ser mayor que cero.' }, 400);
      }
      updates['precio'] = precio;
    }
    if ('categoria_id' in body) {
      const categoriaId = typeof body['categoria_id'] === 'string' ? body['categoria_id'] : '';
      if (!UUID_RE.test(categoriaId)) {
        return CORS.json(request, { error: 'Selecciona una categoría válida.' }, 400);
      }
      const { data: categoria, error } = await authorized.auth.db
        .from('categorias')
        .select('id')
        .eq('id', categoriaId)
        .eq('activa', true)
        .maybeSingle();
      if (error) {
        const mapped = mapErrorBD(error);
        return CORS.json(request, { error: mapped?.mensaje }, mapped?.status || 500);
      }
      if (!categoria) return CORS.json(request, { error: 'La categoría no está disponible.' }, 400);
      updates['categoria_id'] = categoriaId;
    }
    if ('subcategoria' in body) {
      updates['subcategoria'] = typeof body['subcategoria'] === 'string' ? body['subcategoria'].trim() || null : null;
    }
    if ('stock' in body) {
      const stock = Number(body['stock']);
      if (!Number.isInteger(stock) || stock < 0) {
        return CORS.json(request, { error: 'El stock debe ser un entero igual o mayor que cero.' }, 400);
      }
      updates['stock'] = stock;
    }
    if ('imagenes' in body) {
      const imagenes = body['imagenes'];
      if (!Array.isArray(imagenes) || imagenes.length > 5 ||
          imagenes.some((img) => typeof img !== 'string') ||
          JSON.stringify(imagenes).length > 3_500_000) {
        return CORS.json(request, { error: 'Las imágenes superan el límite permitido.' }, 400);
      }
      updates['imagenes'] = imagenes;
    }
    if ('etiquetas' in body) {
      const etiquetas = body['etiquetas'];
      if (!Array.isArray(etiquetas) || etiquetas.length > 20 ||
          etiquetas.some((tag) => typeof tag !== 'string')) {
        return CORS.json(request, { error: 'Las etiquetas no tienen un formato válido.' }, 400);
      }
      updates['etiquetas'] = etiquetas;
    }
    for (const campo of ['condicion', 'garantia', 'entrega'] as const) {
      if (campo in body) {
        const valor = body[campo];
        updates[campo] = typeof valor === 'string' ? valor.trim() || null : null;
      }
    }
    if ('estado_publicacion' in body) {
      const estado = body['estado_publicacion'];
      if (estado !== 'activo' && estado !== 'inactivo') {
        return CORS.json(request, { error: 'El estado de publicación no es válido.' }, 400);
      }
      updates['estado_publicacion'] = estado;
    }

    if (Object.keys(updates).length === 0) {
      return CORS.json(request, { error: 'No hay cambios para guardar.' }, 400);
    }

    updates['fecha_actualizacion'] = new Date().toISOString();

    const { data, error } = await authorized.auth.db
      .from('productos')
      .update(updates)
      .eq('id', id)
      .eq('empresa_id', authorized.empresa.id)
      .select()
      .maybeSingle();

    if (error) {
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped?.mensaje }, mapped?.status || 500);
    }
    if (!data) return CORS.json(request, { error: 'No se encontró el producto de esta tienda.' }, 404);

    return CORS.json(request, { data, message: 'Producto actualizado.' }, 200);
  } catch (err) {
    console.error('[Productos PATCH] Error inesperado:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const authorized = await authorizeSeller(request, id);
  if ('response' in authorized) return authorized.response;

  try {
    const { data, error } = await authorized.auth.db
      .from('productos')
      .delete()
      .eq('id', id)
      .eq('empresa_id', authorized.empresa.id)
      .select('id')
      .maybeSingle();

    if (error) {
      if (error.code === '23503') {
        return CORS.json(
          request,
          { error: 'Este producto está asociado a pedidos y no puede borrarse. Puedes retirarlo de la tienda editando su publicación.' },
          409
        );
      }
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped?.mensaje }, mapped?.status || 500);
    }
    if (!data) return CORS.json(request, { error: 'No se encontró el producto de esta tienda.' }, 404);

    return CORS.json(request, { message: 'Producto eliminado.' }, 200);
  } catch (err) {
    console.error('[Productos DELETE] Error inesperado:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

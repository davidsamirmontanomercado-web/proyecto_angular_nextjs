import { cors, requireUser, mapErrorBD } from '@/lib/api/http';
import { createServerSupabase } from '@/lib/supabase/server';

const CORS = cors('GET, POST, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') || '').trim();
  const categoria = searchParams.get('categoria') || '';
  const minPrecio = searchParams.get('minPrecio');
  const maxPrecio = searchParams.get('maxPrecio');
  const vendedorId = searchParams.get('vendedorId');
  const orden = searchParams.get('orden') || 'recientes';

  const supabase = await createServerSupabase();

  try {
    let q = supabase
      .from('productos')
      .select(`
        *,
        vendedor:usuarios(id, nombre)
      `);

    if (query) {
      // Búsqueda por nombre O descripción. Se eliminan comas y paréntesis para
      // no romper la sintaxis del filtro `or` de PostgREST.
      const termino = query.replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim();
      if (termino) {
        q = q.or(`nombre.ilike.%${termino}%,descripcion.ilike.%${termino}%`);
      }
    }

    if (categoria) {
      q = q.eq('categoria', categoria);
    }

    if (minPrecio) {
      q = q.gte('precio', parseFloat(minPrecio));
    }

    if (maxPrecio) {
      q = q.lte('precio', parseFloat(maxPrecio));
    }

    if (vendedorId) {
      q = q.eq('vendedor_id', vendedorId);
    }

    // Orden del catálogo (filtro avanzado de la tienda).
    switch (orden) {
      case 'precio_asc':
        q = q.order('precio', { ascending: true });
        break;
      case 'precio_desc':
        q = q.order('precio', { ascending: false });
        break;
      case 'nombre_asc':
        q = q.order('nombre', { ascending: true });
        break;
      default:
        q = q.order('created_at', { ascending: false });
    }

    const { data, error } = await q;

    if (error) {
      console.error('[Productos GET] Error:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped?.mensaje }, mapped?.status || 500);
    }

    return CORS.json(request, { data }, 200);
  } catch (err) {
    console.error('[Productos GET] Error inesperado:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const rol = auth.usuario.user_metadata?.rol || 'comprador';
  if (rol !== 'vendedor' && rol !== 'administrador') {
    return CORS.json(request, { error: 'Solo los vendedores pueden crear productos.' }, 403);
  }

  try {
    const body = await request.json();
    const { nombre, descripcion, precio, imagen, categoria, tag } = body;

    if (!nombre || !precio) {
      return CORS.json(request, { error: 'Nombre y precio son obligatorios.' }, 400);
    }

    const { data, error } = await auth.db
      .from('productos')
      .insert({
        nombre,
        descripcion,
        precio,
        imagen,
        categoria,
        tag,
        vendedor_id: auth.usuario.id
      })
      .select()
      .single();

    if (error) {
      console.error('[Productos POST] Error:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped?.mensaje }, mapped?.status || 500);
    }

    return CORS.json(request, { data, message: 'Producto creado con éxito.' }, 201);
  } catch (err) {
    console.error('[Productos POST] Error inesperado:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

import { createClient } from '@supabase/supabase-js';
import { cors, requireRole, requireUser, mapErrorBD } from '@/lib/api/http';
import { getSupabaseEnv } from '@/lib/supabase/server';

const CORS = cors('GET, POST, OPTIONS');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEDAS_VALIDAS = new Set(['COP', 'USD', 'EUR']);

function createAnonSupabase() {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

async function getEmpresaVendedora(db: Awaited<ReturnType<typeof createAnonSupabase>>, userId: string) {
  return db
    .from('perfiles_empresariales')
    .select('id, nombre_empresa')
    .eq('usuario_id', userId)
    .maybeSingle();
}

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const misProductos = searchParams.get('misProductos') === 'true';
  const query = (searchParams.get('q') || '').trim();
  const categoria = searchParams.get('categoria') || '';
  const minPrecio = searchParams.get('minPrecio');
  const maxPrecio = searchParams.get('maxPrecio');
  const vendedorId = searchParams.get('vendedorId');
  const orden = searchParams.get('orden') || 'recientes';

  try {
    let db: Awaited<ReturnType<typeof createAnonSupabase>>;
    let empresaId: string | null = null;

    if (misProductos) {
      const auth = await requireUser(request);
      if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);
      const rol = await requireRole(auth, ['vendedor']);
      if (!rol.ok) return CORS.json(request, { error: rol.mensaje }, rol.status);

      const { data: empresa, error: empresaError } = await getEmpresaVendedora(auth.db, auth.usuario.id);
      if (empresaError) {
        const mapped = mapErrorBD(empresaError);
        return CORS.json(request, { error: mapped?.mensaje }, mapped?.status || 500);
      }
      if (!empresa) {
        return CORS.json(request, { error: 'Tu cuenta no tiene un perfil empresarial.' }, 409);
      }
      db = auth.db;
      empresaId = empresa.id;
    } else {
      db = createAnonSupabase();
    }

    let q = misProductos
      ? db.from('productos').select('*').eq('empresa_id', empresaId!)
      : db.from('productos_tienda').select('*');

    if (!misProductos) q = q.eq('estado_publicacion', 'activo');

    if (query) {
      const termino = query.replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim();
      if (termino) {
        q = q.or(`nombre.ilike.%${termino}%,descripcion.ilike.%${termino}%`);
      }
    }

    if (categoria) {
      if (!UUID_RE.test(categoria)) {
        return CORS.json(request, { error: 'La categoría seleccionada no es válida.' }, 400);
      }
      q = q.eq('categoria_id', categoria);
    }

    const min = minPrecio === null ? null : Number(minPrecio);
    const max = maxPrecio === null ? null : Number(maxPrecio);
    if (min !== null && Number.isFinite(min)) {
      q = q.gte('precio', min);
    }
    if (max !== null && Number.isFinite(max)) {
      q = q.lte('precio', max);
    }

    if (vendedorId && !misProductos) {
      q = q.eq('vendedor_id', vendedorId);
    }

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
        q = q.order('fecha_publicacion', { ascending: false });
    }

    const { data, error } = await q;

    if (error) {
      console.error('[Productos GET] Error:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped?.mensaje }, mapped?.status || 500);
    }

    return CORS.json(request, { data: data ?? [] }, 200);
  } catch (err) {
    console.error('[Productos GET] Error inesperado:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const rol = await requireRole(auth, ['vendedor']);
  if (!rol.ok) return CORS.json(request, { error: rol.mensaje }, rol.status);

  try {
    const body = await request.json() as Record<string, unknown>;
    const nombre = typeof body['nombre'] === 'string' ? body['nombre'].trim() : '';
    const precio = Number(body['precio']);
    const moneda = typeof body['moneda'] === 'string' ? body['moneda'].trim().toUpperCase() : 'COP';
    const categoriaId = typeof body['categoria_id'] === 'string' ? body['categoria_id'] : '';
    const stock = Number(body['stock'] ?? 0);
    const imagenes = Array.isArray(body['imagenes']) ? body['imagenes'] : [];
    const etiquetas = Array.isArray(body['etiquetas']) ? body['etiquetas'] : [];
    const estadoPublicacion = body['estado_publicacion'] ?? 'activo';

    if (!nombre || nombre.length > 160 || !Number.isFinite(precio) || precio <= 0 ||
        !UUID_RE.test(categoriaId) || !Number.isInteger(stock) || stock < 0 ||
        !MONEDAS_VALIDAS.has(moneda) ||
        (estadoPublicacion !== 'activo' && estadoPublicacion !== 'inactivo')) {
      return CORS.json(request, { error: 'Revisa nombre, categoría, precio, moneda, stock y estado de publicación.' }, 400);
    }
    if (imagenes.length > 5 || imagenes.some((img) => typeof img !== 'string') ||
        JSON.stringify(imagenes).length > 3_500_000) {
      return CORS.json(request, { error: 'Las imágenes superan el límite permitido.' }, 400);
    }
    if (etiquetas.length > 20 || etiquetas.some((tag) => typeof tag !== 'string')) {
      return CORS.json(request, { error: 'Las etiquetas no tienen un formato válido.' }, 400);
    }

    const { data: empresa, error: empresaError } = await getEmpresaVendedora(auth.db, auth.usuario.id);
    if (empresaError) {
      const mapped = mapErrorBD(empresaError);
      return CORS.json(request, { error: mapped?.mensaje }, mapped?.status || 500);
    }
    if (!empresa) {
      return CORS.json(request, { error: 'Tu cuenta no tiene un perfil empresarial.' }, 409);
    }

    const { data: categoria, error: categoriaError } = await auth.db
      .from('categorias')
      .select('id')
      .eq('id', categoriaId)
      .eq('activa', true)
      .maybeSingle();
    if (categoriaError) {
      const mapped = mapErrorBD(categoriaError);
      return CORS.json(request, { error: mapped?.mensaje }, mapped?.status || 500);
    }
    if (!categoria) return CORS.json(request, { error: 'La categoría no está disponible.' }, 400);

    const { data, error } = await auth.db
      .from('productos')
      .insert({
        empresa_id: empresa.id,
        nombre,
        descripcion: typeof body['descripcion'] === 'string' ? body['descripcion'].trim() : null,
        categoria_id: categoriaId,
        subcategoria: typeof body['subcategoria'] === 'string' ? body['subcategoria'].trim() || null : null,
        precio,
        moneda,
        imagenes,
        condicion: typeof body['condicion'] === 'string' ? body['condicion'] : 'nuevo',
        stock,
        garantia: typeof body['garantia'] === 'string' ? body['garantia'].trim() || null : null,
        entrega: typeof body['entrega'] === 'string' ? body['entrega'].trim() || null : null,
        etiquetas,
        estado_publicacion: estadoPublicacion,
        fecha_actualizacion: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('[Productos POST] Error:', error);
      const mapped = mapErrorBD(error);
      return CORS.json(request, { error: mapped?.mensaje }, mapped?.status || 500);
    }

    return CORS.json(request, { data, message: 'Producto publicado con éxito.' }, 201);
  } catch (err) {
    console.error('[Productos POST] Error inesperado:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

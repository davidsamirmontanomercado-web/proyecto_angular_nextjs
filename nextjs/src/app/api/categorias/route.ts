import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

function getAllowedOrigins(): string[] {
  const origins = ['http://localhost:4200'];

  const angularUrl = process.env.NEXT_PUBLIC_ANGULAR_URL;
  if (angularUrl && angularUrl.trim()) {
    origins.push(angularUrl.trim().replace(/\/+$/, ''));
  }

  // Known production Angular frontend
  origins.push('https://frontend-three-wine-12.vercel.app');

  return Array.from(new Set(origins));
}

function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  const allowed = getAllowedOrigins();
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'false';
  }
  return headers;
}

// Proyección pública: columnas reales de public.categorias (verificadas).
const CATEGORIA_SELECT = [
  'id',
  'nombre',
  'slug',
  'icono',
  'descripcion',
  'subcategorias',
  'orden',
  'activa',
  'cantidad_transmisiones',
  'cantidad_empresas',
  'imagen_fondo'
].join(',');

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) });
}

export async function GET(request: Request) {
  try {
    const supabase = await createServerSupabase();
    const { searchParams } = new URL(request.url);
    const incluirInactivas = searchParams.get('incluir_inactivas') === 'true';
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 0, 1), 200) : null;

    let query = supabase
      .schema('public')
      .from('categorias')
      .select(CATEGORIA_SELECT)
      .order('orden', { ascending: true })
      .order('nombre', { ascending: true });

    if (!incluirInactivas) query = query.eq('activa', true);
    if (limit) query = query.limit(limit);

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching categorias:', error);
      return NextResponse.json(
        { error: 'Error interno del servidor' },
        { status: 500, headers: getCorsHeaders(request) }
      );
    }

    const categorias = data ?? [];
    return NextResponse.json(
      { data: categorias, meta: { count: categorias.length } },
      { status: 200, headers: getCorsHeaders(request) }
    );
  } catch (err) {
    console.error('Unexpected error fetching categorias:', err);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500, headers: getCorsHeaders(request) }
    );
  }
}

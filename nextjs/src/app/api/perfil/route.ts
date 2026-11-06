import { cors, requireUser, mapErrorBD } from '@/lib/api/http';

const CORS = cors('GET, PATCH, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const userId = auth.usuario.id;
  const rol = auth.usuario.user_metadata?.rol || 'comprador';

  try {
    // 1. Obtener datos básicos del usuario y su rol real de la tabla
    const { data: usuario, error: userError } = await auth.db
      .from('usuarios')
      .select('id, nombre, correo, rol, fecha_registro')
      .eq('id', userId)
      .maybeSingle();

    if (userError) {
      console.error('[Perfil GET] Error de base de datos (usuarios):', userError);
      const mapped = mapErrorBD(userError);
      return CORS.json(request, { error: mapped?.mensaje }, mapped?.status || 500);
    }

    // El rol real es el de la tabla, cayendo a la metadata si no existe en la tabla
    const rolReal = usuario?.rol || auth.usuario.user_metadata?.rol || 'comprador';

    // 2. Obtener estadísticas según el rol
    let stats = {
      seguidores: 0,
      siguiendo: 0
    };

    // Conteo de seguidores (quiénes me siguen)
    const { count: seguidoresCount } = await auth.db
      .from('seguimientos')
      .select('*', { count: 'exact', head: true })
      .eq('seguido_id', userId);
    
    // Conteo de siguiendo (a quiénes sigo)
    const { count: siguiendoCount } = await auth.db
      .from('seguimientos')
      .select('*', { count: 'exact', head: true })
      .eq('seguidor_id', userId);

    stats.seguidores = seguidoresCount || 0;
    stats.siguiendo = siguiendoCount || 0;

    let perfilEmpresa = null;
    let adminStats = null;

    if (rolReal === 'vendedor') {
      const { data: empresa, error: empError } = await auth.db
        .from('perfiles_empresariales')
        .select('*')
        .eq('usuario_id', userId)
        .maybeSingle();
      
      if (empError) {
        console.error('[Perfil GET] Error de base de datos (perfiles_empresariales):', empError);
        const mapped = mapErrorBD(empError);
        return CORS.json(request, { error: mapped?.mensaje }, mapped?.status || 500);
      }
      perfilEmpresa = empresa;
    } else if (rolReal === 'administrador') {
      // Estadísticas globales para el administrador
      const [
        { count: totalUsuarios },
        { count: solicitudesPendientes },
        { count: transmisionesEnVivo }
      ] = await Promise.all([
        auth.db.from('usuarios').select('*', { count: 'exact', head: true }),
        auth.db.from('solicitudes_vendedor').select('*', { count: 'exact', head: true }).eq('estado', 'pendiente'),
        auth.db.from('transmisiones').select('*', { count: 'exact', head: true }).eq('estado', 'en_vivo')
      ]);

      adminStats = {
        totalUsuarios: totalUsuarios || 0,
        solicitudesPendientes: solicitudesPendientes || 0,
        transmisionesEnVivo: transmisionesEnVivo || 0
      };
    }

    return CORS.json(request, {
      data: {
        usuario: usuario || { 
          id: userId, 
          nombre: auth.usuario.user_metadata?.nombre, 
          correo: auth.usuario.email 
        },
        perfilEmpresa,
        adminStats,
        stats,
        rol: rolReal
      }
    }, 200);

  } catch (err) {
    console.error('[Perfil GET] Error inesperado:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

export async function PATCH(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  const userId = auth.usuario.id;
  const rol = auth.usuario.app_metadata?.rol || auth.usuario.user_metadata?.rol || 'comprador';
  const body = await request.json();

  try {
    // 1. Actualizar datos básicos en la tabla 'usuarios'
    if (body.nombre) {
      const { error: userErr } = await auth.db
        .from('usuarios')
        .update({ 
          nombre: body.nombre,
          // Solo actualizamos la fecha de actualización si existiera esa columna
          // fecha_actualizacion: new Date().toISOString() 
        })
        .eq('id', userId);
      
      if (userErr) throw userErr;

      // Sincronizar con Supabase Auth metadata
      await auth.db.auth.setSession({ access_token: auth.token, refresh_token: '' });
      await auth.db.auth.updateUser({ data: { nombre: body.nombre } });
    }

    // 2. Actualizar perfil empresarial si es vendedor
    if (rol === 'vendedor' && body.perfilEmpresa) {
      const { perfilEmpresa } = body;
      
      const { error: empError } = await auth.db
        .from('perfiles_empresariales')
        .upsert({
          usuario_id: userId,
          nombre_empresa: perfilEmpresa.nombre_empresa,
          descripcion: perfilEmpresa.descripcion,
          ubicacion: perfilEmpresa.ubicacion,
          telefono_contacto: perfilEmpresa.telefono_contacto,
          correo_contacto: perfilEmpresa.correo_contacto,
          horario: perfilEmpresa.horario,
          info_envios: perfilEmpresa.info_envios,
          metodos_pago: perfilEmpresa.metodos_pago,
          categoria_negocio: perfilEmpresa.categoria_negocio,
          url_web: perfilEmpresa.url_web,
          instagram: perfilEmpresa.instagram,
          facebook: perfilEmpresa.facebook,
          
        });

      if (empError) {
        console.error('[Perfil PATCH] Error en perfiles_empresariales:', empError);
        const mapped = mapErrorBD(empError);
        return CORS.json(request, { error: mapped?.mensaje }, mapped?.status || 500);
      }
    }

    return CORS.json(request, { message: 'Perfil actualizado con éxito.' }, 200);
  } catch (err: any) {
    console.error('[Perfil PATCH] Error inesperado:', err);
    return CORS.json(request, { error: err.message || 'Error interno del servidor.' }, 500);
  }
}

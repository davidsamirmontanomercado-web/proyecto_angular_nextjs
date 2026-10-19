import { cors, requireUser } from '@/lib/api/http';

// Subida de la imagen de portada a Supabase Storage (bucket `portadas`).
//
//   POST /api/uploads/portada   (multipart/form-data, campo `archivo`)
//
// Se usa el cliente ligado al access_token del usuario, de modo que las
// políticas de `storage.objects` se evalúan con su identidad real (cada usuario
// sólo puede escribir dentro de su carpeta `portadas/<auth.uid()>/`). No se usa
// service_role.
const BUCKET = 'portadas';
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB

// Tipos permitidos y su extensión canónica.
const TIPOS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

const CORS = cors('POST, OPTIONS');

export function OPTIONS(request: Request) {
  return CORS.empty(request);
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return CORS.json(request, { error: auth.mensaje }, auth.status);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return CORS.json(
      request,
      { error: 'La petición debe ser multipart/form-data con el campo "archivo".' },
      400
    );
  }

  const archivo = form.get('archivo');
  if (!(archivo instanceof File)) {
    return CORS.json(request, { error: 'Debes adjuntar un archivo de imagen.' }, 400);
  }

  const extension = TIPOS[archivo.type];
  if (!extension) {
    return CORS.json(
      request,
      { error: 'Formato no admitido. Usa JPG, PNG, WEBP o GIF.' },
      400
    );
  }

  if (archivo.size === 0) {
    return CORS.json(request, { error: 'El archivo está vacío.' }, 400);
  }

  if (archivo.size > MAX_BYTES) {
    return CORS.json(
      request,
      { error: 'La imagen supera el máximo permitido de 3 MB.' },
      400
    );
  }

  try {
    const ruta = `${auth.usuario.id}/${crypto.randomUUID()}.${extension}`;
    const contenido = await archivo.arrayBuffer();

    const { error } = await auth.db.storage.from(BUCKET).upload(ruta, contenido, {
      contentType: archivo.type,
      upsert: false
    });

    if (error) {
      const mensaje = (error.message ?? '').toLowerCase();
      // Bucket inexistente o sin políticas: la migración 20261017140000 no se
      // ha aplicado todavía. Se avisa con 503 sin inventar configuración.
      if (mensaje.includes('bucket not found') || (error as { statusCode?: string }).statusCode === '404') {
        return CORS.json(
          request,
          { error: 'La subida de imágenes aún no está habilitada en el servidor.' },
          503
        );
      }

      // 403/42501: sin permiso de escritura en Storage para este usuario.
      if (
        mensaje.includes('row-level security') ||
        mensaje.includes('unauthorized') ||
        (error as { statusCode?: string }).statusCode === '403'
      ) {
        return CORS.json(request, { error: 'No tienes permisos para subir imágenes.' }, 403);
      }

      console.error('Error subiendo portada a Storage:', error);
      return CORS.json(request, { error: 'No se pudo subir la imagen.' }, 500);
    }

    const { data } = auth.db.storage.from(BUCKET).getPublicUrl(ruta);
    return CORS.json(request, { data: { url: data.publicUrl, ruta } }, 201);
  } catch (err) {
    console.error('Error inesperado subiendo portada:', err);
    return CORS.json(request, { error: 'Error interno del servidor.' }, 500);
  }
}

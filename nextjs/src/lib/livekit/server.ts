import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

// Integración con LiveKit Cloud (sólo servidor).
//
// Las credenciales se leen EXCLUSIVAMENTE de variables de entorno del servidor
// (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET). Nunca se exponen al
// cliente ni se usa un prefijo NEXT_PUBLIC_. Tampoco se usa `service_role`:
// los permisos de la transmisión se resuelven con el cliente Supabase
// autenticado del usuario y la RLS existente.

export type RolLiveKit = 'anfitrion' | 'espectador';

export interface ConfigLiveKit {
  url: string;
  apiKey: string;
  apiSecret: string;
}

/**
 * Lee la configuración de LiveKit del entorno del servidor.
 * Devuelve `null` si falta cualquiera de las tres variables, de modo que las
 * rutas puedan responder un error claro en lugar de fallar de forma opaca.
 */
export function leerConfigLiveKit(): ConfigLiveKit | null {
  const url = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();

  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}

// Token de vida corta: cubre el arranque de la sesión. Si caduca con la
// conexión ya establecida, LiveKit mantiene el participante (el token sólo se
// valida al entrar) y una reconexión volvería a pedir token al backend, que
// comprobará de nuevo el estado de la transmisión.
const TOKEN_TTL_SEGUNDOS = 15 * 60;

/**
 * Firma el token de sala. El rol lo decide SIEMPRE el servidor:
 * - anfitrión: puede entrar, publicar y suscribirse.
 * - espectador: puede entrar y suscribirse, pero NO publicar.
 */
export async function crearTokenSala(params: {
  config: ConfigLiveKit;
  sala: string;
  identidad: string;
  nombre: string;
  rol: RolLiveKit;
}): Promise<string> {
  const { config, sala, identidad, nombre, rol } = params;

  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: identidad,
    name: nombre,
    ttl: TOKEN_TTL_SEGUNDOS
  });

  token.addGrant({
    room: sala,
    roomJoin: true,
    canPublish: rol === 'anfitrion',
    canSubscribe: true,
    canPublishData: false
  });

  return token.toJwt();
}

/**
 * Elimina la sala para expulsar a todos los participantes.
 * Sólo debe llamarse cuando la transmisión ya quedó confirmada como
 * `finalizada` en la base de datos.
 */
export async function eliminarSala(config: ConfigLiveKit, sala: string): Promise<void> {
  // RoomServiceClient usa HTTP(S); LIVEKIT_URL suele venir como wss://.
  const host = config.url.replace(/^ws/, 'http');
  const servicio = new RoomServiceClient(host, config.apiKey, config.apiSecret);
  await servicio.deleteRoom(sala);
}

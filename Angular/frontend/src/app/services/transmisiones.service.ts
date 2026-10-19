import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { AuthService } from './auth.service';

export interface CategoriaInfo {
  id: string;
  nombre: string;
  slug: string;
  icono: string | null;
}

export interface EmpresaInfo {
  id: string;
  nombre_empresa: string | null;
  logo: string | null;
}

/** Información pública mínima del anfitrión (sin ids internos). */
export interface AnfitrionPublico {
  transmision_id: string;
  nombre_empresa: string | null;
  logo: string | null;
  anfitrion_nombre: string | null;
}

export interface Transmision {
  id: string;
  titulo: string | null;
  descripcion: string | null;
  estado: string | null;
  subcategoria: string | null;
  imagen_portada: string | null;
  destacada: boolean | null;
  espectadores_actuales: number | null;
  espectadores_totales: number | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  fecha_creacion: string | null;
  fecha_actualizacion: string | null;
  duracion_minutos: number | null;
  url_stream: string | null;
  ubicacion: string | null;
  categoria_id: string | null;
  empresa_id: string | null;
  categoria?: CategoriaInfo | null;
  empresa?: EmpresaInfo | null;
  /** Resumen agregado de reacciones (lo añade el detalle de la API). */
  reacciones_total?: number | null;
  reacciones_autores?: string[] | null;
}

export interface TransmisionesResponse {
  data: Transmision[];
  meta?: {
    count?: number;
  };
}

export interface TransmisionesQuery {
  categoria_id?: string;
  subcategoria?: string;
  titulo?: string;
  empresa_id?: string;
  estado?: string;
  destacada?: boolean;
  limit?: number;
}

/** Línea de negocio (slug almacenado en la BD). */
export type LineaNegocio = 'ventas_nuevos' | 'produccion' | 'usados';

/** Campos aceptados al crear. `id`, `anfitrion_id`, `estado`, `empresa_id` y
 *  `fecha_inicio` los fija el backend (fecha_inicio se establece al iniciar). */
export interface CrearTransmisionPayload {
  titulo: string;
  linea_negocio: LineaNegocio;
  categoria_id: string;
  descripcion?: string | null;
  subcategoria?: string | null;
  imagen_portada?: string | null;
  ubicacion?: string | null;
  destacada?: boolean | null;
}

/** Campos editables. `estado` no se edita aquí: usa iniciar()/finalizar(). */
export type ActualizarTransmisionPayload = Partial<CrearTransmisionPayload>;

export interface TransmisionEstadoResponse {
  data: { id: string; estado: string; duracion_minutos?: number | null };
}

/** Contadores reales de espectadores (vista agregada de presencia). */
export interface ConteoEspectadores {
  actuales: number;
  totales: number;
}

/** Rol concedido por el backend para la sala de LiveKit (nunca lo propone Angular). */
export type RolLiveKit = 'anfitrion' | 'espectador';

/** Credenciales de acceso a la sala de LiveKit de una transmisión. */
export interface TokenLiveKit {
  /** URL del servidor de medios (LiveKit Cloud). */
  url: string;
  /** Token de vida corta firmado por el backend. */
  token: string;
  rol: RolLiveKit;
  /** Sala: el id real de la transmisión. */
  sala: string;
}

@Injectable({ providedIn: 'root' })
export class TransmisionesService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get apiUrl(): string {
    return `${this.auth.backendUrl}/api/transmisiones`;
  }

  getTransmisiones(params?: TransmisionesQuery): Observable<TransmisionesResponse> {
    let httpParams = new HttpParams();
    if (params?.categoria_id) httpParams = httpParams.set('categoria_id', params.categoria_id);
    if (params?.subcategoria) httpParams = httpParams.set('subcategoria', params.subcategoria);
    if (params?.titulo) httpParams = httpParams.set('titulo', params.titulo);
    if (params?.empresa_id) httpParams = httpParams.set('empresa_id', params.empresa_id);
    if (params?.estado) httpParams = httpParams.set('estado', params.estado);
    if (params?.destacada !== undefined) {
      httpParams = httpParams.set('destacada', String(params.destacada));
    }
    if (params?.limit) httpParams = httpParams.set('limit', String(params.limit));

    return this.http.get<TransmisionesResponse>(this.apiUrl, { params: httpParams });
  }

  getAll(): Observable<Transmision[]> {
    return this.getTransmisiones().pipe(map((res) => res.data ?? []));
  }

  getById(id: string): Observable<Transmision> {
    return this.http
      .get<{ data: Transmision }>(`${this.apiUrl}/${id}`)
      .pipe(map((res) => res.data));
  }

  /** Información pública mínima del anfitrión (nombre comercial, logo). */
  getAnfitrion(id: string): Observable<AnfitrionPublico | null> {
    return this.http
      .get<{ data: AnfitrionPublico | null }>(`${this.apiUrl}/${id}/anfitrion`)
      .pipe(map((res) => res.data ?? null));
  }

  /** Transmisiones del usuario autenticado en cualquier estado (incl. 'programada').
   *  Requiere Authorization Bearer (lo añade authInterceptor). */
  getMias(estado?: string): Observable<Transmision[]> {
    let httpParams = new HttpParams();
    if (estado) httpParams = httpParams.set('estado', estado);

    return this.http
      .get<TransmisionesResponse>(`${this.apiUrl}/mias`, { params: httpParams })
      .pipe(map((res) => res.data ?? []));
  }

  /** Crea una transmisión programada del usuario autenticado. */
  crear(payload: CrearTransmisionPayload): Observable<{ id: string; estado: string }> {
    return this.http
      .post<TransmisionEstadoResponse>(this.apiUrl, payload)
      .pipe(map((res) => ({ id: res.data.id, estado: res.data.estado })));
  }

  /** Actualiza los campos editables de una transmisión. */
  actualizar(
    id: string,
    cambios: ActualizarTransmisionPayload
  ): Observable<{ id: string }> {
    return this.http.patch<{ data: { id: string } }>(
      `${this.apiUrl}/${id}`,
      cambios
    ).pipe(map((res) => ({ id: res.data.id })));
  }

  /** programada -> en_vivo */
  iniciar(id: string): Observable<{ id: string; estado: string }> {
    return this.http
      .post<TransmisionEstadoResponse>(`${this.apiUrl}/${id}/iniciar`, {})
      .pipe(map((res) => ({ id: res.data.id, estado: res.data.estado })));
  }

  /** en_vivo -> finalizada */
  finalizar(id: string): Observable<{ id: string; estado: string }> {
    return this.http
      .post<TransmisionEstadoResponse>(`${this.apiUrl}/${id}/finalizar`, {})
      .pipe(map((res) => ({ id: res.data.id, estado: res.data.estado })));
  }

  /**
   * Sube la imagen de portada a Supabase Storage (bucket `portadas`) vía API y
   * devuelve su URL pública. No se guarda Base64 en la tabla.
   */
  subirPortada(archivo: File): Observable<string> {
    const form = new FormData();
    form.append('archivo', archivo);
    return this.http
      .post<{ data: { url: string } }>(`${this.auth.backendUrl}/api/uploads/portada`, form)
      .pipe(map((res) => res.data.url));
  }

  // --- LiveKit (audio y video en tiempo real) ------------------------------

  /**
   * Pide al backend el token de acceso a la sala de LiveKit de la transmisión.
   * El rol (anfitrión/espectador) lo decide el servidor comparando la sesión con
   * `transmisiones.anfitrion_id`; Angular nunca lo envía ni lo elige.
   */
  obtenerTokenLiveKit(id: string): Observable<TokenLiveKit> {
    return this.http
      .post<{ data: TokenLiveKit }>(`${this.apiUrl}/${id}/token`, {})
      .pipe(map((res) => res.data));
  }

  // --- Presencia de espectadores (heartbeat real, sin simulación) -----------

  /** Entra / late. Devuelve los espectadores actuales y totales. */
  entrarPresencia(id: string): Observable<ConteoEspectadores> {
    return this.http
      .post<{ data: Partial<ConteoEspectadores> }>(`${this.apiUrl}/${id}/presencia`, {})
      .pipe(map((res) => this.aConteo(res.data)));
  }

  /** Sale: deja de contar en la sesión actual (el total histórico se conserva). */
  salirPresencia(id: string): Observable<ConteoEspectadores> {
    return this.http
      .delete<{ data: Partial<ConteoEspectadores> }>(`${this.apiUrl}/${id}/presencia`)
      .pipe(map((res) => this.aConteo(res.data)));
  }

  private aConteo(data?: Partial<ConteoEspectadores>): ConteoEspectadores {
    return {
      actuales: typeof data?.actuales === 'number' ? data.actuales : 0,
      totales: typeof data?.totales === 'number' ? data.totales : 0
    };
  }
}

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, shareReplay } from 'rxjs';
import { AuthService } from './auth.service';

export interface Categoria {
  id: string;
  nombre: string;
  slug: string;
  icono: string | null;
  descripcion: string | null;
  subcategorias: string[] | null;
  orden: number | null;
  activa: boolean | null;
  cantidad_transmisiones: number | null;
  cantidad_empresas: number | null;
  imagen_fondo: string | null;
}

export interface CategoriasResponse {
  data: Categoria[];
  meta?: {
    count?: number;
  };
}

@Injectable({ providedIn: 'root' })
export class CategoriasService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private readonly TTL_MS = 5 * 60 * 1000;
  private cache = new Map<string, { obs: Observable<Categoria[]>; expires: number }>();

  private get apiUrl(): string {
    return `${this.auth.backendUrl}/api/categorias`;
  }

  /**
   * Devuelve las categorías cacheando el resultado 5 minutos por combinación de
   * opciones. Dentro del TTL se reutiliza la misma respuesta (shareReplay) sin
   * volver a llamar al backend; un error NO se cachea.
   */
  getCategorias(options?: { incluirInactivas?: boolean; limit?: number }): Observable<Categoria[]> {
    const clave = JSON.stringify(options ?? {});
    const ahora = Date.now();

    const enCache = this.cache.get(clave);
    if (enCache && enCache.expires > ahora) {
      return enCache.obs;
    }

    let httpParams = new HttpParams();
    if (options?.incluirInactivas) {
      httpParams = httpParams.set('incluir_inactivas', 'true');
    }
    if (options?.limit) {
      httpParams = httpParams.set('limit', String(options.limit));
    }

    const obs = this.http
      .get<CategoriasResponse>(this.apiUrl, { params: httpParams })
      .pipe(
        map((res) => res.data ?? []),
        shareReplay({ bufferSize: 1, refCount: false }),
      );

    this.cache.set(clave, { obs, expires: ahora + this.TTL_MS });

    // Si la petición falla, se descarta la entrada para permitir reintentos.
    obs.subscribe({ error: () => this.cache.delete(clave) });

    return obs;
  }

  /** Invalida toda la caché, o sólo la combinación de opciones indicada. */
  invalidateCache(options?: { incluirInactivas?: boolean; limit?: number }): void {
    if (options === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(JSON.stringify(options));
  }
}

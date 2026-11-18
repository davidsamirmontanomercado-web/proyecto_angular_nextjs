import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { AuthService } from './auth.service';

/** Estado de la reacción del usuario + resumen agregado de la transmisión. */
export interface ResumenReacciones {
  me_gusta: boolean;
  total: number;
  autores: string[];
}

interface ReaccionesResponse {
  data?: {
    me_gusta?: boolean;
    total?: number;
    autores?: string[];
    eliminado?: boolean;
  };
}

@Injectable({ providedIn: 'root' })
export class ReaccionesService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get apiUrl(): string {
    return `${this.auth.backendUrl}/api/reacciones`;
  }

  /** ¿El usuario autenticado dio "me gusta" a la transmisión? */
  meGusta(transmisionId: string): Observable<boolean> {
    const params = new HttpParams().set('transmision_id', transmisionId);
    return this.http
      .get<ReaccionesResponse>(this.apiUrl, { params })
      .pipe(map((res) => res.data?.me_gusta ?? false));
  }

  /** Dar "me gusta" (idempotente en el backend). Devuelve el resumen actualizado. */
  darMeGusta(transmisionId: string): Observable<ResumenReacciones> {
    return this.http
      .post<ReaccionesResponse>(this.apiUrl, { transmision_id: transmisionId })
      .pipe(map((res) => this.aResumen(res.data, true)));
  }

  /** Retirar "me gusta" (idempotente en el backend). Devuelve el resumen actualizado. */
  quitarMeGusta(transmisionId: string): Observable<ResumenReacciones> {
    const params = new HttpParams().set('transmision_id', transmisionId);
    return this.http
      .delete<ReaccionesResponse>(this.apiUrl, { params })
      .pipe(map((res) => this.aResumen(res.data, false)));
  }

  private aResumen(
    data: ReaccionesResponse['data'],
    fallbackMeGusta: boolean
  ): ResumenReacciones {
    return {
      me_gusta: data?.me_gusta ?? fallbackMeGusta,
      total: typeof data?.total === 'number' ? data.total : 0,
      autores: Array.isArray(data?.autores) ? data.autores : []
    };
  }
}

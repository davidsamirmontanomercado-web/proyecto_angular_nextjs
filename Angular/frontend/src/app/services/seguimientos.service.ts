import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { AuthService } from './auth.service';

interface EstadoSeguimientoResponse {
  data: { siguiendo: boolean; esPropietario?: boolean; eliminado?: boolean };
}

@Injectable({ providedIn: 'root' })
export class SeguimientosService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get apiUrl(): string {
    return `${this.auth.backendUrl}/api/seguimientos`;
  }

  private get transmisionesUrl(): string {
    return `${this.auth.backendUrl}/api/transmisiones`;
  }

  /** ¿El usuario autenticado sigue a `seguidoId`? */
  estaSiguiendo(seguidoId: string): Observable<boolean> {
    const params = new HttpParams().set('seguido_id', seguidoId);
    return this.http
      .get<EstadoSeguimientoResponse>(this.apiUrl, { params })
      .pipe(map((res) => res.data?.siguiendo ?? false));
  }

  /** Seguir a un usuario (idempotente en el backend). */
  seguir(seguidoId: string): Observable<boolean> {
    return this.http
      .post<EstadoSeguimientoResponse>(this.apiUrl, { seguido_id: seguidoId })
      .pipe(map((res) => res.data?.siguiendo ?? true));
  }

  /** Dejar de seguir a un usuario (idempotente en el backend). */
  dejarDeSeguir(seguidoId: string): Observable<boolean> {
    const params = new HttpParams().set('seguido_id', seguidoId);
    return this.http
      .delete<EstadoSeguimientoResponse>(this.apiUrl, { params })
      .pipe(map((res) => res.data?.siguiendo ?? false));
  }

  // --- Seguimiento del anfitrión resuelto desde la transmisión -------------
  // El backend resuelve `anfitrion_id` de forma interna; el cliente nunca lo ve.

  /** Estado del seguimiento del anfitrión de la transmisión. */
  estadoDeTransmision(transmisionId: string): Observable<{ siguiendo: boolean; esPropietario: boolean }> {
    return this.http
      .get<EstadoSeguimientoResponse>(`${this.transmisionesUrl}/${transmisionId}/seguimiento`)
      .pipe(
        map((res) => ({
          siguiendo: res.data?.siguiendo ?? false,
          esPropietario: res.data?.esPropietario ?? false
        }))
      );
  }

  /** Seguir al anfitrión de la transmisión (idempotente). */
  seguirTransmision(transmisionId: string): Observable<boolean> {
    return this.http
      .post<EstadoSeguimientoResponse>(`${this.transmisionesUrl}/${transmisionId}/seguimiento`, {})
      .pipe(map((res) => res.data?.siguiendo ?? true));
  }

  /** Dejar de seguir al anfitrión de la transmisión (idempotente). */
  dejarDeSeguirTransmision(transmisionId: string): Observable<boolean> {
    return this.http
      .delete<EstadoSeguimientoResponse>(`${this.transmisionesUrl}/${transmisionId}/seguimiento`)
      .pipe(map((res) => res.data?.siguiendo ?? false));
  }
}

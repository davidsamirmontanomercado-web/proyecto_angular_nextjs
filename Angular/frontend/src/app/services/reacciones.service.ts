import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { AuthService } from './auth.service';

interface MeGustaResponse {
  data: { me_gusta: boolean; eliminado?: boolean };
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
      .get<MeGustaResponse>(this.apiUrl, { params })
      .pipe(map((res) => res.data?.me_gusta ?? false));
  }

  /** Dar "me gusta" (idempotente en el backend). */
  darMeGusta(transmisionId: string): Observable<boolean> {
    return this.http
      .post<MeGustaResponse>(this.apiUrl, { transmision_id: transmisionId })
      .pipe(map((res) => res.data?.me_gusta ?? true));
  }

  /** Retirar "me gusta" (idempotente en el backend). */
  quitarMeGusta(transmisionId: string): Observable<boolean> {
    const params = new HttpParams().set('transmision_id', transmisionId);
    return this.http
      .delete<MeGustaResponse>(this.apiUrl, { params })
      .pipe(map((res) => res.data?.me_gusta ?? false));
  }
}

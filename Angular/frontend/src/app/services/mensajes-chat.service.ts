import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { AuthService } from './auth.service';

export interface MensajeChat {
  id: string;
  transmision_id: string;
  contenido: string | null;
  tipo: string | null;
  respondido: boolean | null;
  remitente_id: string | null;
  fecha: string | null;
}

interface MensajesResponse {
  data: MensajeChat[];
  meta?: { count?: number };
}

@Injectable({ providedIn: 'root' })
export class MensajesChatService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get apiUrl(): string {
    return `${this.auth.backendUrl}/api/mensajes-chat`;
  }

  listar(transmisionId: string): Observable<MensajeChat[]> {
    const params = new HttpParams().set('transmision_id', transmisionId);
    return this.http
      .get<MensajesResponse>(this.apiUrl, { params })
      .pipe(map((res) => res.data ?? []));
  }

  /** El tipo del mensaje lo decide el backend: el cliente sólo envía el texto. */
  enviar(transmisionId: string, contenido: string): Observable<void> {
    return this.http
      .post<{ data: { contenido: string } }>(this.apiUrl, {
        transmision_id: transmisionId,
        contenido
      })
      .pipe(map(() => undefined));
  }
}

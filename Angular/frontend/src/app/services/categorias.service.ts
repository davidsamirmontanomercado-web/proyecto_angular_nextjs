import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
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

  private get apiUrl(): string {
    return `${this.auth.backendUrl}/api/categorias`;
  }

  getCategorias(options?: { incluirInactivas?: boolean; limit?: number }): Observable<Categoria[]> {
    let httpParams = new HttpParams();
    if (options?.incluirInactivas) {
      httpParams = httpParams.set('incluir_inactivas', 'true');
    }
    if (options?.limit) {
      httpParams = httpParams.set('limit', String(options.limit));
    }

    return this.http
      .get<CategoriasResponse>(this.apiUrl, { params: httpParams })
      .pipe(map((res) => res.data ?? []));
  }
}

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

export interface PerfilEmpresa {
  usuario_id: string;
  nombre_empresa: string;
  descripcion?: string;
  ubicacion?: string;
  telefono_contacto?: string;
  correo_contacto?: string;
  horario?: string;
  info_envios?: string;
  metodos_pago?: string;
  categoria_negocio?: string;
  url_web?: string;
  instagram?: string;
  facebook?: string;
}

export interface PerfilData {
  usuario: {
    id: string;
    nombre: string;
    correo: string;
    rol: string;
    fecha_registro?: string;
  };
  perfilEmpresa?: PerfilEmpresa;
  adminStats?: {
    totalUsuarios: number;
    solicitudesPendientes: number;
    transmisionesEnVivo: number;
  };
  stats?: {
    seguidores: number;
    siguiendo: number;
  };
  rol: string;
}

@Injectable({
  providedIn: 'root'
})
export class PerfilService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private apiUrl = `${this.auth.backendUrl}/api/perfil`;

  /**
   * Obtiene los datos del perfil del usuario actual.
   */
  getPerfil(): Observable<{ data: PerfilData }> {
    return this.http.get<{ data: PerfilData }>(this.apiUrl);
  }

  /**
   * Actualiza los datos del perfil.
   */
  updatePerfil(data: { nombre?: string; perfilEmpresa?: Partial<PerfilEmpresa> }): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(this.apiUrl, data);
  }
}

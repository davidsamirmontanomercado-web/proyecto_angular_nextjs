import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

export interface Pedido {
  id: number;
  comprador_id: string;
  vendedor_id: string;
  total: number;
  estado: 'pendiente' | 'confirmado' | 'enviado' | 'entregado' | 'cancelado';
  metodo_pago: string;
  ciudad: string;
  municipio: string;
  direccion: string;
  referencia_entrega?: string;
  created_at: string;
  comprador?: any;
  vendedor?: any;
  items?: any[];
}

@Injectable({
  providedIn: 'root'
})
export class PedidosService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private apiUrl = `${this.auth.backendUrl}/api/pedidos`;

  getPedidos(rol: 'comprador' | 'vendedor' = 'comprador'): Observable<{ data: Pedido[] }> {
    return this.http.get<{ data: Pedido[] }>(this.apiUrl, { params: { rol } });
  }

  crearPedido(datos: any): Observable<any> {
    return this.http.post(this.apiUrl, datos);
  }

  actualizarEstado(id: number, estado: string): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${id}`, { estado });
  }

  /** Actualiza los datos de entrega de un pedido pendiente (sólo el comprador). */
  actualizarEntrega(id: number, datos: {
    ciudad: string;
    municipio: string;
    direccion: string;
    referencia_entrega?: string;
    metodo_pago: string;
  }): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${id}`, datos);
  }

  eliminarPedido(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/${id}`);
  }

  getPedido(id: number): Observable<{ data: Pedido }> {
    return this.http.get<{ data: Pedido }>(`${this.apiUrl}/${id}`);
  }
}

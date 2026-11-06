import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

export interface Producto {
  id: number;
  nombre: string;
  descripcion: string;
  precio: number;
  imagen: string;
  categoria: string;
  tag?: string;
  vendedor_id: string;
  vendedor?: {
    id: string;
    nombre: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class ProductosService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private apiUrl = `${this.auth.backendUrl}/api/productos`;

  getProductos(params: any = {}): Observable<{ data: Producto[] }> {
    return this.http.get<{ data: Producto[] }>(this.apiUrl, { params });
  }

  crearProducto(producto: Partial<Producto>): Observable<any> {
    return this.http.post(this.apiUrl, producto);
  }
}

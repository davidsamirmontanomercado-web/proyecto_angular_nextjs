import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

export interface Producto {
  id: string;
  empresa_id?: string;
  nombre: string;
  descripcion: string | null;
  categoria_id: string;
  subcategoria: string | null;
  precio: number;
  moneda: string;
  imagenes: string[] | null;
  imagen?: string;
  condicion: string;
  stock: number;
  garantia: string | null;
  entrega: string | null;
  etiquetas: string[] | null;
  estado_publicacion: string;
  fecha_publicacion: string;
  fecha_actualizacion: string;
  categoria?: string;
  vendedor_id?: string;
  vendedor_nombre?: string;
  vendedor?: {
    id: string;
    nombre: string;
  };
}

export type ProductoPayload = Pick<
  Producto,
  | 'nombre'
  | 'descripcion'
  | 'categoria_id'
  | 'subcategoria'
  | 'precio'
  | 'imagenes'
  | 'condicion'
  | 'stock'
  | 'garantia'
  | 'entrega'
  | 'etiquetas'
> & Partial<Pick<Producto, 'moneda' | 'estado_publicacion'>>;

@Injectable({
  providedIn: 'root'
})
export class ProductosService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private apiUrl = `${this.auth.backendUrl}/api/productos`;

  getProductos(params: Record<string, string | number> = {}): Observable<{ data: Producto[] }> {
    return this.http.get<{ data: Producto[] }>(this.apiUrl, { params });
  }

  getMisProductos(): Observable<{ data: Producto[] }> {
    return this.http.get<{ data: Producto[] }>(this.apiUrl, { params: { misProductos: 'true' } });
  }

  crearProducto(producto: ProductoPayload): Observable<{ data: Producto }> {
    return this.http.post<{ data: Producto }>(this.apiUrl, producto);
  }

  actualizarProducto(id: string, producto: ProductoPayload & { estado_publicacion?: string }): Observable<{ data: Producto }> {
    return this.http.patch<{ data: Producto }>(`${this.apiUrl}/${id}`, producto);
  }

  eliminarProducto(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/${id}`);
  }
}

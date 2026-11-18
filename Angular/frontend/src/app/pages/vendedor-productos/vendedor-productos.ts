import { CommonModule } from '@angular/common';
import { Component, ElementRef, Input, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Categoria, CategoriasService } from '../../services/categorias.service';
import { Producto, ProductoPayload, ProductosService } from '../../services/productos.service';
import { ToastService } from '../../services/toast.service';

type ProductoForm = Omit<ProductoPayload, 'descripcion' | 'subcategoria' | 'imagenes' | 'garantia' | 'entrega'> & {
  descripcion: string;
  subcategoria: string;
  imagenes: string[];
  imagenUrl: string;
  moneda: string;
  garantia: string;
  entrega: string;
  estado_publicacion: 'activo' | 'inactivo';
  etiquetasTexto: string;
};

@Component({
  selector: 'app-vendedor-productos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './vendedor-productos.html',
  styleUrl: './vendedor-productos.css'
})
export class VendedorProductosComponent implements OnInit {
  @Input() embedded = false;
  @ViewChild('listaProductosVendedor') private listaProductosVendedor?: ElementRef<HTMLElement>;

  private productosService = inject(ProductosService);
  private categoriasService = inject(CategoriasService);
  private toast = inject(ToastService);

  productos = signal<Producto[]>([]);
  categorias = signal<Categoria[]>([]);
  cargando = signal(true);
  guardando = signal(false);
  modalAbierto = signal(false);
  productoAEliminar = signal<Producto | null>(null);
  productoEditando = signal<string | null>(null);

  form: ProductoForm = this.formularioVacio();

  ngOnInit(): void {
    this.categoriasService.getCategorias().subscribe({
      next: (categorias) => this.categorias.set(categorias),
      error: () => this.toast.err('No se pudieron cargar las categorías.')
    });
    this.cargarProductos();
  }

  private formularioVacio(): ProductoForm {
    return {
      nombre: '',
      descripcion: '',
      categoria_id: '',
      subcategoria: '',
      precio: 0,
      moneda: 'COP',
      imagenes: [],
      imagenUrl: '',
      condicion: 'nuevo',
      stock: 1,
      garantia: '',
      entrega: '',
      etiquetas: [],
      estado_publicacion: 'activo',
      etiquetasTexto: ''
    };
  }

  cargarProductos(): void {
    this.cargando.set(true);
    this.productosService.getMisProductos().subscribe({
      next: ({ data }) => {
        this.productos.set(data ?? []);
        this.cargando.set(false);
      },
      error: (err) => {
        this.toast.err(err.error?.error || 'No se pudieron cargar tus productos.');
        this.cargando.set(false);
      }
    });
  }

  abrirCrear(): void {
    this.productoEditando.set(null);
    this.form = this.formularioVacio();
    this.modalAbierto.set(true);
  }

  abrirEdicion(producto: Producto): void {
    this.productoEditando.set(producto.id);
    this.form = {
      nombre: producto.nombre,
      descripcion: producto.descripcion ?? '',
      categoria_id: producto.categoria_id,
      subcategoria: producto.subcategoria ?? '',
      precio: Number(producto.precio),
      moneda: producto.moneda || 'COP',
      imagenes: [...(producto.imagenes ?? [])],
      imagenUrl: '',
      condicion: producto.condicion || 'nuevo',
      stock: Number(producto.stock ?? 0),
      garantia: producto.garantia ?? '',
      entrega: producto.entrega ?? '',
      etiquetas: [...(producto.etiquetas ?? [])],
      estado_publicacion: producto.estado_publicacion === 'inactivo' ? 'inactivo' : 'activo',
      etiquetasTexto: (producto.etiquetas ?? []).join(', ')
    };
    this.modalAbierto.set(true);
  }

  cerrarModal(): void {
    if (this.guardando()) return;
    this.modalAbierto.set(false);
  }

  subcategoriasActuales(): string[] {
    const categoria = this.categorias().find((item) => item.id === this.form.categoria_id);
    return Array.isArray(categoria?.subcategorias) ? categoria.subcategorias : [];
  }

  async agregarImagenes(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';

    if (this.form.imagenes.length + files.length > 5) {
      this.toast.info('Puedes agregar hasta 5 imágenes por producto.');
      return;
    }

    try {
      const nuevas: string[] = [];
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          this.toast.info('Selecciona archivos de imagen.');
          continue;
        }
        if (file.size > 1_500_000) {
          this.toast.info('Cada imagen debe pesar menos de 1,5 MB.');
          continue;
        }
        nuevas.push(await this.leerImagen(file));
      }

      const combinadas = [...this.form.imagenes, ...nuevas];
      if (JSON.stringify(combinadas).length > 3_500_000) {
        this.toast.info('El total de imágenes supera el límite permitido.');
        return;
      }
      this.form.imagenes = combinadas;
    } catch {
      this.toast.err('No se pudo leer una de las imágenes seleccionadas.');
    }
  }

  agregarImagenUrl(): void {
    const valor = this.form.imagenUrl.trim();
    if (!valor) return;

    let url: URL;
    try {
      url = new URL(valor);
    } catch {
      this.toast.info('Escribe una URL de imagen válida.');
      return;
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      this.toast.info('La imagen debe usar una URL HTTP o HTTPS.');
      return;
    }
    if (this.form.imagenes.length >= 5) {
      this.toast.info('Puedes agregar hasta 5 imágenes por producto.');
      return;
    }

    this.form.imagenes = [...this.form.imagenes, url.href];
    this.form.imagenUrl = '';
  }

  gestionarTodo(): void {
    this.listaProductosVendedor?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  quitarImagen(indice: number): void {
    this.form.imagenes = this.form.imagenes.filter((_, i) => i !== indice);
  }

  private leerImagen(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject();
      reader.onerror = () => reject();
      reader.readAsDataURL(file);
    });
  }

  guardarProducto(): void {
    const nombre = this.form.nombre.trim();
    if (!nombre || !this.form.categoria_id || !Number.isFinite(Number(this.form.precio)) ||
        Number(this.form.precio) <= 0 || !Number.isInteger(Number(this.form.stock)) ||
        Number(this.form.stock) < 0) {
      this.toast.info('Completa nombre, categoría, precio y stock correctamente.');
      return;
    }

    const payload: ProductoPayload = {
      nombre,
      descripcion: this.form.descripcion?.trim() || null,
      categoria_id: this.form.categoria_id,
      subcategoria: this.form.subcategoria?.trim() || null,
      precio: Number(this.form.precio),
      moneda: this.form.moneda,
      imagenes: this.form.imagenes,
      condicion: this.form.condicion,
      stock: Number(this.form.stock),
      garantia: this.form.garantia?.trim() || null,
      entrega: this.form.entrega?.trim() || null,
      estado_publicacion: this.form.estado_publicacion,
      etiquetas: this.form.etiquetasTexto
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    };

    this.guardando.set(true);
    const productoId = this.productoEditando();
    const request = productoId
      ? this.productosService.actualizarProducto(productoId, {
          ...payload,
          estado_publicacion: this.form.estado_publicacion
        })
      : this.productosService.crearProducto(payload);

    request.subscribe({
      next: () => {
        this.toast.ok(productoId ? 'Producto actualizado.' : 'Producto publicado en la tienda.');
        this.guardando.set(false);
        this.modalAbierto.set(false);
        this.cargarProductos();
      },
      error: (err) => {
        this.toast.err(err.error?.error || 'No se pudo guardar el producto.');
        this.guardando.set(false);
      }
    });
  }

  pedirEliminar(producto: Producto): void {
    this.productoAEliminar.set(producto);
  }

  cancelarEliminar(): void {
    this.productoAEliminar.set(null);
  }

  confirmarEliminar(): void {
    const producto = this.productoAEliminar();
    if (!producto) return;

    this.productosService.eliminarProducto(producto.id).subscribe({
      next: () => {
        this.toast.ok('Producto eliminado.');
        this.productoAEliminar.set(null);
        this.cargarProductos();
      },
      error: (err) => {
        this.toast.err(err.error?.error || 'No se pudo eliminar el producto.');
        this.productoAEliminar.set(null);
      }
    });
  }

  imagenPrincipal(producto: Producto): string | null {
    return producto.imagenes?.[0] || null;
  }

  nombreCategoria(id: string): string {
    return this.categorias().find((categoria) => categoria.id === id)?.nombre || 'Sin categoría';
  }
}

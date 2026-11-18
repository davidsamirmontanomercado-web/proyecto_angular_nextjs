import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { FooterComponent } from '../../shared/footer/footer';
import { AuthService } from '../../services/auth.service';
import { ProductosService, Producto } from '../../services/productos.service';
import { CategoriasService, Categoria } from '../../services/categorias.service';
import { PedidosService } from '../../services/pedidos.service';
import { ToastService } from '../../services/toast.service';
import { Router } from '@angular/router';

interface ItemCarrito {
  producto: Producto;
  cantidad: number;
}

interface GrupoEmpresa {
  vendedorId: string;
  vendedorNombre: string;
  items: ItemCarrito[];
  subtotal: number;
}

@Component({
  selector: 'app-comprar-productos',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent, FooterComponent],
  templateUrl: './comprar-productos.html',
  styleUrl: './comprar-productos.css'
})
export class ComprarProductosComponent implements OnInit {
  auth = inject(AuthService);
  private productosService = inject(ProductosService);
  private categoriasService = inject(CategoriasService);
  private pedidosService = inject(PedidosService);
  private toast = inject(ToastService);
  private router = inject(Router);

  productos = signal<Producto[]>([]);
  categorias = signal<Categoria[]>([]);
  vendedores = signal<{ id: string; nombre: string }[]>([]);
  cargando = signal(true);
  enviandoPedido = signal(false);
  mostrarCheckout = signal(false);
  // Paso del checkout: primero se capturan/confirman los datos, luego se revisa
  // todo antes de enviar el pedido a la(s) empresa(s).
  pasoCheckout = signal<'datos' | 'revision'>('datos');
  
  // Filtros avanzados
  filtros = {
    q: '',
    categoria: '',
    vendedorId: '',
    orden: 'recientes',
    minPrecio: null as number | null,
    maxPrecio: null as number | null
  };

  ordenes = [
    { valor: 'recientes', etiqueta: 'Más recientes' },
    { valor: 'precio_asc', etiqueta: 'Precio: menor a mayor' },
    { valor: 'precio_desc', etiqueta: 'Precio: mayor a menor' },
    { valor: 'nombre_asc', etiqueta: 'Nombre: A - Z' }
  ];

  // Datos de entrega
  formEntrega = {
    ciudad: '',
    municipio: '',
    direccion: '',
    referencia_entrega: '',
    metodo_pago: 'transferencia'
  };

  carrito = signal<ItemCarrito[]>([]);
  cantidades = new Map<string, number>();

  ngOnInit() {
    this.cargarProductos();
    this.cargarCategorias();
    this.cargarVendedores();
    const saved = localStorage.getItem('lm_carrito');
    if (saved) {
      this.carrito.set(JSON.parse(saved));
    }
    const savedEntrega = localStorage.getItem('lm_entrega');
    if (savedEntrega) {
      try {
        this.formEntrega = { ...this.formEntrega, ...JSON.parse(savedEntrega) };
      } catch {
        // dato inválido en almacenamiento: se ignora.
      }
    }
  }

  cargarProductos() {
    this.cargando.set(true);
    const params: any = {};
    if (this.filtros.q) params.q = this.filtros.q;
    if (this.filtros.categoria) params.categoria = this.filtros.categoria;
    if (this.filtros.vendedorId) params.vendedorId = this.filtros.vendedorId;
    if (this.filtros.orden) params.orden = this.filtros.orden;
    if (this.filtros.minPrecio) params.minPrecio = this.filtros.minPrecio;
    if (this.filtros.maxPrecio) params.maxPrecio = this.filtros.maxPrecio;

    this.productosService.getProductos(params).subscribe({
      next: (res) => {
        this.productos.set(res.data);
        res.data.forEach(p => {
          if (!this.cantidades.has(p.id)) {
            this.cantidades.set(p.id, 1);
          }
        });
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false)
    });
  }

  cargarCategorias() {
    this.categoriasService.getCategorias().subscribe({
      next: (res) => this.categorias.set(res)
    });
  }

  /** Lista de empresas (vendedores) disponibles para el filtro "Tienda". */
  cargarVendedores() {
    this.productosService.getProductos().subscribe({
      next: (res) => {
        const mapa = new Map<string, string>();
        res.data.forEach(p => {
          if (p.vendedor_id && p.vendedor_nombre) {
            mapa.set(p.vendedor_id, p.vendedor_nombre);
          }
        });
        this.vendedores.set(
          Array.from(mapa, ([id, nombre]) => ({ id, nombre }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre))
        );
      }
    });
  }

  aplicarFiltros() {
    this.cargarProductos();
  }

  limpiarFiltros() {
    this.filtros = { q: '', categoria: '', vendedorId: '', orden: 'recientes', minPrecio: null, maxPrecio: null };
    this.cargarProductos();
  }

  get hayFiltrosActivos(): boolean {
    return !!(this.filtros.q || this.filtros.categoria || this.filtros.vendedorId ||
      this.filtros.minPrecio || this.filtros.maxPrecio || this.filtros.orden !== 'recientes');
  }

  agregarAlCarrito(producto: Producto) {
    const cantidad = this.cantidades.get(producto.id) || 1;
    const actual = this.carrito();
    const index = actual.findIndex(item => item.producto.id === producto.id);

    if (index > -1) {
      actual[index].cantidad += cantidad;
      this.carrito.set([...actual]);
    } else {
      this.carrito.set([...actual, { producto, cantidad }]);
    }
    this.save();
    this.toast.ok('Producto añadido al carrito');
  }

  /** Agrupa el carrito por empresa dueña de los productos. Cada grupo se
   *  convertirá en un pedido independiente dirigido a esa empresa. */
  get carritoPorEmpresa(): GrupoEmpresa[] {
    const grupos = new Map<string, GrupoEmpresa>();
    for (const item of this.carrito()) {
      const id = item.producto.vendedor_id || '';
      if (!grupos.has(id)) {
        grupos.set(id, {
          vendedorId: id,
          vendedorNombre: item.producto.vendedor_nombre || item.producto.vendedor?.nombre || 'Empresa',
          items: [],
          subtotal: 0
        });
      }
      const grupo = grupos.get(id)!;
      grupo.items.push(item);
      grupo.subtotal += item.producto.precio * item.cantidad;
    }
    return Array.from(grupos.values());
  }

  confirmarPedido() {
    if (!this.auth.isLoggedIn()) {
      this.toast.info('Debes iniciar sesión para realizar un pedido');
      this.router.navigate(['/login']);
      return;
    }
    if (this.carrito().length === 0) {
      this.toast.info('Tu carrito está vacío.');
      return;
    }
    this.pasoCheckout.set('datos');
    this.mostrarCheckout.set(true);
  }

  cerrarCheckout() {
    this.mostrarCheckout.set(false);
    this.pasoCheckout.set('datos');
  }

  /** Valida los datos de entrega/pago y pasa al resumen de confirmación. */
  irARevision() {
    if (!this.formEntrega.ciudad.trim() || !this.formEntrega.municipio.trim() || !this.formEntrega.direccion.trim()) {
      this.toast.err('Completa ciudad, municipio y dirección de entrega.');
      return;
    }
    if (!this.formEntrega.metodo_pago) {
      this.toast.err('Selecciona un método de pago.');
      return;
    }
    this.guardarEntrega();
    this.pasoCheckout.set('revision');
  }

  volverADatos() {
    this.pasoCheckout.set('datos');
  }

  private guardarEntrega() {
    try {
      localStorage.setItem('lm_entrega', JSON.stringify(this.formEntrega));
    } catch {
      // almacenamiento no disponible: no es crítico.
    }
  }

  realizarPedido() {
    if (!this.formEntrega.ciudad.trim() || !this.formEntrega.municipio.trim() || !this.formEntrega.direccion.trim()) {
      this.toast.err('Por favor completa todos los datos de entrega.');
      return;
    }

    this.enviandoPedido.set(true);

    const pedidoData = {
      ...this.formEntrega,
      items: this.carrito().map(item => ({
        producto_id: item.producto.id,
        vendedor_id: item.producto.vendedor_id,
        cantidad: item.cantidad,
        precio_unitario: item.producto.precio
      }))
    };

    this.pedidosService.crearPedido(pedidoData).subscribe({
      next: () => {
        const empresas = this.carritoPorEmpresa.length;
        this.toast.ok(empresas > 1
          ? `¡Pedido enviado a ${empresas} empresas con éxito!`
          : '¡Pedido enviado a la empresa con éxito!');
        this.carrito.set([]);
        this.save();
        this.cerrarCheckout();
        this.enviandoPedido.set(false);
        this.router.navigate(['/perfil']);
      },
      error: (err) => {
        console.error('Error al crear pedido:', err);
        this.toast.err(err.error?.error || 'No se pudo procesar el pedido.');
        this.enviandoPedido.set(false);
      }
    });
  }

  actualizarCantidad(index: number, delta: number) {
    const actual = this.carrito();
    const item = actual[index];
    const nuevaCantidad = item.cantidad + delta;

    if (nuevaCantidad > 0) {
      item.cantidad = nuevaCantidad;
      this.carrito.set([...actual]);
      this.save();
    }
  }

  eliminarDelCarrito(index: number) {
    const actual = this.carrito();
    actual.splice(index, 1);
    this.carrito.set([...actual]);
    this.save();
  }

  private save() {
    localStorage.setItem('lm_carrito', JSON.stringify(this.carrito()));
  }

  get total() {
    return this.carrito().reduce((sum, item) => sum + (item.producto.precio * item.cantidad), 0);
  }

  setCantidad(prodId: string, val: number) {
    if (val > 0) this.cantidades.set(prodId, val);
  }
}

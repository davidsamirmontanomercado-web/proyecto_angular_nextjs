import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { FooterComponent } from '../../shared/footer/footer';
import { PerfilService, PerfilData } from '../../services/perfil.service';
import { PedidosService, Pedido } from '../../services/pedidos.service';
import { ToastService } from '../../services/toast.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-perfil',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, NavbarComponent, FooterComponent],
  templateUrl: './perfil.html',
  styleUrl: './perfil.css'
})
export class PerfilComponent implements OnInit {
  auth = inject(AuthService);
  private perfilService = inject(PerfilService);
  private pedidosService = inject(PedidosService);
  private toast = inject(ToastService);

  perfil = signal<PerfilData | null>(null);
  pedidos = signal<Pedido[]>([]);
  cargando = signal(true);
  cargandoPedidos = signal(false);
  error = signal<string | null>(null);

  // --- Gestión de pedidos ---
  filtroEstado = signal<string>('todos');
  pedidoDetalle = signal<Pedido | null>(null);
  editandoEntrega = signal(false);
  guardandoPedido = signal(false);
  pedidoAEliminar = signal<Pedido | null>(null);

  formEdicion = {
    ciudad: '',
    municipio: '',
    direccion: '',
    referencia_entrega: '',
    metodo_pago: 'transferencia'
  };

  estados = [
    { valor: 'todos', etiqueta: 'Todos' },
    { valor: 'pendiente', etiqueta: 'Pendientes' },
    { valor: 'confirmado', etiqueta: 'Confirmados' },
    { valor: 'enviado', etiqueta: 'Enviados' },
    { valor: 'entregado', etiqueta: 'Entregados' },
    { valor: 'cancelado', etiqueta: 'Cancelados' }
  ];

  get nombreDisplay() {
    return this.perfil()?.perfilEmpresa?.nombre_empresa || this.perfil()?.usuario?.nombre || 'Usuario';
  }

  get initials() {
    return this.auth.initials(this.nombreDisplay);
  }

  /** true cuando la vista activa es la de vendedor (gestiona pedidos recibidos). */
  get esVistaVendedor() {
    return this.auth.esVendedorVista();
  }

  get pedidosFiltrados(): Pedido[] {
    const f = this.filtroEstado();
    return f === 'todos' ? this.pedidos() : this.pedidos().filter(p => p.estado === f);
  }

  ngOnInit() {
    this.cargarPerfil();
    this.cargarPedidos();
  }

  cargarPerfil() {
    this.cargando.set(true);
    this.perfilService.getPerfil().subscribe({
      next: (res) => {
        this.perfil.set(res.data);
        this.cargando.set(false);
      },
      error: (err) => {
        console.error('Error al cargar perfil:', err);
        this.error.set('No se pudo cargar la información del perfil.');
        this.cargando.set(false);
      }
    });
  }

  cargarPedidos() {
    this.cargandoPedidos.set(true);
    const rol = this.auth.esVendedorVista() ? 'vendedor' : 'comprador';
    this.pedidosService.getPedidos(rol).subscribe({
      next: (res) => {
        this.pedidos.set(res.data);
        this.cargandoPedidos.set(false);
      },
      error: (err) => {
        console.error('Error al cargar pedidos:', err);
        this.cargandoPedidos.set(false);
      }
    });
  }

  // --- Detalle / edición de un pedido ---

  abrirDetalle(pedido: Pedido) {
    this.pedidoDetalle.set(pedido);
    this.editandoEntrega.set(false);
    this.formEdicion = {
      ciudad: pedido.ciudad,
      municipio: pedido.municipio,
      direccion: pedido.direccion,
      referencia_entrega: pedido.referencia_entrega || '',
      metodo_pago: pedido.metodo_pago
    };
  }

  cerrarDetalle() {
    this.pedidoDetalle.set(null);
    this.editandoEntrega.set(false);
  }

  iniciarEdicion() {
    this.editandoEntrega.set(true);
  }

  cancelarEdicion() {
    const pedido = this.pedidoDetalle();
    if (pedido) {
      this.formEdicion = {
        ciudad: pedido.ciudad,
        municipio: pedido.municipio,
        direccion: pedido.direccion,
        referencia_entrega: pedido.referencia_entrega || '',
        metodo_pago: pedido.metodo_pago
      };
    }
    this.editandoEntrega.set(false);
  }

  /** Guarda los datos de entrega editados por el comprador (pedido pendiente). */
  guardarEntrega() {
    const pedido = this.pedidoDetalle();
    if (!pedido) return;

    if (!this.formEdicion.ciudad.trim() || !this.formEdicion.municipio.trim() || !this.formEdicion.direccion.trim()) {
      this.toast.err('Completa ciudad, municipio y dirección.');
      return;
    }

    this.guardandoPedido.set(true);
    this.pedidosService.actualizarEntrega(pedido.id, this.formEdicion).subscribe({
      next: () => {
        this.toast.ok('Datos de entrega actualizados.');
        this.guardandoPedido.set(false);
        this.cerrarDetalle();
        this.cargarPedidos();
      },
      error: (err) => {
        this.toast.err(err.error?.error || 'No se pudo actualizar la entrega.');
        this.guardandoPedido.set(false);
      }
    });
  }

  actualizarEstadoPedido(id: number, nuevoEstado: string) {
    this.pedidosService.actualizarEstado(id, nuevoEstado).subscribe({
      next: () => {
        this.toast.ok(`Pedido actualizado a ${this.etiquetaEstado(nuevoEstado).toLowerCase()}`);
        this.cerrarDetalle();
        this.cargarPedidos();
      },
      error: (err) => {
        this.toast.err(err.error?.error || 'No se pudo actualizar el estado del pedido.');
      }
    });
  }

  // --- Eliminar pedido (con modal propio, sin confirm() nativo) ---

  pedirEliminar(pedido: Pedido) {
    this.pedidoAEliminar.set(pedido);
  }

  cancelarEliminar() {
    this.pedidoAEliminar.set(null);
  }

  confirmarEliminar() {
    const pedido = this.pedidoAEliminar();
    if (!pedido) return;

    this.pedidosService.eliminarPedido(pedido.id).subscribe({
      next: () => {
        this.toast.ok('Pedido eliminado.');
        this.pedidoAEliminar.set(null);
        this.cerrarDetalle();
        this.cargarPedidos();
      },
      error: (err) => {
        this.toast.err(err.error?.error || 'No se pudo eliminar el pedido.');
        this.pedidoAEliminar.set(null);
      }
    });
  }

  getEstadoColor(estado: string): string {
    switch (estado) {
      case 'pendiente': return '#f59e0b';
      case 'confirmado': return '#3b82f6';
      case 'enviado': return '#8b5cf6';
      case 'entregado': return '#10b981';
      case 'cancelado': return '#ef4444';
      default: return '#6b7280';
    }
  }

  etiquetaEstado(estado: string): string {
    switch (estado) {
      case 'pendiente': return 'Pendiente';
      case 'confirmado': return 'Confirmado';
      case 'enviado': return 'Enviado';
      case 'entregado': return 'Entregado';
      case 'cancelado': return 'Cancelado';
      default: return estado;
    }
  }

  /** El comprador puede editar la entrega mientras el pedido esté pendiente. */
  get puedeEditarEntrega(): boolean {
    const p = this.pedidoDetalle();
    return !!p && !this.esVistaVendedor && p.estado === 'pendiente';
  }

  /** Se puede eliminar si no está en camino/entregado. */
  puedeEliminar(pedido: Pedido): boolean {
    if (pedido.estado === 'enviado' || pedido.estado === 'entregado') return false;
    if (this.esVistaVendedor) return pedido.estado === 'cancelado';
    return true;
  }
}

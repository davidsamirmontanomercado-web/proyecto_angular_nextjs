import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { ToastService } from '../../services/toast.service';
import { Transmision, TransmisionesService } from '../../services/transmisiones.service';
import { CategoriasService } from '../../services/categorias.service';

/** Item del carrito tal y como se guarda en localStorage (`lm_carrito`). */
interface ItemCarrito {
  producto: { nombre: string; precio: number };
  cantidad: number;
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, NavbarComponent, DecimalPipe, CurrencyPipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class DashboardComponent implements OnInit {
  auth = inject(AuthService);
  private transmisiones = inject(TransmisionesService);
  private categorias = inject(CategoriasService);
  private toast = inject(ToastService);

  nombre = '';
  misTransmisiones = signal<Transmision[]>([]);
  cargando = signal(false);
  accionandoId = signal<string | null>(null);

  // Datos reales del comprador
  carrito = signal<ItemCarrito[]>([]);
  enVivosAhora = signal(0);
  totalCategorias = signal(0);

  // Datos reales del administrador
  usuariosTotal = signal(0);
  solicitudes = signal<any[]>([]);
  transmisionesTotal = signal(0);

  // KPIs derivados únicamente de datos reales de "Mis transmisiones".
  totalTransmisiones = computed(() => this.misTransmisiones().length);
  enVivo = computed(() => this.misTransmisiones().filter((t) => t.estado === 'en_vivo').length);
  finalizadas = computed(() => this.misTransmisiones().filter((t) => t.estado === 'finalizada').length);
  espectadoresTotales = computed(() =>
    this.misTransmisiones().reduce((suma, t) => suma + (t.espectadores_totales ?? 0), 0)
  );

  // KPIs derivados del carrito local del comprador.
  itemsCarrito = computed(() => this.carrito().reduce((suma, i) => suma + i.cantidad, 0));
  valorCarrito = computed(() =>
    this.carrito().reduce((suma, i) => suma + i.producto.precio * i.cantidad, 0)
  );

  ngOnInit() {
    const u = this.auth.currentUser();
    if (u) this.nombre = u.nombre || u.correo.split('@')[0];

    // Se cargan ambos conjuntos: así el administrador puede alternar de vista
    // sin recargar la página y ver la información correcta al instante.
    this.cargarMias();
    this.cargarComprador();
    this.cargarAdmin();
  }

  cargarMias() {
    this.cargando.set(true);
    this.transmisiones.getMias().subscribe({
      next: (data) => {
        this.misTransmisiones.set(data);
        this.cargando.set(false);
      },
      error: (err) => {
        this.cargando.set(false);
        console.error('Error al cargar mis transmisiones:', err);
        this.toast.err('No se pudieron cargar tus transmisiones.');
      }
    });
  }

  /** Datos reales para la vista de comprador: carrito local, en vivos y categorías. */
  cargarComprador() {
    try {
      const saved = localStorage.getItem('lm_carrito');
      this.carrito.set(saved ? JSON.parse(saved) : []);
    } catch {
      this.carrito.set([]);
    }

    this.transmisiones.getTransmisiones({ estado: 'en_vivo' }).subscribe({
      next: (res) => this.enVivosAhora.set(res.data?.length ?? 0),
      error: () => this.enVivosAhora.set(0)
    });

    this.categorias.getCategorias().subscribe({
      next: (cats) => this.totalCategorias.set(cats.length),
      error: () => this.totalCategorias.set(0)
    });
  }

  /** Datos reales del panel de administración (sólo si el rol es administrador). */
  async cargarAdmin() {
    if (!this.auth.esAdmin()) return;

    await this.auth.ensureFreshToken();

    const [usuarios, solicitudes] = await Promise.all([
      this.auth.listarUsuariosAdmin(),
      this.auth.listarSolicitudesAdmin()
    ]);

    if (usuarios.ok) this.usuariosTotal.set(usuarios.usuarios?.length ?? 0);
    if (solicitudes.ok) this.solicitudes.set(solicitudes.solicitudes ?? []);

    this.transmisiones.getTransmisiones().subscribe({
      next: (res) => this.transmisionesTotal.set(res.data?.length ?? 0),
      error: () => this.transmisionesTotal.set(0)
    });
  }

  iniciar(id: string) {
    if (this.accionandoId()) return;
    this.accionandoId.set(id);
    this.transmisiones.iniciar(id).subscribe({
      next: () => {
        this.accionandoId.set(null);
        this.toast.ok('Transmisión en vivo');
        this.cargarMias();
      },
      error: (err) => {
        this.accionandoId.set(null);
        this.toast.err(err?.error?.error || 'No se pudo iniciar la transmisión.');
      }
    });
  }

  finalizar(id: string) {
    if (this.accionandoId()) return;
    this.accionandoId.set(id);
    this.transmisiones.finalizar(id).subscribe({
      next: () => {
        this.accionandoId.set(null);
        this.toast.ok('Transmisión finalizada');
        this.cargarMias();
      },
      error: (err) => {
        this.accionandoId.set(null);
        this.toast.err(err?.error?.error || 'No se pudo finalizar la transmisión.');
      }
    });
  }

  icono(estado: string | null): string {
    if (estado === 'en_vivo') return '🔴';
    if (estado === 'programada') return '🗓️';
    return '🎥';
  }

  etiqueta(estado: string | null): string {
    switch (estado) {
      case 'en_vivo':
        return 'EN VIVO';
      case 'programada':
        return 'Programada';
      case 'finalizada':
        return 'Finalizado';
      default:
        return estado ?? '—';
    }
  }

  claseBadge(estado: string | null): string {
    return estado === 'en_vivo' ? 'badge badge-live' : 'badge badge-soft';
  }

  meta(t: Transmision): string {
    const partes: string[] = [];
    const fecha = t.fecha_inicio || t.fecha_creacion;
    if (fecha) {
      const d = new Date(fecha);
      if (!Number.isNaN(d.getTime())) {
        partes.push(d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }));
      }
    }
    if (t.duracion_minutos != null) partes.push(`${t.duracion_minutos} min`);
    if (t.espectadores_totales != null) partes.push(`${t.espectadores_totales} espectadores`);
    return partes.join(' · ') || 'Sin programar';
  }

  logout() {
    this.auth.logout();
  }
}

import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { ToastService } from '../../services/toast.service';
import { Transmision, TransmisionesService } from '../../services/transmisiones.service';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, NavbarComponent, DecimalPipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class DashboardComponent implements OnInit {
  auth = inject(AuthService);
  private transmisiones = inject(TransmisionesService);
  private toast = inject(ToastService);

  nombre = '';
  misTransmisiones = signal<Transmision[]>([]);
  cargando = signal(false);
  accionandoId = signal<string | null>(null);

  // KPIs derivados únicamente de datos reales de "Mis transmisiones".
  totalTransmisiones = computed(() => this.misTransmisiones().length);
  enVivo = computed(() => this.misTransmisiones().filter((t) => t.estado === 'en_vivo').length);
  finalizadas = computed(() => this.misTransmisiones().filter((t) => t.estado === 'finalizada').length);
  espectadoresTotales = computed(() =>
    this.misTransmisiones().reduce((suma, t) => suma + (t.espectadores_totales ?? 0), 0)
  );

  ngOnInit() {
    const u = this.auth.currentUser();
    if (u) this.nombre = u.nombre || u.correo.split('@')[0];
    this.cargarMias();
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

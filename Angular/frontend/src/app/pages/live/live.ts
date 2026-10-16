import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { FooterComponent } from '../../shared/footer/footer';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import {
  AnfitrionPublico,
  Transmision,
  TransmisionesService
} from '../../services/transmisiones.service';
import { MensajeChat, MensajesChatService } from '../../services/mensajes-chat.service';
import { ReaccionesService } from '../../services/reacciones.service';
import { SeguimientosService } from '../../services/seguimientos.service';

interface Recomendado {
  id: string;
  titulo: string;
  categoria: string;
  espectadores: number;
}

interface ErrorHttp {
  status?: number;
  error?: { error?: string };
}

@Component({
  selector: 'app-live',
  imports: [RouterLink, NavbarComponent, FooterComponent, FormsModule],
  templateUrl: './live.html',
  styleUrl: './live.css'
})
export class LiveComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private transmisiones = inject(TransmisionesService);
  private chat = inject(MensajesChatService);
  private reacciones = inject(ReaccionesService);
  private seguimientos = inject(SeguimientosService);
  private toast = inject(ToastService);
  auth = inject(AuthService);

  /** Señal reactiva de sesión; se usa en la plantilla para mostrar/ocultar acciones. */
  readonly haySesion = this.auth.isLoggedIn;

  transmisionId = '';
  transmision = signal<Transmision | null>(null);
  anfitrion = signal<AnfitrionPublico | null>(null);
  anfitrionAviso = signal<string | null>(null);
  recomendados = signal<Recomendado[]>([]);

  loading = signal(false);
  error = signal<string | null>(null);
  noDisponible = signal(false);

  // Chat
  chatVisible = true;
  mensajes = signal<MensajeChat[]>([]);
  chatCargando = signal(false);
  chatError = signal<string | null>(null);
  nuevoMensaje = '';
  enviando = signal(false);

  // Reacción (me gusta)
  likes = signal(false);
  likeProcesando = signal(false);

  // Seguimiento del anfitrión
  siguiendo = signal(false);
  esPropietario = signal(false);
  seguirProcesando = signal(false);

  private MAX_MENSAJE = 1000;
  private readonly POLL_MS = 8000;
  private routeSub?: Subscription;
  private pollId: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.routeSub = this.route.paramMap.subscribe((pm) => {
      const id = pm.get('id') ?? '';
      this.cargarTodo(id);
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    this.detenerPoll();
  }

  // ---- Carga principal ----------------------------------------------------
  private cargarTodo(id: string): void {
    this.detenerPoll();
    this.transmisionId = id;
    this.transmision.set(null);
    this.anfitrion.set(null);
    this.anfitrionAviso.set(null);
    this.mensajes.set([]);
    this.chatError.set(null);
    this.likes.set(false);
    this.siguiendo.set(false);
    this.esPropietario.set(false);
    this.error.set(null);
    this.noDisponible.set(false);

    if (!id) {
      this.error.set('No se indicó ninguna transmisión.');
      return;
    }

    this.loading.set(true);
    this.transmisiones.getById(id).subscribe({
      next: (t) => {
        this.transmision.set(t);
        this.loading.set(false);
        this.cargarAnfitrion(id);
        this.cargarRecomendados(id);
        if (this.haySesion()) {
          this.cargarMensajes(id);
          this.cargarEstadoLike(id);
          this.cargarEstadoSeguimiento(id);
          this.iniciarPoll(id);
        }
      },
      error: (err: ErrorHttp) => {
        this.loading.set(false);
        if (err?.status === 404) {
          this.noDisponible.set(true);
          return;
        }
        this.error.set('No se pudo cargar la transmisión. Inténtalo más tarde.');
      }
    });
  }

  private cargarAnfitrion(id: string): void {
    this.transmisiones.getAnfitrion(id).subscribe({
      next: (a) => this.anfitrion.set(a),
      error: (err: ErrorHttp) => {
        // La info del anfitrión es secundaria: si falla (p. ej. 503 por migración
        // pendiente), la página sigue funcionando y se avisa en la interfaz.
        console.warn('No se pudo cargar la información pública del anfitrión:', err);
        this.anfitrion.set(null);
        this.anfitrionAviso.set(
          err?.status === 503
            ? 'La información del anfitrión aún no está disponible.'
            : 'No se pudo cargar la información del anfitrión.'
        );
      }
    });
  }

  private cargarRecomendados(id: string): void {
    this.transmisiones.getAll().subscribe({
      next: (lista) => {
        this.recomendados.set(
          lista
            .filter((t) => t.id !== id)
            .slice(0, 4)
            .map((t) => ({
              id: t.id,
              titulo: t.titulo?.trim() || 'Sin título',
              categoria: t.categoria?.nombre?.trim() || '',
              espectadores: t.espectadores_actuales ?? t.espectadores_totales ?? 0
            }))
        );
      },
      error: (err) => {
        console.warn('No se pudieron cargar las transmisiones recomendadas:', err);
        this.recomendados.set([]);
      }
    });
  }

  // ---- Chat ---------------------------------------------------------------
  private cargarMensajes(id: string): void {
    if (this.chatCargando()) return;
    this.chatCargando.set(true);
    this.chat.listar(id).subscribe({
      next: (ms) => {
        this.mensajes.set(ms);
        this.chatError.set(null);
        this.chatCargando.set(false);
      },
      error: (err: ErrorHttp) => {
        this.chatError.set(this.mensajeError(err, 'No se pudo cargar el chat.'));
        this.chatCargando.set(false);
      }
    });
  }

  enviarMensaje(): void {
    if (this.enviando()) return;
    if (!this.haySesion()) {
      this.toast.err('Inicia sesión para enviar mensajes.');
      return;
    }
    const texto = this.nuevoMensaje.trim();
    if (!texto) return;
    if (texto.length > this.MAX_MENSAJE) {
      this.toast.err(`El mensaje no puede superar los ${this.MAX_MENSAJE} caracteres.`);
      return;
    }

    this.enviando.set(true);
    this.chat.enviar(this.transmisionId, texto).subscribe({
      next: () => {
        this.enviando.set(false);
        this.nuevoMensaje = '';
        this.cargarMensajes(this.transmisionId);
      },
      error: (err: ErrorHttp) => {
        this.enviando.set(false);
        this.toast.err(this.mensajeError(err, 'No se pudo enviar el mensaje.'));
      }
    });
  }

  // ---- Me gusta -----------------------------------------------------------
  private cargarEstadoLike(id: string): void {
    this.reacciones.meGusta(id).subscribe({
      next: (v) => this.likes.set(v),
      error: (err: ErrorHttp) => console.warn('No se pudo consultar el me gusta:', err)
    });
  }

  toggleLike(): void {
    if (this.likeProcesando()) return;
    if (!this.haySesion()) {
      this.toast.err('Inicia sesión para reaccionar.');
      return;
    }
    this.likeProcesando.set(true);
    const operacion = this.likes()
      ? this.reacciones.quitarMeGusta(this.transmisionId)
      : this.reacciones.darMeGusta(this.transmisionId);

    operacion.subscribe({
      next: (v) => {
        this.likes.set(v);
        this.likeProcesando.set(false);
      },
      error: (err: ErrorHttp) => {
        this.likeProcesando.set(false);
        this.toast.err(this.mensajeError(err, 'No se pudo actualizar el me gusta.'));
      }
    });
  }

  // ---- Seguimiento del anfitrión -----------------------------------------
  private cargarEstadoSeguimiento(id: string): void {
    this.seguimientos.estadoDeTransmision(id).subscribe({
      next: ({ siguiendo, esPropietario }) => {
        this.siguiendo.set(siguiendo);
        this.esPropietario.set(esPropietario);
      },
      error: (err: ErrorHttp) => console.warn('No se pudo consultar el seguimiento:', err)
    });
  }

  toggleSub(): void {
    if (this.seguirProcesando() || this.esPropietario()) return;
    if (!this.haySesion()) {
      this.toast.err('Inicia sesión para seguir al anfitrión.');
      return;
    }
    this.seguirProcesando.set(true);
    const operacion = this.siguiendo()
      ? this.seguimientos.dejarDeSeguirTransmision(this.transmisionId)
      : this.seguimientos.seguirTransmision(this.transmisionId);

    operacion.subscribe({
      next: (v) => {
        this.siguiendo.set(v);
        this.seguirProcesando.set(false);
      },
      error: (err: ErrorHttp) => {
        this.seguirProcesando.set(false);
        this.toast.err(this.mensajeError(err, 'No se pudo actualizar el seguimiento.'));
      }
    });
  }

  // ---- Utilidades ---------------------------------------------------------
  toggleChat(): void {
    this.chatVisible = !this.chatVisible;
  }

  private iniciarPoll(id: string): void {
    this.detenerPoll();
    this.pollId = setInterval(() => {
      // Sólo refresca si el chat está visible y no hay una carga en curso.
      if (this.chatVisible && !this.chatCargando()) this.cargarMensajes(id);
    }, this.POLL_MS);
  }

  private detenerPoll(): void {
    if (this.pollId !== null) {
      clearInterval(this.pollId);
      this.pollId = null;
    }
  }

  get nombreAnfitrion(): string {
    const a = this.anfitrion();
    if (!a) return 'Anfitrión';
    return a.nombre_empresa?.trim() || a.anfitrion_nombre?.trim() || 'Anfitrión';
  }

  get espectadores(): number {
    const t = this.transmision();
    return t?.espectadores_actuales ?? t?.espectadores_totales ?? 0;
  }

  get iniciadaHace(): string {
    const t = this.transmision();
    if (!t?.fecha_inicio) return '';
    const ms = Date.now() - new Date(t.fecha_inicio).getTime();
    if (Number.isNaN(ms) || ms < 0) return '';
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'hace unos segundos';
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h} h`;
    return `hace ${Math.floor(h / 24)} d`;
  }

  esMio(m: MensajeChat): boolean {
    return !!this.auth.currentUser()?.id && m.remitente_id === this.auth.currentUser()?.id;
  }

  private mensajeError(err: ErrorHttp, fallback: string): string {
    if (err?.status === 401) return 'Tu sesión ha caducado. Inicia sesión de nuevo.';
    if (err?.status === 403) return 'No tienes permisos para esta acción.';
    return err?.error?.error || fallback;
  }
}

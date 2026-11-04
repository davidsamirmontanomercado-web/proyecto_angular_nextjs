import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  effect,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subscription, firstValueFrom } from 'rxjs';
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { FooterComponent } from '../../shared/footer/footer';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import {
  AnfitrionPublico,
  RolLiveKit,
  TokenLiveKit,
  Transmision,
  TransmisionesService
} from '../../services/transmisiones.service';
import { MensajeChat, MensajesChatService } from '../../services/mensajes-chat.service';
import { ReaccionesService, ResumenReacciones } from '../../services/reacciones.service';
import { SeguimientosService } from '../../services/seguimientos.service';

interface Recomendado {
  id: string;
  titulo: string;
  categoria: string;
  espectadores: number;
}

interface ErrorHttp {
  status?: number;
  name?: string;
  error?: { error?: string };
}

/** Estado de la conexión con la sala de LiveKit. */
type EstadoLiveKit = 'inactivo' | 'conectando' | 'conectado' | 'reconectando' | 'error';

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

  /** Vídeo local del anfitrión (pista publicada; NO es la portada). */
  private readonly videoLocalRef = viewChild<ElementRef<HTMLVideoElement>>('videoLocal');
  /** Vídeo remoto: lo que el espectador recibe del anfitrión. */
  private readonly videoRemotoRef = viewChild<ElementRef<HTMLVideoElement>>('videoRemoto');

  /**
   * ¿Hay una sesión utilizable para las consultas "por usuario" (me gusta,
   * seguimiento, chat, presencia)? No basta con que exista un token local: si
   * está caducado y no hay refresh_token, el backend respondería 401 y la
   * consola se llenaría de errores. Se usa esta señal (y no `isLoggedIn`) para
   * decidir qué se pide; `isLoggedIn` sigue indicando "usuario identificado".
   */
  readonly haySesion = this.auth.sesionUtilizable;

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

  // Reacción (me gusta) + resumen agregado
  likes = signal(false);
  likeProcesando = signal(false);
  likesTotal = signal(0);
  likesAutores = signal<string[]>([]);

  // Espectadores (contadores reales)
  espectadoresActuales = signal(0);
  espectadoresTotales = signal(0);

  // Seguimiento del anfitrión
  siguiendo = signal(false);
  esPropietario = signal(false);
  seguirProcesando = signal(false);

  // Anfitrión: control de su propia emisión
  accionando = signal(false);
  camaraActiva = signal(false);
  camaraError = signal<string | null>(null);

  // Emisión en tiempo real (LiveKit)
  /** Rol concedido por el backend para la sala ('anfitrion' | 'espectador'). */
  rolLiveKit = signal<RolLiveKit | null>(null);
  livekitEstado = signal<EstadoLiveKit>('inactivo');
  livekitError = signal<string | null>(null);
  /** Llega video del anfitrión (espectador). */
  videoRemotoActivo = signal(false);
  /** El navegador bloqueó el audio: hace falta un gesto del usuario. */
  audioBloqueado = signal(false);
  micActivo = signal(false);

  /** El live ha dejado de estar en vivo (lo finalizó el anfitrión). */
  finalizada = signal(false);
  /** Aviso del heartbeat de presencia cuando el fallo no es recuperable. */
  presenciaError = signal<string | null>(null);
  /** Aviso cuando la sesión local ya no es utilizable (token caducado). */
  avisoSesion = signal<string | null>(null);

  private MAX_MENSAJE = 1000;
  private readonly POLL_MS = 8000;
  private readonly PRESENCIA_MS = 20000;
  /** Fallos consecutivos de heartbeat antes de dejar de reintentar. */
  private readonly PRESENCIA_MAX_FALLOS = 3;
  private readonly MSG_SESION_CADUCADA =
    'Tu sesión ha caducado. Inicia sesión de nuevo para reaccionar, seguir al anfitrión o participar en el chat.';
  private routeSub?: Subscription;
  private pollId: ReturnType<typeof setInterval> | null = null;
  private presenciaId: ReturnType<typeof setInterval> | null = null;
  private mediaStream: MediaStream | null = null;
  /** Hay una presencia propia registrada pendiente de marcar salida. */
  private presenciaIniciada = false;
  private presenciaFallos = 0;
  /** Evita solapar consultas de estado en el sondeo. */
  private estadoConsultando = false;
  /** Evita dos inicializaciones simultáneas de getUserMedia. */
  private camaraIniciando = false;
  private camaraTimer: ReturnType<typeof setTimeout> | null = null;

  // LiveKit: una única sala y un único juego de listeners por conexión.
  private room: Room | null = null;
  private conectandoLiveKit = false;
  private limpiarEventosSala: (() => void) | null = null;
  /** Pistas remotas suscritas (se enganchan al <video> del espectador). */
  private readonly pistasRemotas = signal<RemoteTrack[]>([]);
  /** Pista de cámara local del anfitrión que se está publicando. */
  private readonly pistaVideoLocal = signal<Track | null>(null);

  constructor() {
    // Los <video> viven dentro de @if, así que se recrean al cambiar de estado:
    // al (re)aparecer el elemento se vuelve a enganchar la pista vigente.
    effect(() => {
      const el = this.videoLocalRef()?.nativeElement;
      const pista = this.pistaVideoLocal();
      if (!el) return;
      if (pista) pista.attach(el);
      else if (!this.mediaStream) el.srcObject = null;
    });
    effect(() => {
      const el = this.videoRemotoRef()?.nativeElement;
      const pistas = this.pistasRemotas();
      if (!el) return;
      if (pistas.length === 0) {
        el.srcObject = null;
        return;
      }
      // `attach` mezcla audio y video en el mismo MediaStream del elemento.
      pistas.forEach((p) => p.attach(el));
    });
  }

  ngOnInit(): void {
    this.routeSub = this.route.paramMap.subscribe((pm) => {
      const id = pm.get('id') ?? '';
      this.cargarTodo(id);
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    this.detenerPoll();
    this.detenerPresencia(true);
    this.detenerCamara();
    // Cierra la sala, detiene las pistas locales y retira los listeners.
    void this.desconectarLiveKit();
  }

  // ---- Carga principal ----------------------------------------------------
  private cargarTodo(id: string): void {
    this.detenerPoll();
    this.detenerPresencia(false);
    this.transmisionId = id;
    this.transmision.set(null);
    this.anfitrion.set(null);
    this.anfitrionAviso.set(null);
    this.mensajes.set([]);
    this.chatError.set(null);
    this.likes.set(false);
    this.likesTotal.set(0);
    this.likesAutores.set([]);
    this.espectadoresActuales.set(0);
    this.espectadoresTotales.set(0);
    this.siguiendo.set(false);
    this.esPropietario.set(false);
    this.error.set(null);
    this.noDisponible.set(false);
    this.finalizada.set(false);
    this.presenciaError.set(null);
    this.avisoSesion.set(null);
    this.presenciaFallos = 0;
    this.estadoConsultando = false;
    // Al cambiar de transmisión no debe quedar ninguna captura ni latido previos.
    this.detenerCamara();
    void this.desconectarLiveKit();

    if (!id) {
      this.error.set('No se indicó ninguna transmisión.');
      return;
    }

    this.loading.set(true);
    this.transmisiones.getById(id).subscribe({
      next: (t) => {
        this.transmision.set(t);
        this.espectadoresActuales.set(t.espectadores_actuales ?? 0);
        this.espectadoresTotales.set(t.espectadores_totales ?? 0);
        this.likesTotal.set(t.reacciones_total ?? 0);
        this.likesAutores.set(t.reacciones_autores ?? []);
        this.loading.set(false);
        this.cargarAnfitrion(id);
        this.cargarRecomendados(id);

        // El propietario puede abrir una transmisión ya finalizada desde su
        // panel: se muestra el cierre sin montar cámara, presencia ni sondeo.
        if (t.estado === 'finalizada') {
          this.marcarFinalizada();
          return;
        }

        // El sondeo del estado se activa para cualquier espectador (también sin
        // sesión) para que detecte el cierre del live.
        this.iniciarPoll(id);

        // Emisión en tiempo real: sólo con sesión (el backend exige
        // autenticación para emitir el token) y si ya está en vivo.
        if (t.estado === 'en_vivo') this.sincronizarLiveKit();

        if (this.haySesion()) {
          this.cargarMensajes(id);
          this.cargarEstadoLike(id);
          // El seguimiento resuelve también la propiedad de la transmisión: de
          // ahí sale si corresponde registrar presencia (el anfitrión no cuenta).
          this.cargarEstadoSeguimiento(id);
        } else if (this.auth.isLoggedIn()) {
          // Hay usuario y token locales, pero la sesión ya no es utilizable: se
          // descartan las credenciales inservibles (si no, el guard de /login
          // seguiría dando al usuario por "logueado" y no podría volver a
          // entrar) y se informa sin lanzar las consultas "por usuario".
          this.auth.clearSession();
          this.avisoSesion.set(this.MSG_SESION_CADUCADA);
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
              espectadores: t.espectadores_actuales ?? 0
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
      error: (err: ErrorHttp) => {
        // Estado neutro: no se sabe si el usuario reaccionó.
        this.likes.set(false);
        if (this.esErrorDeSesion(err)) {
          this.marcarSesionCaducada();
          return;
        }
        console.warn('No se pudo consultar el me gusta:', err?.status);
      }
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
      next: (resumen: ResumenReacciones) => {
        this.likes.set(resumen.me_gusta);
        this.likesTotal.set(resumen.total);
        this.likesAutores.set(resumen.autores);
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
        // Sólo se registra presencia quien NO es el anfitrión de la emisión.
        if (!esPropietario) this.iniciarPresencia(id);
      },
      error: (err: ErrorHttp) => {
        // Estado neutro: sin este dato no se conoce el seguimiento ni la propiedad.
        this.siguiendo.set(false);
        this.esPropietario.set(false);
        // Un 401/403 indica sesión inválida: pedir la presencia también fallaría
        // (otro 401) y llenaría la consola de errores. Sólo se pide la presencia
        // ante fallos de otro tipo (p. ej. la vista aún no disponible).
        if (this.esErrorDeSesion(err)) {
          this.marcarSesionCaducada();
          return;
        }
        console.warn('No se pudo consultar el seguimiento:', err?.status);
        // Sin este dato no se puede saber si la transmisión es propia: se pide
        // la presencia igualmente y el backend excluye al anfitrión.
        this.iniciarPresencia(id);
      }
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

  // ---- Sesión no utilizable ----------------------------------------------
  /** ¿El fallo corresponde a una sesión inválida (token caducado o sin permisos)? */
  private esErrorDeSesion(err: ErrorHttp): boolean {
    return err?.status === 401 || err?.status === 403;
  }

  /**
   * La sesión local ya no sirve: se avisa una vez en la interfaz y se detiene
   * el heartbeat. No se reintenta ni se encadenan más peticiones autenticadas.
   */
  private marcarSesionCaducada(): void {
    this.avisoSesion.set(this.MSG_SESION_CADUCADA);
    this.detenerPresencia(false);
  }

  // ---- Espectadores (heartbeat real) --------------------------------------
  private iniciarPresencia(id: string): void {
    // El anfitrión no es espectador de su propia emisión (el backend lo excluye
    // igualmente): sin sesión o siendo dueño no se manda ningún latido.
    if (!this.haySesion() || this.esPropietario() || this.finalizada()) return;

    this.detenerPresencia(false);
    this.presenciaFallos = 0;
    this.presenciaError.set(null);
    this.presenciaIniciada = true;
    this.enviarLatido(id);
    this.presenciaId = setInterval(() => this.enviarLatido(id), this.PRESENCIA_MS);
  }

  private enviarLatido(id: string): void {
    this.transmisiones.entrarPresencia(id).subscribe({
      next: ({ actuales, totales }) => {
        this.presenciaFallos = 0;
        this.espectadoresActuales.set(actuales);
        this.espectadoresTotales.set(totales);
      },
      error: (err: ErrorHttp) => this.manejarFalloPresencia(err)
    });
  }

  /**
   * Reintento acotado del heartbeat: los errores definitivos (sesión, permisos,
   * transmisión finalizada) detienen el latido de inmediato; los transitorios
   * se reintentan como máximo `PRESENCIA_MAX_FALLOS` veces (una por intervalo).
   */
  private manejarFalloPresencia(err: ErrorHttp): void {
    console.warn('No se pudo registrar la presencia:', err?.status);

    if (err?.status === 401 || err?.status === 403 || err?.status === 409) {
      this.detenerPresencia(false);
      this.presenciaError.set(
        err.status === 401
          ? 'Tu sesión ha caducado: vuelve a iniciar sesión para contarte como espectador.'
          : 'No se pudo registrar tu presencia en la transmisión.'
      );
      return;
    }

    this.presenciaFallos += 1;
    if (this.presenciaFallos >= this.PRESENCIA_MAX_FALLOS) {
      this.detenerPresencia(false);
      this.presenciaError.set(
        'No se pudo mantener el contador de espectadores. El live sigue funcionando.'
      );
    }
  }

  /** Detiene el heartbeat. Si `avisarSalida` es true, marca la salida (deja de contar). */
  private detenerPresencia(avisarSalida: boolean): void {
    if (this.presenciaId !== null) {
      clearInterval(this.presenciaId);
      this.presenciaId = null;
    }
    if (avisarSalida && this.presenciaIniciada && this.transmisionId && this.haySesion()) {
      this.transmisiones.salirPresencia(this.transmisionId).subscribe({
        error: () => undefined
      });
    }
    this.presenciaIniciada = false;
  }

  // ---- Anfitrión: su propia emisión ---------------------------------------
  get esAnfitrion(): boolean {
    return this.esPropietario();
  }

  get enVivo(): boolean {
    return this.transmision()?.estado === 'en_vivo';
  }

  iniciarTransmision(): void {
    if (this.accionando()) return;
    this.accionando.set(true);
    this.transmisiones.iniciar(this.transmisionId).subscribe({
      next: () => {
        this.accionando.set(false);
        this.toast.ok('Transmisión en vivo');
        this.recargarTransmision();
      },
      error: (err: ErrorHttp) => {
        this.accionando.set(false);
        this.toast.err(this.mensajeError(err, 'No se pudo iniciar la transmisión.'));
      }
    });
  }

  finalizarTransmision(): void {
    if (this.accionando()) return;
    this.accionando.set(true);
    this.transmisiones.finalizar(this.transmisionId).subscribe({
      next: () => {
        this.accionando.set(false);
        this.toast.ok('Transmisión finalizada');
        // El backend ya persistió 'finalizada': aquí se liberan cámara,
        // micrófono, presencia y sondeo de inmediato.
        this.marcarFinalizada();
      },
      error: (err: ErrorHttp) => {
        this.accionando.set(false);
        this.toast.err(this.mensajeError(err, 'No se pudo finalizar la transmisión.'));
      }
    });
  }

  /**
   * Cierre local del live (lo detecta el anfitrión al finalizar o el espectador
   * al comprobar que la transmisión ya no está en vivo). Detiene captura,
   * heartbeat y sondeo, y libera los recursos multimedia.
   */
  private marcarFinalizada(): void {
    if (this.finalizada()) return;
    this.finalizada.set(true);
    this.detenerPoll();
    this.detenerPresencia(true);
    this.detenerCamara();
    // Se deja de publicar y se desconecta la sala: el backend ya no emite
    // tokens para esta transmisión y no hay reconexión posible.
    void this.desconectarLiveKit();
    this.transmision.update((t) => (t ? { ...t, estado: 'finalizada' } : t));
  }

  private recargarTransmision(): void {
    this.transmisiones.getById(this.transmisionId).subscribe({
      next: (t) => {
        this.transmision.set(t);
        // Al pasar a `en_vivo` (el anfitrión acaba de iniciar) se entra a la sala.
        if (t.estado === 'en_vivo') this.sincronizarLiveKit();
      },
      error: (err: ErrorHttp) => console.warn('No se pudo refrescar la transmisión:', err?.status)
    });
  }

  /**
   * Cámara del anfitrión. Si está conectado a LiveKit, apaga/enciende la pista
   * publicada; si no, sólo se usa como vista previa LOCAL (getUserMedia), que
   * no se emite a Internet.
   */
  async toggleCamara(): Promise<void> {
    if (this.room) {
      await this.alternarCamaraLiveKit(this.room);
      return;
    }
    if (this.camaraIniciando) return;
    if (this.camaraActiva()) {
      this.detenerCamara();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      this.camaraError.set('Este navegador no permite acceder a la cámara.');
      return;
    }

    this.camaraIniciando = true;
    this.camaraError.set(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

      // El live pudo finalizar mientras el navegador pedía el permiso: si es el
      // caso, no se deja la cámara encendida.
      if (this.finalizada()) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      this.mediaStream = stream;
      this.camaraActiva.set(true);
      this.asignarVideo(stream);
    } catch (err) {
      this.camaraError.set(this.mensajeCamara(err));
    } finally {
      this.camaraIniciando = false;
    }
  }

  /** Mensaje entendible según el motivo real del fallo de getUserMedia. */
  private mensajeCamara(err: unknown): string {
    switch ((err as { name?: string })?.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Permiso de cámara o micrófono denegado. Habilítalo en el navegador para usar la vista previa.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'No se encontró ninguna cámara o micrófono disponibles en este dispositivo.';
      case 'NotReadableError':
        return 'La cámara o el micrófono están siendo usados por otra aplicación.';
      default:
        return 'No se pudo acceder a la cámara o al micrófono.';
    }
  }

  // El <video> se renderiza con @if; se asigna en el ciclo siguiente.
  private asignarVideo(stream: MediaStream): void {
    if (this.camaraTimer !== null) clearTimeout(this.camaraTimer);
    this.camaraTimer = setTimeout(() => {
      this.camaraTimer = null;
      const el = this.videoLocalRef()?.nativeElement;
      if (!el) return;
      el.srcObject = stream;
      void el.play().catch(() => undefined);
    }, 0);
  }

  /** Apaga la captura: corta las pistas (LED) y suelta el <video> sin demora. */
  private detenerCamara(): void {
    if (this.camaraTimer !== null) {
      clearTimeout(this.camaraTimer);
      this.camaraTimer = null;
    }

    const stream = this.mediaStream;
    this.mediaStream = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());

    // Si hay una pista publicada en LiveKit, el elemento la conserva.
    const el = this.videoLocalRef()?.nativeElement;
    if (el && !this.pistaVideoLocal()) {
      el.pause();
      el.srcObject = null;
    }

    this.camaraActiva.set(false);
  }

  // ---- Emisión en tiempo real (LiveKit) -----------------------------------

  /**
   * Entra a la sala de LiveKit cuando hay sesión utilizable y la transmisión
   * está en vivo. No reintenta tras un fallo (para eso está el botón de la
   * interfaz): así el sondeo no repite peticiones de token innecesarias.
   */
  private sincronizarLiveKit(): void {
    if (this.room || this.conectandoLiveKit) return;
    if (this.livekitEstado() !== 'inactivo') return;
    if (this.finalizada() || !this.haySesion() || !this.enVivo) return;
    void this.conectarLiveKit();
  }

  /** Reintento manual de la conexión (botón de la interfaz). */
  reintentarLiveKit(): void {
    if (this.room || this.conectandoLiveKit) return;
    this.livekitEstado.set('inactivo');
    this.livekitError.set(null);
    this.sincronizarLiveKit();
  }

  /**
   * Pide el token al backend (que decide el rol), se conecta a la sala y, si es
   * el anfitrión, publica cámara y micrófono. Un espectador nunca publica: el
   * token del backend no le concede ese permiso.
   */
  private async conectarLiveKit(): Promise<void> {
    const id = this.transmisionId;
    this.conectandoLiveKit = true;
    this.livekitEstado.set('conectando');
    this.livekitError.set(null);
    let room: Room | null = null;
    let limpiar: () => void = () => undefined;

    try {
      const datos: TokenLiveKit = await firstValueFrom(
        this.transmisiones.obtenerTokenLiveKit(id)
      );

      // La ruta pudo cambiar o el live pudo cerrarse mientras se pedía el token.
      if (this.transmisionId !== id || this.finalizada() || !this.haySesion()) return;

      room = new Room({ adaptiveStream: true, dynacast: true });
      limpiar = this.registrarEventosSala(room);
      await room.connect(datos.url, datos.token);

      if (this.transmisionId !== id || this.finalizada()) {
        limpiar();
        await room.disconnect(true);
        return;
      }

      this.room = room;
      this.limpiarEventosSala = limpiar;
      this.rolLiveKit.set(datos.rol);
      this.livekitEstado.set('conectado');
      this.videoRemotoActivo.set(false);
      this.audioBloqueado.set(!room.canPlaybackAudio);

      if (datos.rol === 'anfitrion') await this.publicarComoAnfitrion(room);
    } catch (err) {
      if (room) {
        limpiar();
        try {
          await room.disconnect(true);
        } catch {
          /* la sala ya estaba cerrada */
        }
      }
      if (this.transmisionId !== id) return;
      this.livekitError.set(this.mensajeLiveKit(err));
      this.livekitEstado.set('error');
    } finally {
      this.conectandoLiveKit = false;
    }
  }

  /**
   * Registra los eventos de la sala una sola vez por conexión y devuelve la
   * función que los retira.
   */
  private registrarEventosSala(room: Room): () => void {
    const alSuscribir = (track: RemoteTrack): void => {
      this.pistasRemotas.update((ps) => (ps.includes(track) ? ps : [...ps, track]));
      if (track.kind === Track.Kind.Video) this.videoRemotoActivo.set(true);
    };

    const alDesuscribir = (track: RemoteTrack): void => {
      track.detach();
      this.pistasRemotas.update((ps) => ps.filter((p) => p !== track));
      if (track.kind === Track.Kind.Video) {
        this.videoRemotoActivo.set(this.pistasRemotas().some((p) => p.kind === Track.Kind.Video));
      }
    };

    const alCambiarParticipantes = (): void =>
      this.videoRemotoActivo.set(this.pistasRemotas().some((p) => p.kind === Track.Kind.Video));

    const alDesconectar = (): void => {
      // Sólo interesa la desconexión no provocada por nosotros (p. ej. red).
      if (this.room !== room || this.finalizada()) return;
      this.videoRemotoActivo.set(false);
      this.livekitEstado.set('error');
      this.livekitError.set('Se perdió la conexión con la emisión. Reintenta para volver a entrar.');
    };

    const alReconectar = (): void => this.livekitEstado.set('reconectando');
    const alReconectado = (): void => this.livekitEstado.set('conectado');
    const alAudio = (): void => this.audioBloqueado.set(!room.canPlaybackAudio);
    const alTrackLocal = (): void => this.actualizarEstadoLocal(room);

    room.on(RoomEvent.TrackSubscribed, alSuscribir);
    room.on(RoomEvent.TrackUnsubscribed, alDesuscribir);
    room.on(RoomEvent.ParticipantConnected, alCambiarParticipantes);
    room.on(RoomEvent.ParticipantDisconnected, alCambiarParticipantes);
    room.on(RoomEvent.Disconnected, alDesconectar);
    room.on(RoomEvent.Reconnecting, alReconectar);
    room.on(RoomEvent.Reconnected, alReconectado);
    room.on(RoomEvent.AudioPlaybackStatusChanged, alAudio);
    room.on(RoomEvent.TrackMuted, alTrackLocal);
    room.on(RoomEvent.TrackUnmuted, alTrackLocal);
    room.on(RoomEvent.LocalTrackUnpublished, alTrackLocal);

    return () => {
      room.off(RoomEvent.TrackSubscribed, alSuscribir);
      room.off(RoomEvent.TrackUnsubscribed, alDesuscribir);
      room.off(RoomEvent.ParticipantConnected, alCambiarParticipantes);
      room.off(RoomEvent.ParticipantDisconnected, alCambiarParticipantes);
      room.off(RoomEvent.Disconnected, alDesconectar);
      room.off(RoomEvent.Reconnecting, alReconectar);
      room.off(RoomEvent.Reconnected, alReconectado);
      room.off(RoomEvent.AudioPlaybackStatusChanged, alAudio);
      room.off(RoomEvent.TrackMuted, alTrackLocal);
      room.off(RoomEvent.TrackUnmuted, alTrackLocal);
      room.off(RoomEvent.LocalTrackUnpublished, alTrackLocal);
    };
  }

  /**
   * Publica audio y video del anfitrión. La vista previa local (getUserMedia)
   * se detiene porque deja de aportar: la cámara ya se envía por LiveKit.
   */
  private async publicarComoAnfitrion(room: Room): Promise<void> {
    this.detenerCamara();
    if (!navigator.mediaDevices?.getUserMedia) {
      this.camaraError.set('Este navegador no permite acceder a la cámara o el micrófono.');
      return;
    }
    try {
      // Ambas llamadas piden permisos al navegador y publican las pistas.
      const pubVideo = await room.localParticipant.setCameraEnabled(true);
      const pubAudio = await room.localParticipant.setMicrophoneEnabled(true);
      if (this.room !== room) return;
      this.pistaVideoLocal.set(pubVideo?.videoTrack ?? null);
      this.micActivo.set(!!pubAudio);
    } catch (err) {
      this.camaraError.set(this.mensajeCamara(err));
    } finally {
      if (this.room === room) this.actualizarEstadoLocal(room);
    }
  }

  /** Apaga/enciende la cámara publicada en la sala. */
  private async alternarCamaraLiveKit(room: Room): Promise<void> {
    if (this.camaraIniciando) return;
    this.camaraIniciando = true;
    this.camaraError.set(null);
    const activar = !room.localParticipant.isCameraEnabled;
    try {
      if (activar) {
        const pub = await room.localParticipant.setCameraEnabled(true);
        if (this.room === room) this.pistaVideoLocal.set(pub?.videoTrack ?? null);
      } else {
        await room.localParticipant.setCameraEnabled(false);
        if (this.room === room) this.pistaVideoLocal.set(null);
      }
    } catch (err) {
      this.camaraError.set(this.mensajeCamara(err));
    } finally {
      this.actualizarEstadoLocal(room);
      this.camaraIniciando = false;
    }
  }

  /** Silencia o activa el micrófono del anfitrión en la sala. */
  async toggleMicrofono(): Promise<void> {
    const room = this.room;
    if (!room || this.camaraIniciando) return;
    this.camaraIniciando = true;
    this.camaraError.set(null);
    try {
      await room.localParticipant.setMicrophoneEnabled(
        !room.localParticipant.isMicrophoneEnabled
      );
    } catch (err) {
      this.camaraError.set(this.mensajeCamara(err));
    } finally {
      this.actualizarEstadoLocal(room);
      this.camaraIniciando = false;
    }
  }

  /**
   * Los navegadores exigen un gesto del usuario para reproducir audio: si el
   * autoplay se bloqueó, este botón lo desbloquea.
   */
  async activarAudio(): Promise<void> {
    const room = this.room;
    if (!room) return;
    try {
      await room.startAudio();
    } catch {
      /* si el navegador lo sigue bloqueando, el aviso permanece visible */
    }
    this.audioBloqueado.set(!room.canPlaybackAudio);
  }

  /** Refleja en la interfaz el estado real de las pistas locales. */
  private actualizarEstadoLocal(room: Room): void {
    if (this.room !== room) return;
    this.camaraActiva.set(room.localParticipant.isCameraEnabled);
    this.micActivo.set(room.localParticipant.isMicrophoneEnabled);
    if (!this.camaraActiva()) this.pistaVideoLocal.set(null);
  }

  private mensajeLiveKit(err: unknown): string {
    const e = err as ErrorHttp | undefined;
    switch (e?.status) {
      case 401:
        return 'Tu sesión ha caducado: vuelve a iniciar sesión para ver la transmisión.';
      case 403:
        return 'No tienes permisos para entrar a esta transmisión.';
      case 404:
        return 'La transmisión ya no está disponible.';
      case 409:
        return 'La transmisión no está en vivo: la emisión en tiempo real se cerró.';
      case 503:
        return e?.error?.error || 'La emisión en tiempo real no está disponible en el servidor.';
      default:
        return e?.error?.error || 'No se pudo conectar con la emisión en tiempo real.';
    }
  }

  /**
   * Cierra la sala: retira los listeners, suelta los <video>, deja de publicar
   * y desconecta (deteniendo también las pistas locales).
   */
  private async desconectarLiveKit(): Promise<void> {
    const room = this.room;
    const limpiar = this.limpiarEventosSala;
    this.room = null;
    this.limpiarEventosSala = null;
    this.pistasRemotas.set([]);
    this.pistaVideoLocal.set(null);
    this.videoRemotoActivo.set(false);
    this.audioBloqueado.set(false);
    this.micActivo.set(false);
    this.rolLiveKit.set(null);
    this.livekitEstado.set('inactivo');
    this.camaraActiva.set(false);
    if (limpiar) limpiar();
    if (!room) return;
    try {
      await room.disconnect(true);
    } catch {
      /* la sala ya estaba cerrada */
    }
  }

  /** Aviso que ve el espectador mientras no llega video del anfitrión. */
  get avisoEspectador(): string {
    if (this.livekitError()) return this.livekitError() as string;
    switch (this.livekitEstado()) {
      case 'conectando':
        return 'Conectando con la emisión en tiempo real…';
      case 'conectado':
      case 'reconectando':
        return 'Esperando a que el anfitrión publique su video…';
      default:
        return 'Esperando a que el anfitrión empiece a emitir…';
    }
  }

  // ---- Utilidades ---------------------------------------------------------
  toggleChat(): void {
    this.chatVisible = !this.chatVisible;
  }

  /**
   * Sondeo controlado con un único temporizador: refresca el chat y comprueba
   * que la transmisión siga en vivo. Las guardas (`chatCargando`,
   * `estadoConsultando`) evitan peticiones solapadas y, al marcar `finalizada`,
   * el sondeo se detiene (sin bucles de reintento).
   */
  private iniciarPoll(id: string): void {
    this.detenerPoll();
    this.pollId = setInterval(() => this.refrescar(id), this.POLL_MS);
  }

  private refrescar(id: string): void {
    if (this.transmisionId !== id || this.finalizada()) return;

    // El chat sólo se refresca con sesión, si está visible y sin carga en curso.
    if (this.haySesion() && this.chatVisible && !this.chatCargando()) {
      this.cargarMensajes(id);
    }

    if (this.estadoConsultando) return;
    this.estadoConsultando = true;
    this.transmisiones.getById(id).subscribe({
      next: (t) => {
        this.estadoConsultando = false;
        if (this.transmisionId !== id || this.finalizada()) return;
        this.transmision.set(t);
        this.espectadoresActuales.set(t.espectadores_actuales ?? 0);
        this.espectadoresTotales.set(t.espectadores_totales ?? 0);
        // El anfitrión ve su propia fila en cualquier estado; el espectador sólo
        // ve filas `en_vivo`, por lo que su detección llega por el error 404.
        if (t.estado === 'finalizada') this.marcarFinalizada();
        else if (t.estado === 'en_vivo') this.sincronizarLiveKit();
      },
      error: (err: ErrorHttp) => {
        this.estadoConsultando = false;
        // 404 = la transmisión ya no está en vivo (RLS: sólo se expone `en_vivo`).
        if (err?.status === 404 && !this.esPropietario()) this.marcarFinalizada();
      }
    });
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

  /** Nombres de quienes reaccionaron (máx. 3 en la interfaz). */
  get autoresTexto(): string {
    const autores = this.likesAutores().filter((n) => !!n?.trim());
    if (autores.length === 0) return '';
    const visibles = autores.slice(0, 3).join(', ');
    const resto = autores.length - 3;
    return resto > 0 ? `${visibles} y ${resto} más` : visibles;
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

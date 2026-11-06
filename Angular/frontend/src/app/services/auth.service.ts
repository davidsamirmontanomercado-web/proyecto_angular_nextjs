import { Injectable, signal, computed } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ToastService } from './toast.service';

export type UserRole = 'vendedor' | 'comprador' | 'administrador';

/** Vista de la interfaz: vendedor, comprador y administrador usan pantallas
 *  distintas. Un administrador puede alternar entre las tres. */
export type VistaRol = 'vendedor' | 'comprador' | 'administrador';

export interface User {
  id?: string;
  nombre: string;
  correo: string;
  rol: UserRole;
  createdAt?: number;
  provider?: 'local' | 'google';
}

interface StoredUser extends User { pass: string; }

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly KEY_USER = 'lm_user';
  private readonly KEY_USERS = 'lm_users';
  private readonly KEY_TOKEN = 'lm_token';
  private readonly KEY_REFRESH = 'lm_refresh';
  // Vista elegida por un administrador (vendedor/comprador). El resto de roles
  // usan siempre la vista que corresponde a su propio rol.
  private readonly KEY_VISTA = 'lm_vista';
  // Backend contra el que se creó la sesión actual: si cambia, se invalida la
  // sesión para no reutilizar un token de otro proyecto Supabase.
  private readonly KEY_BACKEND = 'lm_session_backend';
  private router = inject(Router);
  private toast = inject(ToastService);
  private http = inject(HttpClient);

  // Generación de sesión: se incrementa al cerrar/limpiar, de modo que un
  // refresco en curso no pueda restaurar una sesión ya cerrada.
  private sessionGeneration = 0;
  private refreshInFlight: Promise<boolean> | null = null;

  private static esUrlLocal(url: string): boolean {
    try {
      const host = new URL(url).hostname;
      return host === 'localhost' || host === '127.0.0.1' || host === '';
    } catch {
      return false;
    }
  }

  /**
   * Normaliza cualquier valor de rol a uno de los tres válidos.
   * Cualquier valor desconocido (o ausente) se resuelve como 'comprador'.
   */
  static normalizarRol(rol: unknown): UserRole {
    if (!rol) return 'comprador';
    const r = String(rol).toLowerCase().trim();
    if (r === 'vendedor' || r === 'administrador' || r === 'comprador') {
      return r as UserRole;
    }
    return 'comprador';
  }

  /**
   * ¿El JWT sigue vigente según su `exp`?
   *
   * Sólo se decodifica el payload (base64url) sin verificar la firma: es una
   * comprobación local para no lanzar peticiones que el backend rechazará con
   * 401. La validación real la sigue haciendo el backend con GoTrue.
   *
   * Un token sin payload, sin `exp` numérico o malformado NO se considera
   * vigente: nunca es prueba de que la sesión sirva. En ese caso la sesión sólo
   * se da por utilizable si hay un refresh_token con el que renovarla
   * (ver `sesionUtilizable`).
   */
  private static tokenVigente(token: string): boolean {
    const payload = token.split('.')[1];
    if (!payload) return false;
    try {
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const relleno = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      const datos = JSON.parse(atob(relleno));
      const exp = typeof datos?.exp === 'number' ? datos.exp : null;
      return exp === null ? false : exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }

  /**
   * Resuelve la URL del backend.
   * - En desarrollo local (localhost/127.0.0.1) se IGNORA un override remoto
   *   (p. ej. producción): un residuo en `lm_backend_url` no debe apuntar el
   *   frontend local a otro backend.
   * - En producción se mantiene el comportamiento de siempre: si hay override
   *   se usa; si no, la URL de producción.
   */
  private static resolveBackendUrl(): string {
    try {
      const host = window.location.hostname;
      const esLocal = host === 'localhost' || host === '127.0.0.1' || host === '';

      const override = localStorage.getItem('lm_backend_url');
      const overrideLimpio = override ? override.replace(/\/+$/, '') : null;

      if (overrideLimpio) {
        const overrideEsLocal = AuthService.esUrlLocal(overrideLimpio);
        if (!(esLocal && !overrideEsLocal)) {
          return overrideLimpio;
        }
      }

      return esLocal ? 'http://localhost:3000' : 'https://backend-one-liard-61.vercel.app';
    } catch {
      return 'http://localhost:3000';
    }
  }

  readonly backendUrl = AuthService.resolveBackendUrl();

  constructor() {
    // Una sesión creada contra otro backend no se reutiliza (evita 401 por
    // tokens de un proyecto Supabase distinto).
    this.protegerSesionDeBackend();
  }

  private protegerSesionDeBackend() {
    try {
      const backendDeLaSesion = localStorage.getItem(this.KEY_BACKEND);
      if (backendDeLaSesion && backendDeLaSesion !== this.backendUrl) {
        this.clearSession();
      }
    } catch {
      // almacenamiento no disponible: no hay sesión que proteger.
    }
  }

  // URL de inicio de login con Google. Se envía el origen actual del navegador
  // para que el backend pueda validarlo contra su allowlist y volver a él tras
  // el callback (local o desplegado), sin hardcodear un único frontend.
  readonly googleLoginUrl =
    `${this.backendUrl}/api/auth/google?origin=${encodeURIComponent(
      typeof window !== 'undefined' ? window.location.origin : ''
    )}`;

  readonly currentUser = signal<User | null>(this.loadUser());
  private readonly tokenSignal = signal<string | null>(this.getToken());
  // Una sesión sólo es válida si hay usuario Y access_token: evita el falso
  // "logueado" cuando el registro deja lm_user pero sin token.
  readonly isLoggedIn = computed(() => {
    const user = this.currentUser();
    const token = this.tokenSignal();
    if (!user || !token) return false;
    
    // Si el usuario tiene MFA pero el token es solo de nivel 1 (aal1),
    // no lo consideramos "totalmente logueado" para los guards de ruta.
    // Nota: Esto es una simplificación, lo ideal sería decodificar el JWT y ver 'aal'.
    return true; 
  });

  /**
   * ¿Existe una sesión con la que el backend pueda reconocer al usuario?
   *
   * - Con access_token vigente: sí.
   * - Con access_token ausente o caducado: sólo si hay refresh_token, porque el
   *   interceptor ya sabe renovarlo con el mecanismo existente.
   *
   * Sirve para decidir si tiene sentido pedir datos "por usuario" (me gusta,
   * seguimiento, chat, presencia) y así no generar 401 en la consola. No altera
   * `isLoggedIn` ni los guards de ruta.
   */
  readonly sesionUtilizable = computed(() => {
    if (!this.currentUser()) return false;
    const token = this.tokenSignal();
    if (token && AuthService.tokenVigente(token)) return true;
    return this.hayRefreshToken();
  });

  /** ¿El usuario actual es administrador? Se usa para mostrar el panel admin. */
  readonly esAdmin = computed(() => this.currentUser()?.rol === 'administrador');

  // --- Vista de la interfaz (vendedor / comprador / administrador) ---------

  /** Vista elegida por el administrador; se ignora para el resto de roles. */
  private readonly vistaPreferida = signal<VistaRol>(this.loadVistaPreferida());

  /**
   * Vista activa de la interfaz:
   *  - vendedor / comprador: siempre la de su propio rol.
   *  - administrador: la que haya elegido (por defecto 'administrador').
   *  - invitado (sin sesión): 'vendedor' como valor neutro de referencia.
   */
  readonly vistaActual = computed<VistaRol>(() => {
    const rol = this.currentUser()?.rol;
    if (rol === 'administrador') return this.vistaPreferida();
    if (rol === 'comprador') return 'comprador';
    return 'vendedor';
  });

  readonly esVendedorVista = computed(() => this.vistaActual() === 'vendedor');
  readonly esCompradorVista = computed(() => this.vistaActual() === 'comprador');
  readonly esAdminVista = computed(() => this.vistaActual() === 'administrador');

  /** Etiqueta legible de la vista activa (para badges). */
  readonly etiquetaVista = computed(() => {
    switch (this.vistaActual()) {
      case 'administrador':
        return 'Administrador';
      case 'comprador':
        return 'Comprador';
      default:
        return 'Vendedor';
    }
  });

  /** Sólo el administrador puede alternar la vista activa. */
  readonly puedeAlternarVista = computed(() => this.esAdmin());

  /** Ruta inicial (página de inicio) según el rol activo. */
  readonly rutaInicio = computed(() =>
    this.vistaActual() === 'comprador' ? '/comprar' : '/dashboard'
  );

  /** Cambia la vista activa (sólo tiene efecto para el administrador). */
  cambiarVista(vista: VistaRol): void {
    this.vistaPreferida.set(vista);
    try {
      localStorage.setItem(this.KEY_VISTA, vista);
    } catch {
      // almacenamiento no disponible: la elección vive sólo en memoria.
    }
  }

  private loadVistaPreferida(): VistaRol {
    try {
      const v = localStorage.getItem(this.KEY_VISTA);
      if (v === 'vendedor' || v === 'comprador' || v === 'administrador') return v;
      return 'administrador';
    } catch {
      return 'administrador';
    }
  }

  private hayRefreshToken(): boolean {
    try {
      return !!localStorage.getItem(this.KEY_REFRESH);
    } catch {
      return false;
    }
  }

  private loadUser(): User | null {
    try { return JSON.parse(localStorage.getItem(this.KEY_USER) || 'null'); }
    catch { return null; }
  }

  private loadUsers(): StoredUser[] {
    try { return JSON.parse(localStorage.getItem(this.KEY_USERS) || '[]'); }
    catch { return []; }
  }

  private saveUsers(users: StoredUser[]) {
    localStorage.setItem(this.KEY_USERS, JSON.stringify(users));
  }

  setSession(user: User, token?: string, refreshToken?: string) {
    localStorage.setItem(this.KEY_USER, JSON.stringify(user));
    localStorage.setItem(this.KEY_BACKEND, this.backendUrl);
    if (token) {
      localStorage.setItem(this.KEY_TOKEN, token);
      this.tokenSignal.set(token);
    }
    if (refreshToken) localStorage.setItem(this.KEY_REFRESH, refreshToken);
    this.currentUser.set(user);
  }

  getToken(): string | null {
    return localStorage.getItem(this.KEY_TOKEN);
  }

  /** Limpia la sesión e invalida cualquier refresco en curso. */
  clearSession() {
    this.sessionGeneration++;
    localStorage.removeItem(this.KEY_USER);
    localStorage.removeItem(this.KEY_TOKEN);
    localStorage.removeItem(this.KEY_REFRESH);
    localStorage.removeItem(this.KEY_BACKEND);
    this.currentUser.set(null);
    this.tokenSignal.set(null);
  }

  /**
   * Elimina el override manual `lm_backend_url`.
   *
   * Comportamiento:
   *  - Borra el override del almacenamiento. No recarga la página: `backendUrl`
   *    es de sólo lectura y se resuelve una vez; en el próximo arranque vuelve a
   *    autodetectarse (local vs producción).
   *  - Si el backend de la sesión activa deja de coincidir con el recalculado,
   *    cierra la sesión para no reutilizar un token de otro proyecto Supabase.
   */
  resetBackendUrl(): void {
    try {
      localStorage.removeItem('lm_backend_url');
      const backendDeLaSesion = localStorage.getItem(this.KEY_BACKEND);
      const recalculado = AuthService.resolveBackendUrl();
      if (backendDeLaSesion && backendDeLaSesion !== recalculado) {
        this.clearSession();
      }
    } catch {
      // almacenamiento no disponible: no hay nada que limpiar.
    }
  }

  /**
   * Da la sesión por perdida: limpia las credenciales que el backend ya rechaza
   * y avisa una única vez (esto sólo se llama desde el refresco single-flight).
   * El interceptor se encarga de llevar al usuario al inicio de sesión.
   */
  private expirarSesion(): void {
    this.clearSession();
    this.toast.err('Tu sesión ha caducado. Inicia sesión de nuevo para continuar.');
  }

  /**
   * Renueva el access_token usando el refresh_token guardado.
   * Single-flight: las llamadas concurrentes comparten la misma promesa, así que
   * varios 401 simultáneos provocan una sola petición de renovación.
   * Si el usuario cierra sesión durante la renovación (cambia la generación),
   * no se restaura la sesión.
   *
   * Devuelve `false` cuando no se pudo renovar. Limpia las credenciales (sesión
   * irrecuperable) sólo cuando el refresh_token falta o el backend lo rechaza
   * (400/401); ante errores del servidor o de red mantiene la sesión, porque
   * pueden ser transitorios y no prueban que la sesión haya caducado.
   */
  async refresh(): Promise<boolean> {
    if (this.refreshInFlight) return this.refreshInFlight;

    const rt = localStorage.getItem(this.KEY_REFRESH);
    if (!rt) {
      this.expirarSesion();
      return false;
    }

    const gen = this.sessionGeneration;
    this.refreshInFlight = (async () => {
      try {
        const body: any = await firstValueFrom(
          this.http.post(`${this.backendUrl}/api/auth/refresh`, { refresh_token: rt })
        );

        const session = body?.session;

        if (!session?.access_token || gen !== this.sessionGeneration) {
          if (gen === this.sessionGeneration) this.expirarSesion();
          return false;
        }

        localStorage.setItem(this.KEY_TOKEN, session.access_token);
        if (session.refresh_token) {
          localStorage.setItem(this.KEY_REFRESH, session.refresh_token);
        }
        this.tokenSignal.set(session.access_token);
        return true;
      } catch (e: any) {
        console.error('[AuthService.refresh] Error:', e);
        const rechazado = e.status === 400 || e.status === 401;
        if (rechazado && gen === this.sessionGeneration) this.expirarSesion();
        return false;
      } finally {
        this.refreshInFlight = null;
      }
    })();

    return this.refreshInFlight;
  }

  /**
   * Asegura que el token actual sea válido. Si está expirado o a punto de expirar,
   * intenta renovarlo proactivamente. Devuelve true si el token es válido.
   */
  async ensureFreshToken(): Promise<boolean> {
    const token = this.getToken();
    if (token && AuthService.tokenVigente(token)) {
      return true;
    }
    
    if (this.hayRefreshToken()) {
      console.log('[AuthService] Token expirado, intentando refresco proactivo...');
      return await this.refresh();
    }
    
    return false;
  }

  register(data: { nombre: string; correo: string; pass: string; rol: UserRole }): { ok: boolean; error?: string } {
    const users = this.loadUsers();
    if (users.some(u => u.correo.toLowerCase() === data.correo.toLowerCase())) {
      return { ok: false, error: 'Ya existe una cuenta con ese correo.' };
    }
    const stored: StoredUser = { ...data, createdAt: Date.now() };
    users.push(stored);
    this.saveUsers(users);
    const { pass, ...safe } = stored;
    this.setSession(safe);
    return { ok: true };
  }

  /**
   * Registro real contra Supabase Auth (vía /api/auth/register).
   * Sólo crea sesión si el backend devuelve un access_token válido; si hace
   * falta confirmar el correo, no se considera autenticado.
   */
  async registerRemote(data: {
    nombre: string;
    correo: string;
    pass: string;
    rol: UserRole;
  }): Promise<{ ok: boolean; error?: string; confirmationRequired?: boolean }> {
    try {
      const body: any = await firstValueFrom(
        this.http.post(`${this.backendUrl}/api/auth/register`, data)
      );

      const info = body?.data;

      if (info?.confirmationRequired) {
        return { ok: true, confirmationRequired: true };
      }

      const rawUser = info?.user;
      const session = info?.session;

      if (!rawUser?.id || !session?.access_token) {
        return { ok: false, error: 'Respuesta inválida del servidor.' };
      }

      const user: User = {
        id: rawUser.id,
        nombre: data.nombre,
        correo: rawUser.email || data.correo,
        rol: data.rol,
        createdAt: Date.now(),
      };

      this.setSession(user, session.access_token, session.refresh_token);
      return { ok: true, confirmationRequired: false };
    } catch (e: any) {
      console.error('[AuthService.registerRemote] Error completo:', e);
      let msg = 'No se pudo conectar con el servidor. Revisa la conexión o la URL del backend.';
      if (e.error?.error) {
        msg = e.error.error;
      } else if (e.message) {
        msg = e.message;
      }
      return { ok: false, error: msg };
    }
  }

  async login(correo: string, pass: string, recordarme = false): Promise<{ ok: boolean; error?: string; user?: User; mfaRequired?: boolean; factors?: any[] }> {
    try {
      const body: any = await firstValueFrom(
        this.http.post(`${this.backendUrl}/api/auth/login`, { 
          email: correo.trim(), 
          password: pass,
          rememberMe: recordarme 
        })
      );

      if (body.mfaRequired) {
        this.setSession(body.user, body.session?.access_token, body.session?.refresh_token);
        return { ok: true, mfaRequired: true, factors: body.factors };
      }

      const session = body?.session;
      const rawUser = body?.user || session?.user || null;

      if (!rawUser?.email) {
        return { ok: false, error: 'Respuesta inválida del servidor.' };
      }

      const user: User = {
        id: rawUser.id,
        nombre:
          rawUser.user_metadata?.nombre ||
          rawUser.user_metadata?.full_name ||
          rawUser.user_metadata?.name ||
          rawUser.email.split('@')[0],
        correo: rawUser.email,
        rol: AuthService.normalizarRol(rawUser.user_metadata?.rol),
        createdAt: rawUser.created_at ? new Date(rawUser.created_at).getTime() : Date.now(),
        provider: 'local',
      };

      this.setSession(user, session?.access_token, session?.refresh_token);
      return { ok: true, user };
    } catch (e: any) {
      console.error('[AuthService.login] Error:', e);
      return {
        ok: false,
        error: e.error?.error || 'No se pudo conectar con el servidor. Revisa la conexión o la URL del backend.',
      };
    }
  }

  logout() {
    this.clearSession();
    this.router.navigateByUrl('/login');
  }

  async solicitarRecuperacionRemote(correo: string): Promise<{ ok: boolean; error?: string; devLink?: string }> {
    try {
      const res: any = await firstValueFrom(
        this.http.post(`${this.backendUrl}/api/auth/recuperar`, { email: correo.trim() })
      );
      return { ok: true, devLink: res?.devLink };
    } catch (e: any) {
      return { 
        ok: false, 
        error: e.error?.error || 'Error al solicitar recuperación.',
        devLink: e.error?.devLink 
      };
    }
  }

  async restablecerContrasenaRemote(token: string, nuevaPass: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await firstValueFrom(
        this.http.post(`${this.backendUrl}/api/auth/restablecer`, { password: nuevaPass }, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      );
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.error?.error || 'Error al restablecer contraseña.' };
    }
  }

  async getPerfil(): Promise<{ ok: boolean; data?: any; error?: string }> {
    try {
      const res: any = await firstValueFrom(
        this.http.get(`${this.backendUrl}/api/perfil`)
      );
      return { ok: true, data: res.data };
    } catch (e: any) {
      return { ok: false, error: e.error?.error || 'Error al obtener perfil.' };
    }
  }

  async getSesiones(): Promise<{ ok: boolean; sesiones?: any[]; error?: string }> {
    try {
      const res: any = await firstValueFrom(
        this.http.get(`${this.backendUrl}/api/auth/sesiones`)
      );
      return { ok: true, sesiones: res.sesiones };
    } catch (e: any) {
      return { ok: false, error: e.error?.error || 'Error al obtener sesiones.' };
    }
  }

  async cerrarSesionRemote(sessionId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await firstValueFrom(
        this.http.delete(`${this.backendUrl}/api/auth/sesiones`, {
          body: { sessionId }
        })
      );
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.error?.error || 'Error al cerrar sesión.' };
    }
  }

  async updatePerfil(data: any): Promise<{ ok: boolean; error?: string }> {
    try {
      await firstValueFrom(
        this.http.patch(`${this.backendUrl}/api/perfil`, data)
      );
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.error?.error || 'Error al actualizar perfil.' };
    }
  }

  // --- Administración de usuarios (sólo rol administrador) ---

  async listarUsuariosAdmin(): Promise<{ ok: boolean; usuarios?: any[]; error?: string }> {
    try {
      // Añadimos un timestamp para evitar cualquier tipo de caché del navegador
      const t = Date.now();
      const res = await firstValueFrom(
        this.http.get<any>(`${this.backendUrl}/api/admin/usuarios?t=${t}`)
      );
      return { ok: true, usuarios: res.data };
    } catch (e: any) {
      console.error('[AuthService.listarUsuariosAdmin] Error:', e);
      return { 
        ok: false, 
        error: e.error?.error || e.error?.mensaje || 'Error al obtener usuarios.' 
      };
    }
  }

  async cambiarRolUsuario(id: string, rol: UserRole): Promise<{ ok: boolean; error?: string }> {
    try {
      await firstValueFrom(
        this.http.patch(`${this.backendUrl}/api/admin/usuarios`, { id, rol })
      );
      return { ok: true };
    } catch (e: any) {
      console.error('[AuthService.cambiarRolUsuario] Error:', e);
      const errorMsg = e.error?.details 
        ? `${e.error.error} (${e.error.details})` 
        : (e.error?.error || 'Error al cambiar el rol.');
      return { ok: false, error: errorMsg };
    }
  }

  // --- Solicitudes de Vendedor ---

  async obtenerEstadoSolicitudVendedor(): Promise<{ ok: boolean; data?: any; error?: string }> {
    try {
      const res: any = await firstValueFrom(
        this.http.get(`${this.backendUrl}/api/perfil/solicitar-vendedor`)
      );
      return { ok: true, data: res.data };
    } catch (e: any) {
      return { ok: false, error: e.error?.error || 'Error al obtener solicitud.' };
    }
  }

  async enviarSolicitudVendedor(mensaje: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await firstValueFrom(
        this.http.post(`${this.backendUrl}/api/perfil/solicitar-vendedor`, { mensaje })
      );
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.error?.error || 'Error al enviar solicitud.' };
    }
  }

  async listarSolicitudesAdmin(): Promise<{ ok: boolean; solicitudes?: any[]; error?: string }> {
    try {
      const res: any = await firstValueFrom(
        this.http.get(`${this.backendUrl}/api/admin/solicitudes`)
      );
      return { ok: true, solicitudes: res.data };
    } catch (e: any) {
      return { ok: false, error: e.error?.error || 'Error al listar solicitudes.' };
    }
  }

  async resolverSolicitudAdmin(id: string, accion: 'aprobar' | 'rechazar'): Promise<{ ok: boolean; error?: string }> {
    try {
      await firstValueFrom(
        this.http.patch(`${this.backendUrl}/api/admin/solicitudes`, { id, accion })
      );
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.error?.error || 'Error al procesar solicitud.' };
    }
  }

  // --- MFA (2FA) Real Flow ---
  
  async getMFAFactors(): Promise<{ ok: boolean; factors?: any[]; activeFactor?: any; error?: string }> {
    try {
      const res: any = await firstValueFrom(
        this.http.get(`${this.backendUrl}/api/auth/mfa`)
      );
      return { ok: true, factors: res.factors, activeFactor: res.activeFactor };
    } catch (e: any) {
      return { ok: false, error: e.error?.error || 'Error al obtener factores de seguridad.' };
    }
  }

  async enrollMFA(): Promise<{ ok: boolean; data?: any; error?: string }> {
    try {
      const res: any = await firstValueFrom(
        this.http.post(`${this.backendUrl}/api/auth/mfa`, { action: 'enroll' })
      );
      return { ok: true, data: res.data };
    } catch (e: any) {
      return { ok: false, error: e.error?.error || 'Error al iniciar enrolamiento.' };
    }
  }

  async challengeMFA(factorId: string): Promise<{ ok: boolean; data?: any; error?: string }> {
    try {
      const res: any = await firstValueFrom(
        this.http.post(`${this.backendUrl}/api/auth/mfa`, { action: 'challenge', factorId })
      );
      return { ok: true, data: res.data };
    } catch (e: any) {
      return { ok: false, error: e.error?.error || 'Error al crear desafío.' };
    }
  }

  async verifyMFA(factorId: string, challengeId: string, code: string): Promise<{ ok: boolean; data?: any; error?: string }> {
    try {
      const body: any = await firstValueFrom(
        this.http.post(`${this.backendUrl}/api/auth/mfa`, { action: 'verify', factorId, challengeId, code })
      );
      
      // Si la verificación es exitosa, actualizamos la sesión con el nuevo token de nivel aal2
      if (body.data?.access_token) {
        const currentUser = this.currentUser();
        if (currentUser) {
          this.setSession(currentUser, body.data.access_token, body.data.refresh_token);
        }
      }
      
      return { ok: true, data: body.data };
    } catch (e: any) {
      return { ok: false, error: e.error?.error || 'Error al verificar código.' };
    }
  }

  async unenrollMFA(factorId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await firstValueFrom(
        this.http.delete(`${this.backendUrl}/api/auth/mfa`, {
          body: { factorId }
        })
      );
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.error?.error || 'Error al eliminar factor.' };
    }
  }

  initials(name?: string): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
}

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isLoggedIn()) return true;
  router.navigateByUrl('/login');
  return false;
};

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  
  // Si ya está logueado, lo mandamos al dashboard...
  if (auth.isLoggedIn()) {
    // ...PERO si la URL actual es la de restablecer contraseña o requiere MFA, lo dejamos quedarse.
    const url = typeof window !== 'undefined' ? window.location.href : '';
    if (url.includes('restablecer-contrasena') || url.includes('mfa=1')) {
      return true;
    }
    // Cada rol aterriza en su propia página de inicio.
    router.navigateByUrl(auth.rutaInicio());
    return false;
  }
  return true;
};

// --- Role Guards ---

export const roleGuard = (rolesPermitidos: UserRole[]): CanActivateFn => {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    const toast = inject(ToastService);

    if (!auth.isLoggedIn()) {
      router.navigateByUrl('/login');
      return false;
    }

    const user = auth.currentUser();
    if (user && rolesPermitidos.includes(user.rol)) {
      return true;
    }

    toast.err('No tienes permisos para acceder a esta sección.');
    router.navigateByUrl(auth.rutaInicio());
    return false;
  };
};

export const adminGuard: CanActivateFn = roleGuard(['administrador']);
export const vendedorGuard: CanActivateFn = roleGuard(['vendedor', 'administrador']);
export const compradorGuard: CanActivateFn = roleGuard(['comprador', 'administrador']);

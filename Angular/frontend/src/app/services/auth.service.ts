import { Injectable, signal, computed } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { inject } from '@angular/core';
import { ToastService } from './toast.service';

export interface User {
  id?: string;
  nombre: string;
  correo: string;
  rol: 'empresa' | 'comprador';
  createdAt?: number;
}

interface StoredUser extends User { pass: string; }

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly KEY_USER = 'lm_user';
  private readonly KEY_USERS = 'lm_users';
  private readonly KEY_TOKEN = 'lm_token';
  private readonly KEY_REFRESH = 'lm_refresh';
  // Backend contra el que se creó la sesión actual: si cambia, se invalida la
  // sesión para no reutilizar un token de otro proyecto Supabase.
  private readonly KEY_BACKEND = 'lm_session_backend';
  private router = inject(Router);
  private toast = inject(ToastService);

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
  readonly isLoggedIn = computed(
    () => this.currentUser() !== null && this.tokenSignal() !== null
  );

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
      // Sin refresh_token no hay forma de recuperar el access_token caducado:
      // se limpian las credenciales para no dejar al usuario "logueado" con un
      // token que el backend rechaza.
      this.expirarSesion();
      return false;
    }

    const gen = this.sessionGeneration;
    this.refreshInFlight = (async () => {
      try {
        const res = await fetch(`${this.backendUrl}/api/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ refresh_token: rt }),
        });

        if (!res.ok) {
          const rechazado = res.status === 400 || res.status === 401;
          if (rechazado && gen === this.sessionGeneration) this.expirarSesion();
          return false;
        }

        const body = await res.json().catch(() => null);
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
      } catch {
        // Fallo de red: la sesión no se toca, puede reintentarse.
        return false;
      } finally {
        this.refreshInFlight = null;
      }
    })();

    return this.refreshInFlight;
  }

  register(data: { nombre: string; correo: string; pass: string; rol: 'empresa' | 'comprador' }): { ok: boolean; error?: string } {
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
    rol: 'empresa' | 'comprador';
  }): Promise<{ ok: boolean; error?: string; confirmationRequired?: boolean }> {
    try {
      const res = await fetch(`${this.backendUrl}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(data),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        return { ok: false, error: body?.error || `Error ${res.status}` };
      }

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
    } catch {
      return {
        ok: false,
        error: 'No se pudo conectar con el servidor. Revisa la conexión o la URL del backend.',
      };
    }
  }

  async login(correo: string, pass: string): Promise<{ ok: boolean; error?: string; user?: User }> {
    try {
      const res = await fetch(`${this.backendUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ email: correo.trim(), password: pass }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        const err = body?.error || `Error ${res.status}`;
        return { ok: false, error: err };
      }

      const session = body?.session;
      const rawUser = body?.user || session?.user || null;

      if (!rawUser?.email) {
        return { ok: false, error: 'Respuesta inválida del servidor.' };
      }

      const user: User = {
        id: rawUser.id,
        nombre:
          rawUser.user_metadata?.full_name ||
          rawUser.user_metadata?.name ||
          rawUser.email.split('@')[0],
        correo: rawUser.email,
        rol: 'empresa',
        createdAt: rawUser.created_at ? new Date(rawUser.created_at).getTime() : Date.now(),
      };

      this.setSession(user, session?.access_token, session?.refresh_token);
      return { ok: true, user };
    } catch (e: any) {
      console.error('[AuthService.login] Error:', e);
      return {
        ok: false,
        error: 'No se pudo conectar con el servidor. Revisa la conexión o la URL del backend.',
      };
    }
  }

  logout() {
    this.clearSession();
    this.router.navigateByUrl('/login');
  }

  solicitarRecuperacion(correo: string): { ok: boolean; token?: string; error?: string } {
    const users = this.loadUsers();
    const found = users.find(u => u.correo.toLowerCase() === correo.toLowerCase());
    if (!found) return { ok: false, error: 'No existe una cuenta con ese correo.' };
    const token = btoa(`${found.correo}::${Date.now()}`);
    return { ok: true, token };
  }

  validarToken(token: string): { ok: boolean; correo?: string; error?: string } {
    try {
      const decoded = atob(token);
      const [correo, ts] = decoded.split('::');
      if (!correo || !ts) return { ok: false, error: 'Token inválido.' };
      const age = Date.now() - parseInt(ts);
      if (age > 3600000) return { ok: false, error: 'El enlace ha expirado.' };
      return { ok: true, correo };
    } catch {
      return { ok: false, error: 'Token inválido.' };
    }
  }

  restablecerContrasena(token: string, nuevaPass: string): { ok: boolean; error?: string } {
    const val = this.validarToken(token);
    if (!val.ok) return { ok: false, error: val.error };
    const users = this.loadUsers();
    const idx = users.findIndex(u => u.correo.toLowerCase() === val.correo!.toLowerCase());
    if (idx === -1) return { ok: false, error: 'Cuenta no encontrada.' };
    users[idx].pass = nuevaPass;
    this.saveUsers(users);
    return { ok: true };
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
  if (!auth.isLoggedIn()) return true;
  router.navigateByUrl('/dashboard');
  return false;
};

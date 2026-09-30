import { Injectable, signal, computed } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { inject } from '@angular/core';

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
  private router = inject(Router);

  private static resolveBackendUrl(): string {
    try {
      const override = localStorage.getItem('lm_backend_url');
      if (override) return override.replace(/\/+$/, '');
      const host = window.location.hostname;
      const port = window.location.port;
      const protocol = window.location.protocol;
      if (host === 'localhost' || host === '127.0.0.1' || host === '') {
        return `${protocol}//localhost:3000`;
      }
      return `${protocol}//${window.location.host}`;
    } catch {
      return 'http://localhost:3000';
    }
  }

  readonly backendUrl = AuthService.resolveBackendUrl();

  readonly currentUser = signal<User | null>(this.loadUser());
  readonly isLoggedIn = computed(() => this.currentUser() !== null);

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
    if (token) localStorage.setItem(this.KEY_TOKEN, token);
    if (refreshToken) localStorage.setItem(this.KEY_REFRESH, refreshToken);
    this.currentUser.set(user);
  }

  getToken(): string | null {
    return localStorage.getItem(this.KEY_TOKEN);
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
    localStorage.removeItem(this.KEY_USER);
    localStorage.removeItem(this.KEY_TOKEN);
    localStorage.removeItem(this.KEY_REFRESH);
    this.currentUser.set(null);
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

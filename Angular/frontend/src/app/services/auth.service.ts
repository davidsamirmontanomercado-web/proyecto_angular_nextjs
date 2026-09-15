import { Injectable, signal, computed } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { inject } from '@angular/core';

export interface User {
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
  private router = inject(Router);

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

  private setSession(user: User) {
    localStorage.setItem(this.KEY_USER, JSON.stringify(user));
    this.currentUser.set(user);
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

  login(correo: string, pass: string): { ok: boolean; error?: string } {
    const users = this.loadUsers();
    const found = users.find(u =>
      u.correo.toLowerCase() === correo.toLowerCase() && u.pass === pass
    );
    if (!found) return { ok: false, error: 'Correo o contraseña incorrectos.' };
    const { pass: _, ...safe } = found;
    this.setSession(safe);
    return { ok: true };
  }

  logout() {
    localStorage.removeItem(this.KEY_USER);
    this.currentUser.set(null);
    this.router.navigateByUrl('/login');
  }

  initials(name?: string): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
}

// ---------- Guards ----------
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
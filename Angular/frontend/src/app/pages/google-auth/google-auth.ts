import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, User } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-google-auth',
  standalone: true,
  imports: [],
  template: `
    <div class="ga-wrap">
      <div class="ga-card">
        <div class="ga-spinner"></div>
        <h2>Iniciando sesión…</h2>
        <p>Redirigiendo al panel de LiveMarket</p>
        @if (errorMsg) {
          <div class="ga-err">{{ errorMsg }}</div>
          <a class="ga-btn" routerLink="/login">Volver al inicio de sesión</a>
        }
      </div>
    </div>
  `,
  styles: [`
    .ga-wrap {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: #0a0a0b;
      color: #fafafa;
    }
    .ga-card {
      width: 100%;
      max-width: 420px;
      text-align: center;
      background: #141418;
      border: 1px solid #26262c;
      border-radius: 20px;
      padding: 36px 28px;
      box-shadow: 0 20px 60px rgba(0,0,0,.5);
    }
    .ga-spinner {
      margin: 0 auto 22px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: 4px solid #26262c;
      border-top-color: #ff3b30;
      animation: ga-spin .9s linear infinite;
    }
    @keyframes ga-spin { to { transform: rotate(360deg); } }
    h2 { margin: 0 0 6px; font-size: 20px; font-weight: 800; letter-spacing: -.02em; }
    p { margin: 0; font-size: 13px; color: #a1a1aa; }
    .ga-err {
      margin-top: 18px;
      background: rgba(255,59,48,.1);
      border: 1px solid rgba(255,59,48,.3);
      color: #fecaca;
      border-radius: 12px;
      padding: 10px 12px;
      font-size: 12.5px;
      line-height: 1.45;
      text-align: left;
    }
    .ga-btn {
      display: inline-block;
      margin-top: 16px;
      padding: 10px 18px;
      border-radius: 999px;
      background: #fafafa;
      color: #0a0a0b;
      font-weight: 700;
      font-size: 13px;
      text-decoration: none;
    }
  `]
})
export default class GoogleAuthComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);
  private toast = inject(ToastService);

  errorMsg = '';

  private base64UrlDecode(input: string): string {
    let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    try {
      const binary = atob(b64);
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return '';
    }
  }

  ngOnInit() {
    try {
      const q = this.route.snapshot.queryParamMap;
      const userB64 = q.get('user');
      const at = q.get('at') || '';
      const rt = q.get('rt') || '';

      if (!userB64) {
        this.failAndRedirect('Faltan datos de la sesión. Vuelve a iniciar sesión con Google.');
        return;
      }

      const jsonStr = this.base64UrlDecode(userB64);
      if (!jsonStr) {
        this.failAndRedirect('Los datos de usuario no se pudieron decodificar.');
        return;
      }
      const raw = JSON.parse(jsonStr);

      if (!raw.correo) {
        this.failAndRedirect('Los datos de usuario son inválidos.');
        return;
      }

      const user: User = {
        id: raw.id,
        nombre: raw.nombre || raw.correo.split('@')[0],
        correo: raw.correo,
        rol: raw.rol === 'comprador' ? 'comprador' : 'empresa',
        createdAt: raw.createdAt || Date.now(),
      };

      this.auth.setSession(user, at, rt);

      this.toast.ok(`¡Bienvenido, ${user.nombre}!`);

      setTimeout(() => {
        this.router.navigateByUrl('/dashboard', { replaceUrl: true });
      }, 350);
    } catch (e: any) {
      console.error('[GoogleAuthComponent] Error:', e);
      this.failAndRedirect('No se pudo completar el inicio de sesión. Inténtalo de nuevo.');
    }
  }

  private failAndRedirect(msg: string) {
    this.errorMsg = msg;
    this.toast.err(msg);
    setTimeout(() => {
      this.router.navigateByUrl('/login', { replaceUrl: true });
    }, 1800);
  }
}

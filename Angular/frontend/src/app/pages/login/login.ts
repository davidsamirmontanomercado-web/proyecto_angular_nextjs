import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.css'
})
export class LoginComponent {
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);

  correo = '';
  pass = '';
  loading = signal(false);
  loadingGoogle = signal(false);
  errorMsg = signal('');

  readonly googleLoginUrl = `${this.auth.backendUrl}/google-auth/login`;

  async onSubmit(e: Event) {
    e.preventDefault();
    if (this.loading()) return;

    this.errorMsg.set('');

    if (!this.correo || !this.pass) {
      this.errorMsg.set('Completa todos los campos.');
      return;
    }

    this.loading.set(true);
    const res = await this.auth.login(this.correo.trim(), this.pass);
    this.loading.set(false);

    if (!res.ok) {
      this.errorMsg.set(res.error || 'Error');
      this.toast.err(res.error || 'Error');
      return;
    }

    this.toast.ok('Bienvenido de nuevo');
    setTimeout(() => this.router.navigateByUrl('/dashboard'), 400);
  }

  async startGoogleLogin(e: MouseEvent) {
    if (this.loadingGoogle()) {
      e.preventDefault();
      return;
    }
    this.loadingGoogle.set(true);
    this.errorMsg.set('');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(this.auth.backendUrl + '/api/auth/login', {
        method: 'OPTIONS',
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timeout);

      if (!res) {
        this.toast.err('No se puede conectar con Next.js. Revisa que esté corriendo en ' + this.auth.backendUrl);
        this.errorMsg.set('El servidor Next.js no está respondiendo.\nEjecuta: cd nextjs → npm run dev');
        this.loadingGoogle.set(false);
        e.preventDefault();
        return;
      }
    } catch {
    }

    this.toast.info('Redirigiendo a Google…');
    setTimeout(() => {
      window.location.href = this.googleLoginUrl;
    }, 250);
  }
}

import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-recuperar-contrasena',
  imports: [FormsModule, RouterLink],
  templateUrl: './recuperar-contrasena.html',
  styleUrl: './recuperar-contrasena.css'
})
export class RecuperarContrasenaComponent {
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);

  correo = '';
  enviado = signal(false);
  errorMsg = signal('');
  cargando = signal(false);
  tokenDemo = signal('');

  onSubmit(e: Event) {
    e.preventDefault();
    this.errorMsg.set('');

    if (!this.correo) {
      this.errorMsg.set('Ingresa tu correo electrónico.');
      return;
    }

    this.cargando.set(true);
    setTimeout(() => {
      const res = this.auth.solicitarRecuperacion(this.correo.trim());
      this.cargando.set(false);

      if (!res.ok) {
        this.errorMsg.set(res.error || 'Error');
        this.toast.err(res.error || 'Error');
        return;
      }

      this.tokenDemo.set(res.token!);
      this.enviado.set(true);
      this.toast.ok('Correo de recuperación enviado');
    }, 700);
  }

  irARestablecer() {
    this.router.navigate(['/restablecer-contrasena'], { queryParams: { token: this.tokenDemo() } });
  }
}

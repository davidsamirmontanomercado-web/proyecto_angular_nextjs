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

  async onSubmit(e: Event) {
    e.preventDefault();
    this.errorMsg.set('');

    if (!this.correo) {
      this.errorMsg.set('Ingresa tu correo electrónico.');
      return;
    }

    this.cargando.set(true);
    const res: any = await this.auth.solicitarRecuperacionRemote(this.correo.trim());
    this.cargando.set(false);

    if (res.ok) {
      this.enviado.set(true);
      this.toast.ok('Correo de recuperación enviado');
    } else {
      console.log('Error de recuperación:', res);
      this.errorMsg.set(res.error || 'No se pudo enviar el correo.');
      this.toast.err(res.error || 'Error al enviar');
    }
  }
}

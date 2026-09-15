import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-registro',
  imports: [FormsModule, RouterLink],
  templateUrl: './registro.html',
  styleUrl: './registro.css'
})
export class RegistroComponent {
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);

  nombre = '';
  correo = '';
  pass = '';
  pass2 = '';
  terms = false;
  role: 'empresa' | 'comprador' = 'empresa';
  errorMsg = signal('');

  setRole(r: 'empresa' | 'comprador') { this.role = r; }

  onSubmit(e: Event) {
    e.preventDefault();
    this.errorMsg.set('');

    if (!this.nombre || !this.correo || !this.pass || !this.pass2) {
      this.errorMsg.set('Completa todos los campos.');
      return;
    }
    if (!this.terms) {
      this.errorMsg.set('Debes aceptar los términos y condiciones.');
      return;
    }
    if (this.pass.length < 6) {
      this.errorMsg.set('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (this.pass !== this.pass2) {
      this.errorMsg.set('Las contraseñas no coinciden.');
      return;
    }

    const res = this.auth.register({
      nombre: this.nombre.trim(),
      correo: this.correo.trim(),
      pass: this.pass,
      rol: this.role
    });

    if (!res.ok) {
      this.errorMsg.set(res.error || 'Error');
      this.toast.err(res.error || 'Error');
      return;
    }

    this.toast.ok('Cuenta creada con éxito');
    setTimeout(() => this.router.navigateByUrl('/dashboard'), 500);
  }
}
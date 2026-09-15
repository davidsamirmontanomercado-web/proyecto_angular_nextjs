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
  errorMsg = signal('');

  onSubmit(e: Event) {
    e.preventDefault();
    this.errorMsg.set('');

    if (!this.correo || !this.pass) {
      this.errorMsg.set('Completa todos los campos.');
      return;
    }

    const res = this.auth.login(this.correo.trim(), this.pass);
    if (!res.ok) {
      this.errorMsg.set(res.error || 'Error');
      this.toast.err(res.error || 'Error');
      return;
    }

    this.toast.ok('Bienvenido de nuevo');
    setTimeout(() => this.router.navigateByUrl('/dashboard'), 400);
  }
}
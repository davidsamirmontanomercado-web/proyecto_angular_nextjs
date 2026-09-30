import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-restablecer-contrasena',
  imports: [FormsModule, RouterLink],
  templateUrl: './restablecer-contrasena.html',
  styleUrl: './restablecer-contrasena.css'
})
export class RestablecerContrasenaComponent implements OnInit {
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  pass = '';
  pass2 = '';
  token = signal('');
  tokenValido = signal(false);
  tokenError = signal('');
  errorMsg = signal('');
  cargando = signal(false);
  exito = signal(false);
  mostrarPass = signal(false);
  mostrarPass2 = signal(false);

  fuerza = computed(() => {
    const p = this.pass;
    if (!p) return 0;
    let score = 0;
    if (p.length >= 8) score++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
    if (/\d/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    return score;
  });

  fuerzaLabel = computed(() => {
    const f = this.fuerza();
    return ['', 'Débil', 'Regular', 'Buena', 'Excelente'][f] || '';
  });

  ngOnInit() {
    const t = this.route.snapshot.queryParamMap.get('token') || '';
    this.token.set(t);
    if (!t) {
      this.tokenError.set('Enlace inválido. Solicita uno nuevo.');
      return;
    }
    const val = this.auth.validarToken(t);
    if (!val.ok) {
      this.tokenError.set(val.error || 'Token inválido.');
    } else {
      this.tokenValido.set(true);
    }
  }

  onSubmit(e: Event) {
    e.preventDefault();
    this.errorMsg.set('');

    if (!this.pass) {
      this.errorMsg.set('Ingresa la nueva contraseña.');
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

    this.cargando.set(true);
    setTimeout(() => {
      const res = this.auth.restablecerContrasena(this.token(), this.pass);
      this.cargando.set(false);

      if (!res.ok) {
        this.errorMsg.set(res.error || 'Error');
        this.toast.err(res.error || 'Error');
        return;
      }

      this.exito.set(true);
      this.toast.ok('Contraseña actualizada correctamente');
    }, 700);
  }

  irAlLogin() {
    this.router.navigateByUrl('/login');
  }
}

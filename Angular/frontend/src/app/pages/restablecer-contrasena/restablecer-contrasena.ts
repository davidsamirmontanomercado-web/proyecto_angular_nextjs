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
    // Primero intentamos del query param (por si viene de un link directo custom)
    let t = this.route.snapshot.queryParamMap.get('token') || '';
    
    // Si no está en query params, buscamos en el fragmento (#access_token=...) 
    // que es como Supabase envía el link de recuperación por defecto.
    if (!t) {
      const fragment = this.route.snapshot.fragment || '';
      const params = new URLSearchParams(fragment);
      t = params.get('access_token') || '';
    }

    if (t) {
      this.token.set(t);
      this.tokenValido.set(true);
    } else {
      this.tokenError.set('No se encontró un token de acceso válido en el enlace.');
    }
  }

  async onSubmit(e: Event) {
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
    // Usamos el token capturado o el del AuthService si ya se procesó
    const tokenParaEnviar = this.token() || this.auth.getToken() || '';
    
    if (!tokenParaEnviar) {
      this.errorMsg.set('Tu sesión ha expirado o el enlace ya no es válido. Solicita uno nuevo.');
      this.cargando.set(false);
      return;
    }

    const res = await this.auth.restablecerContrasenaRemote(tokenParaEnviar, this.pass);
    this.cargando.set(false);

    if (!res.ok) {
      this.errorMsg.set(res.error || 'Error');
      this.toast.err(res.error || 'Error');
      return;
    }

    this.exito.set(true);
    this.toast.ok('Contraseña actualizada correctamente');
  }

  irAlLogin() {
    this.router.navigateByUrl('/login');
  }
}

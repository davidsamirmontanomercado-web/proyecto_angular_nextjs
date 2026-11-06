import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.css'
})export class LoginComponent implements OnInit {
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  correo = '';
  pass = '';
  recordarme = false;
  loading = signal(false);
  loadingGoogle = signal(false);
  errorMsg = signal('');

  // Estado MFA
  mfaRequired = signal(false);
  mfaCode = '';
  private mfaFactorId = '';
  private mfaChallengeId = '';

  readonly googleLoginUrl = this.auth.googleLoginUrl;

  ngOnInit() {
    const savedEmail = localStorage.getItem('lm_remember_email');
    if (savedEmail) {
      this.correo = savedEmail;
      this.recordarme = true;
    }

    // Detectar si venimos de un flujo MFA (ej. Google Auth)
    const q = this.route.snapshot.queryParamMap;
    if (q.get('mfa') === '1') {
      const fid = q.get('fid');
      if (fid) {
        this.mfaFactorId = fid;
        this.iniciarDesafioMfa(fid);
      }
    }
  }

  async iniciarDesafioMfa(fid: string) {
    const challengeRes = await this.auth.challengeMFA(fid);
    if (challengeRes.ok) {
      this.mfaChallengeId = challengeRes.data.id;
      this.mfaRequired.set(true);
    } else {
      this.errorMsg.set('Error al iniciar verificación de seguridad');
    }
  }

  async onSubmit(e: Event) {
    e.preventDefault();

    if (this.loading()) return;

    this.errorMsg.set('');

    if (!this.correo || !this.pass) {
      this.errorMsg.set('Completa todos los campos.');
      return;
    }

    this.loading.set(true);

    const res = await this.auth.login(
      this.correo.trim(),
      this.pass,
      this.recordarme
    );

    if (!res.ok) {
      this.loading.set(false);
      this.errorMsg.set(res.error || 'Error');
      this.toast.err(res.error || 'Error');
      return;
    }

    if (res.mfaRequired) {
      this.loading.set(false);
      this.mfaFactorId = res.factors?.[0]?.id;
      
      // Iniciar desafío MFA
      const challengeRes = await this.auth.challengeMFA(this.mfaFactorId);
      if (challengeRes.ok) {
        this.mfaChallengeId = challengeRes.data.id;
        this.mfaRequired.set(true);
        this.toast.info('Verificación en dos pasos requerida');
      } else {
        this.errorMsg.set('Error al iniciar verificación de seguridad');
      }
      return;
    }

    this.completeLogin();
  }

  async onMfaSubmit(e: Event) {
    e.preventDefault();
    if (this.loading()) return;

    if (!this.mfaCode || this.mfaCode.length < 6) {
      this.errorMsg.set('Ingresa el código de 6 dígitos.');
      return;
    }

    this.loading.set(true);
    const res = await this.auth.verifyMFA(this.mfaFactorId, this.mfaChallengeId, this.mfaCode);
    
    if (res.ok) {
      this.completeLogin();
    } else {
      this.loading.set(false);
      this.errorMsg.set(res.error || 'Código incorrecto');
      this.toast.err('Código de seguridad incorrecto');
    }
  }

  private completeLogin() {
    this.loading.set(false);
    if (this.recordarme) {
      localStorage.setItem('lm_remember_email', this.correo.trim());
    } else {
      localStorage.removeItem('lm_remember_email');
    }

    this.toast.ok('Bienvenido de nuevo');

    // Cada rol aterriza en su propia página de inicio (vendedor: panel;
    // comprador: tienda).
    const destino = this.auth.rutaInicio();
    setTimeout(() => {
      this.router.navigateByUrl(destino);
    }, 400);
  }

  cancelMfa() {
    this.mfaRequired.set(false);
    this.mfaCode = '';
    this.errorMsg.set('');
  }

  startGoogleLogin(e: MouseEvent) {
    if (this.loadingGoogle()) {
      e.preventDefault();
      return;
    }

    e.preventDefault();

    this.loadingGoogle.set(true);
    this.errorMsg.set('');

    this.toast.info('Redirigiendo a Google…');

    window.location.href = this.googleLoginUrl;
  }
}
import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService, UserRole } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { FooterComponent } from '../../shared/footer/footer';

@Component({
  selector: 'app-configuracion',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent, FooterComponent],
  templateUrl: './configuracion.html',
  styleUrl: './configuracion.css'
})
export class ConfiguracionComponent implements OnInit {
  auth = inject(AuthService);
  private toast = inject(ToastService);

  nombre = '';
  correo = '';
  rol: UserRole = 'comprador';
  provider: 'google' | 'local' | undefined = 'local';
  
  // Datos empresariales
  empresa = {
    nombre_empresa: '',
    descripcion: '',
    ubicacion: '',
    telefono_contacto: '',
    correo_contacto: '',
    horario: '',
    info_envios: '',
    metodos_pago: '',
    categoria_negocio: '',
    url_web: '',
    instagram: '',
    facebook: ''
  };

  // Password para usuarios Google o cambio de pass
  nuevaPassword = '';
  confirmarPassword = '';
  
  loading = signal(false);
  loadingPass = signal(false);
  twoFactorEnabled = signal(false);
  sesiones = signal<any[]>([]);

  // Modales de confirmación premium
  showConfirmMFA = signal(false);
  showDeleteAccountConfirm = signal(false);

  // Solicitud de vendedor
  solicitudVendedor = signal<any>(null);
  enviandoSolicitud = signal(false);
  mensajeSolicitud = '';

  // Estado MFA
  mfaStep = signal<'none' | 'enrolling' | 'verifying'>('none');
  mfaQR = signal<string | null>(null);
  mfaSecret = signal<string | null>(null);
  mfaFactorId = signal<string | null>(null);
  mfaChallengeId = signal<string | null>(null);
  mfaCode = '';

  ngOnInit() {
    this.cargarDatos();
    this.cargarSesiones();
    this.verificarMFA();
    this.cargarSolicitud();
  }

  async cargarSolicitud() {
    if (this.rol === 'comprador') {
      const res = await this.auth.obtenerEstadoSolicitudVendedor();
      if (res.ok) this.solicitudVendedor.set(res.data);
    }
  }

  async solicitarSerVendedor() {
    this.enviandoSolicitud.set(true);
    const res = await this.auth.enviarSolicitudVendedor(this.mensajeSolicitud || 'Quiero vender en LiveMarket.');
    this.enviandoSolicitud.set(false);

    if (res.ok) {
      this.toast.ok('Solicitud enviada correctamente.');
      this.cargarSolicitud();
    } else {
      this.toast.err(res.error || 'Error al enviar solicitud.');
    }
  }

  async verificarMFA() {
    const res = await this.auth.getMFAFactors();
    if (res.ok && res.activeFactor) {
      this.twoFactorEnabled.set(true);
      this.mfaFactorId.set(res.activeFactor.id);
    } else {
      this.twoFactorEnabled.set(false);
    }
  }

  async toggle2FA() {
    const currentState = this.twoFactorEnabled();
    
    if (!currentState) {
      // Iniciar enrolamiento
      this.loading.set(true);
      const res = await this.auth.enrollMFA();
      this.loading.set(true); // Mantener loading durante el proceso

      if (res.ok && res.data) {
        this.mfaQR.set(res.data.totp.qr_code);
        this.mfaSecret.set(res.data.totp.secret);
        this.mfaFactorId.set(res.data.id);
        this.mfaStep.set('enrolling');
        this.toast.info('Escanea el código QR con tu app de autenticación');
      } else {
        this.toast.err(res.error || 'Error al iniciar 2FA');
      }
      this.loading.set(false);
    } else {
      // Mostrar modal premium en lugar de confirm()
      this.showConfirmMFA.set(true);
    }
  }

  async confirmDisable2FA() {
    this.showConfirmMFA.set(false);
    const factorId = this.mfaFactorId();
    if (!factorId) return;

    this.loading.set(true);
    const res = await this.auth.unenrollMFA(factorId);
    this.loading.set(false);

    if (res.ok) {
      this.twoFactorEnabled.set(false);
      this.mfaStep.set('none');
      this.mfaFactorId.set(null);
      this.toast.ok('2FA desactivado correctamente');
    } else {
      this.toast.err(res.error || 'Error al desactivar 2FA');
    }
  }

  closeMFAConfirm() {
    this.showConfirmMFA.set(false);
    // Resetear el switch visualmente si es necesario
    this.verificarMFA();
  }

  async confirmarMFA() {
    if (!this.mfaCode || this.mfaCode.length < 6) {
      this.toast.err('Ingresa el código de 6 dígitos');
      return;
    }

    this.loading.set(true);
    const factorId = this.mfaFactorId();
    if (!factorId) return;

    // 1. Crear desafío
    const challengeRes = await this.auth.challengeMFA(factorId);
    if (!challengeRes.ok) {
      this.loading.set(false);
      this.toast.err(challengeRes.error || 'Error al crear desafío');
      return;
    }

    // 2. Verificar
    const verifyRes = await this.auth.verifyMFA(factorId, challengeRes.data.id, this.mfaCode);
    this.loading.set(false);

    if (verifyRes.ok) {
      this.twoFactorEnabled.set(true);
      this.mfaStep.set('none');
      this.mfaQR.set(null);
      this.mfaSecret.set(null);
      this.mfaCode = '';
      this.toast.ok('2FA activado correctamente. ¡Tu cuenta ahora es segura!');
    } else {
      this.toast.err(verifyRes.error || 'Código incorrecto');
    }
  }

 cancelarMFA() {
    this.mfaStep.set('none');
    this.mfaQR.set(null);
    this.mfaSecret.set(null);
    this.mfaCode = '';
  }

  async cargarSesiones() {
    const res = await this.auth.getSesiones();
    if (res.ok && res.sesiones) {
      this.sesiones.set(res.sesiones);
    }
  }

  async cerrarSesion(id: string) {
    const sesion = this.sesiones().find(s => s.id === id);
    const res = await this.auth.cerrarSesionRemote(id);
    
    if (res.ok) {
      this.toast.ok('Sesión cerrada');
      if (sesion?.es_actual) {
        this.auth.logout();
      } else {
        this.cargarSesiones();
      }
    } else {
      this.toast.err(res.error || 'Error al cerrar la sesión');
    }
  }

  async cargarDatos() {
    const res = await this.auth.getPerfil();
    if (res.ok && res.data) {
      this.nombre = res.data.usuario.nombre || '';
      this.correo = res.data.usuario.correo || '';
      this.rol = res.data.rol;
      this.provider = res.data.usuario.provider;
      
      if (res.data.perfilEmpresa) {
        this.empresa = {
          nombre_empresa: res.data.perfilEmpresa.nombre_empresa || '',
          descripcion: res.data.perfilEmpresa.descripcion || '',
          ubicacion: res.data.perfilEmpresa.ubicacion || '',
          telefono_contacto: res.data.perfilEmpresa.telefono_contacto || '',
          correo_contacto: res.data.perfilEmpresa.correo_contacto || '',
          horario: res.data.perfilEmpresa.horario || '',
          info_envios: res.data.perfilEmpresa.info_envios || '',
          metodos_pago: res.data.perfilEmpresa.metodos_pago || '',
          categoria_negocio: res.data.perfilEmpresa.categoria_negocio || '',
          url_web: res.data.perfilEmpresa.url_web || '',
          instagram: res.data.perfilEmpresa.instagram || '',
          facebook: res.data.perfilEmpresa.facebook || ''
        };
      }
    } else {
      const u = this.auth.currentUser();
      if (u) {
        this.nombre = u.nombre;
        this.correo = u.correo;
        this.rol = u.rol;
        this.provider = u.provider;
      }
    }
  }

  async guardar() {
    if (this.loading()) return;
    this.loading.set(true);

    const esVendedor = this.auth.esVendedorVista();
    const payload: any = {
      nombre: this.nombre,
      perfilEmpresa: esVendedor ? { ...this.empresa } : null
    };

    const res = await this.auth.updatePerfil(payload);
    this.loading.set(false);

    if (res.ok) {
      this.toast.ok('Perfil actualizado correctamente');
    } else {
      this.toast.err(res.error || 'Error al actualizar el perfil');
    }
  }

  async actualizarPassword() {
    if (!this.nuevaPassword) {
      this.toast.err('Ingresa una nueva contraseña');
      return;
    }
    if (this.nuevaPassword !== this.confirmarPassword) {
      this.toast.err('Las contraseñas no coinciden');
      return;
    }
    if (this.nuevaPassword.length < 6) {
      this.toast.err('La contraseña debe tener al menos 6 caracteres');
      return;
    }

    this.loadingPass.set(true);
    const token = this.auth.getToken();
    
    if (!token) {
      this.toast.err('Sesión no válida');
      this.loadingPass.set(false);
      return;
    }

    const res = await this.auth.restablecerContrasenaRemote(token, this.nuevaPassword);
    this.loadingPass.set(false);

    if (res.ok) {
      this.toast.ok('Contraseña establecida correctamente. Ahora puedes usarla para iniciar sesión.');
      this.nuevaPassword = '';
      this.confirmarPassword = '';
    } else {
      this.toast.err(res.error || 'Error al establecer la contraseña');
    }
  }

  logout() {
    this.auth.logout();
  }

  async eliminarCuenta() {
    this.showDeleteAccountConfirm.set(true);
  }

  async confirmDeleteAccount() {
    this.showDeleteAccountConfirm.set(false);
    this.toast.info('Funcionalidad en desarrollo. Contacta a soporte para eliminación manual.');
  }

  closeDeleteConfirm() {
    this.showDeleteAccountConfirm.set(false);
  }
}

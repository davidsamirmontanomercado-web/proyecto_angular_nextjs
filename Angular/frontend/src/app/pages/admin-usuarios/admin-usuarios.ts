import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService, UserRole } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { FooterComponent } from '../../shared/footer/footer';

interface UsuarioAdmin {
  id: string;
  nombre: string | null;
  correo: string | null;
  rol: UserRole;
  tipo_cuenta?: string | null;
  fecha_registro?: string | null;
}

@Component({
  selector: 'app-admin-usuarios',
  standalone: true,
  imports: [CommonModule, NavbarComponent, FooterComponent],
  templateUrl: './admin-usuarios.html',
  styleUrl: './admin-usuarios.css'
})
export class AdminUsuariosComponent implements OnInit {
  public auth = inject(AuthService);
  private toast = inject(ToastService);

  readonly roles: UserRole[] = ['comprador', 'vendedor', 'administrador'];

  usuarios = signal<UsuarioAdmin[]>([]);
  solicitudes = signal<any[]>([]);
  vista = signal<'usuarios' | 'solicitudes'>('usuarios');
  cargando = signal(true);
  guardandoId = signal<string | null>(null);
  filtro = signal('');

  ngOnInit() {
    this.cargar();
  }

  idActual(): string | undefined {
    return this.auth.currentUser()?.id;
  }

  setVista(v: 'usuarios' | 'solicitudes') {
    this.vista.set(v);
    this.cargar();
  }

  async cargar() {
    console.log(`[AdminUsuarios] Cargando vista: ${this.vista()}`);
    this.cargando.set(true);
    
    // Aseguramos que el token esté fresco antes de pedir datos protegidos
    await this.auth.ensureFreshToken();
    
    if (this.vista() === 'usuarios') {
      const res = await this.auth.listarUsuariosAdmin();
      if (res.ok) {
        const lista = (res.usuarios as UsuarioAdmin[]) || [];
        console.table(lista.map(u => ({
          correo: u.correo,
          rol: u.rol,
          tipo_cuenta: u.tipo_cuenta,
          rolEfectivo: this.rolEfectivo(u)
        })));
        this.usuarios.set(lista);
      } else {
        this.toast.err(res.error || 'No se pudieron cargar los usuarios');
      }
    } else {
      const res = await this.auth.listarSolicitudesAdmin();
      console.log('[AdminUsuarios] Respuesta listarSolicitudes:', res);
      if (res.ok) {
        const lista = res.solicitudes || [];
        console.log(`[AdminUsuarios] Solicitudes recibidas: ${lista.length}`);
        this.solicitudes.set(lista);
      } else {
        this.toast.err(res.error || 'No se pudieron cargar las solicitudes');
      }
    }
    this.cargando.set(false);
  }

  async resolverSolicitud(id: string, accion: 'aprobar' | 'rechazar') {
    this.guardandoId.set(id);
    const res = await this.auth.resolverSolicitudAdmin(id, accion);
    this.guardandoId.set(null);

    if (res.ok) {
      this.toast.ok(`Solicitud ${accion === 'aprobar' ? 'aprobada' : 'rechazada'} correctamente`);
      this.cargar();
    } else {
      this.toast.err(res.error || 'Error al procesar solicitud');
    }
  }

  visibles(): UsuarioAdmin[] {
    const q = this.filtro().trim().toLowerCase();
    if (!q) return this.usuarios();
    return this.usuarios().filter(u =>
      (u.nombre || '').toLowerCase().includes(q) ||
      (u.correo || '').toLowerCase().includes(q)
    );
  }

  onRolChange(u: UsuarioAdmin, e: Event) {
    const nuevo = (e.target as HTMLSelectElement).value;
    this.cambiarRol(u, nuevo);
  }

  async cambiarRol(usuario: UsuarioAdmin, nuevo: string) {
    const rolActual = this.rolEfectivo(usuario);
    if (nuevo === rolActual) return;
    
    console.log(`[AdminUsuarios] Solicitando cambio de rol para ${usuario.correo}: ${rolActual} -> ${nuevo}`);
    this.toast.info(`Actualizando rol de ${usuario.nombre || usuario.correo}...`);
    
    this.guardandoId.set(usuario.id);
    const res = await this.auth.cambiarRolUsuario(usuario.id, nuevo as UserRole);
    this.guardandoId.set(null);

    if (!res.ok) {
      console.error('[AdminUsuarios] Error al cambiar rol:', res.error);
      this.toast.err(res.error || 'No se pudo cambiar el rol');
      return;
    }

    this.toast.ok(`Rol de ${usuario.nombre || 'usuario'} actualizado a ${this.etiquetaRol(nuevo)}`);
    
    // Añadimos un pequeño retraso antes de recargar para dar tiempo a Supabase a propagar los cambios
    setTimeout(async () => {
      const refresh = await this.auth.listarUsuariosAdmin();
      if (refresh.ok) {
        this.usuarios.set((refresh.usuarios as UsuarioAdmin[]) || []);
        console.log('[AdminUsuarios] Lista recargada tras cambio de rol:', this.usuarios());
      }
    }, 1000);
  }

  iniciales(u: UsuarioAdmin): string {
    return this.auth.initials(u.nombre || u.correo || '');
  }

  rolEfectivo(u: UsuarioAdmin): UserRole {
    // Intentamos obtener el valor de cualquier columna disponible
    // Si cualquiera de los campos dice vendedor, entonces es vendedor.
    const rAuth = String(u.rol || '').toLowerCase().trim();
    const rDB = String(u.tipo_cuenta || '').toLowerCase().trim();
    
    if (rAuth === 'vendedor' || rDB === 'vendedor') return 'vendedor';
    if (rAuth === 'administrador' || rAuth === 'admin' || rDB === 'administrador' || rDB === 'admin') return 'administrador';
    
    return 'comprador';
  }

  etiquetaRol(val: any): string {
    if (!val) return 'Comprador';
    // Si nos pasan el objeto de usuario, intentamos sacar el rol de sus campos
    const raw = typeof val === 'object' ? (val.rol || val.tipo_cuenta) : val;
    const r = String(raw || '').toLowerCase().trim();
    
    if (r === 'vendedor') return 'Vendedor';
    if (r === 'administrador' || r === 'admin') return 'Administrador';
    return 'Comprador';
  }

  fecha(valor?: string | null): string {
    if (!valor) return '—';
    try {
      return new Date(valor).toLocaleDateString('es-CO', {
        year: 'numeric', month: 'short', day: 'numeric'
      });
    } catch {
      return '—';
    }
  }

  actualizarFiltro(e: Event) {
    this.filtro.set((e.target as HTMLInputElement).value);
  }
}

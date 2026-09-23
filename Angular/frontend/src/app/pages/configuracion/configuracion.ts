import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { FooterComponent } from '../../shared/footer/footer';

@Component({
  selector: 'app-configuracion',
  imports: [FormsModule, NavbarComponent, FooterComponent],
  templateUrl: './configuracion.html',
  styleUrl: './configuracion.css'
})
export class ConfiguracionComponent implements OnInit {
  auth = inject(AuthService);
  private toast = inject(ToastService);

  nombre = '';
  correo = '';

  ngOnInit() {
    const u = this.auth.currentUser();
    if (u) {
      this.nombre = u.nombre;
      this.correo = u.correo;
    }
  }

  guardar() { this.toast.ok('Cambios guardados'); }
  logout() { this.auth.logout(); }

  eliminarCuenta() {
    if (confirm('¿Eliminar tu cuenta? Esta acción no se puede deshacer.')) {
      localStorage.clear();
      window.location.href = '/';
    }
  }
}
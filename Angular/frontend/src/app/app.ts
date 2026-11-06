
import { Component, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastComponent } from './shared/toast/toast';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private auth = inject(AuthService);

  constructor() {
    // Refleja en el <body> el tema de la vista activa (vendedor / comprador /
    // administrador) para que las variables CSS de acento cambien según el rol.
    // Sin sesión no se aplica ninguna vista: las páginas públicas quedan neutras.
    effect(() => {
      const vista = this.auth.isLoggedIn() ? this.auth.vistaActual() : null;
      if (typeof document === 'undefined') return;
      if (vista) {
        document.body.setAttribute('data-vista', vista);
      } else {
        document.body.removeAttribute('data-vista');
      }
    });
  }
}
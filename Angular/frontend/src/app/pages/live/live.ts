import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { FooterComponent } from '../../shared/footer/footer';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-live',
  imports: [RouterLink, NavbarComponent, FooterComponent, FormsModule],
  templateUrl: './live.html',
  styleUrl: './live.css'
})
export class LiveComponent {
  suscrito = true;
  likes = false;
  chatVisible = true;
  nuevoMensaje = '';
  mensajes = [
    { nombre: 'Carlos M.', texto: '¿Hacen envíos a todo el país? Me interesa el escritorio ejecutivo.' },
    { nombre: 'Ana R.', texto: 'Excelente calidad, ya tengo mi pedido listo. 🔥' },
    { nombre: 'Luis P.', texto: '¿Tienen versión en madera natural?' }
  ];

  vivosRecomendados = [
    {
      id: 1,
      titulo: 'Ofertas de fin de semana · Decoración hogar',
      empresa: 'Casa Studio',
      espectadores: 842,
      categoria: 'Decoración',
      hace: 'Hace 8 min',
      color: 'linear-gradient(135deg,#f59e0b,#ef4444)'
    },
    {
      id: 2,
      titulo: 'Lanzamiento línea ropa deportiva 2025',
      empresa: 'FitSport Colombia',
      espectadores: 2310,
      categoria: 'Moda y belleza',
      hace: 'Hace 24 min',
      color: 'linear-gradient(135deg,#22c55e,#0ea5e9)'
    },
    {
      id: 3,
      titulo: 'Subasta de electrodomésticos remanufacturados',
      empresa: 'TechVerde',
      espectadores: 560,
      categoria: 'Electrónica',
      hace: 'Hace 3 min',
      color: 'linear-gradient(135deg,#6366f1,#a855f7)'
    },
    {
      id: 4,
      titulo: 'Showroom de joyería artesanal · Piezas únicas',
      empresa: 'Joyas del Caribe',
      espectadores: 328,
      categoria: 'Accesorios',
      hace: 'Hace 15 min',
      color: 'linear-gradient(135deg,#ec4899,#8b5cf6)'
    },
    {
      id: 5,
      titulo: 'Cocina en vivo · Recetas con productos locales',
      empresa: 'Sabor Costeño',
      espectadores: 1540,
      categoria: 'Alimentos',
      hace: 'Hace 38 min',
      color: 'linear-gradient(135deg,#f97316,#eab308)'
    },
    {
      id: 6,
      titulo: 'Venta flash de herramientas profesionales',
      empresa: 'Ferretería Industrial',
      espectadores: 712,
      categoria: 'Industria',
      hace: 'Hace 5 min',
      color: 'linear-gradient(135deg,#0891b2,#475569)'
    }
  ];

  toggleLike() { this.likes = !this.likes; }
  toggleSub() { this.suscrito = !this.suscrito; }
  toggleChat() { this.chatVisible = !this.chatVisible; }

  enviarMensaje() {
    const texto = this.nuevoMensaje.trim();
    if (!texto) return;
    this.mensajes.push({ nombre: 'Tú', texto });
    this.nuevoMensaje = '';
  }
}
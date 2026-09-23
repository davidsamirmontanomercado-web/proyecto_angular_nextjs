import { Component, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { FooterComponent } from '../../shared/footer/footer';

@Component({
  selector: 'app-perfil',
  imports: [RouterLink, NavbarComponent, FooterComponent],
  templateUrl: './perfil.html',
  styleUrl: './perfil.css'
})
export class PerfilComponent implements OnInit {
  auth = inject(AuthService);
  nombre = 'Muebles Caribe';
  initials = 'MC';

  ngOnInit() {
    const u = this.auth.currentUser();
    if (u) {
      this.nombre = u.nombre || u.correo.split('@')[0];
      this.initials = this.auth.initials(this.nombre);
    }
  }
}
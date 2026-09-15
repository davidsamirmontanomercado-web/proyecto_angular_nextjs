import { Component, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { FooterComponent } from '../../shared/footer/footer';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, NavbarComponent, FooterComponent],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class DashboardComponent implements OnInit {
  auth = inject(AuthService);
  nombre = '';

  ngOnInit() {
    const u = this.auth.currentUser();
    if (u) this.nombre = u.nombre || u.correo.split('@')[0];
  }

  logout() { this.auth.logout(); }
}
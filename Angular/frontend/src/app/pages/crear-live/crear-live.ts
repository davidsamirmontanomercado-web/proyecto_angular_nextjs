import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ToastService } from '../../services/toast.service';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { FooterComponent } from '../../shared/footer/footer';

@Component({
  selector: 'app-crear-live',
  imports: [RouterLink, FormsModule, NavbarComponent, FooterComponent],
  templateUrl: './crear-live.html',
  styleUrl: './crear-live.css'
})
export class CrearLiveComponent {
  private toast = inject(ToastService);
  private router = inject(Router);

  onSubmit(e: Event) {
    e.preventDefault();
    this.toast.ok('Transmisión creada · saliendo al aire');
    setTimeout(() => this.router.navigateByUrl('/live'), 700);
  }
}
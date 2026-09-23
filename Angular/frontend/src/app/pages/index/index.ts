import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { FooterComponent } from '../../shared/footer/footer';

@Component({
  selector: 'app-index',
  imports: [RouterLink, NavbarComponent, FooterComponent],
  templateUrl: './index.html',
  styleUrl: './index.css'
})
export class IndexComponent {}
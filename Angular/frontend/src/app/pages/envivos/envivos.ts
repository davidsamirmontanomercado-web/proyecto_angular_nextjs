import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { FooterComponent } from '../../shared/footer/footer';

@Component({
  selector: 'app-envivos',
  imports: [RouterLink, NavbarComponent, FooterComponent],
  templateUrl: './envivos.html',
  styleUrl: './envivos.css'
})
export class EnvivosComponent {
  filtro = 'Todos';
  filtros = ['Todos', 'Ventas · Nuevos', 'Producción', 'Usados'];

  lives = [
    { cat: 'Ventas · Productos nuevos', titulo: 'Lanzamiento colección muebles 2025', desc: 'Muestra en vivo de la nueva línea de muebles de oficina y hogar.', viewers: '1.2K', tags: ['Ver catálogo','Productos'] },
    { cat: 'Producción · Fábrica', titulo: 'Proceso de fabricación de tornos CNC', desc: 'Recorrido por la planta de producción y maquinaria industrial.', viewers: '856', tags: ['Ver catálogo','Servicios'] },
    { cat: 'Usados · Equipos', titulo: 'Remate de maquinaria usada certificada', desc: 'Equipos industriales usados con garantía y revisión técnica.', viewers: '2.4K', tags: ['Ver catálogo','Filtros'] },
    { cat: 'Ventas · Tecnología', titulo: 'Nuevos equipos de cómputo empresarial', desc: 'Portátiles, workstations y servidores para empresas.', viewers: '640', tags: ['Ver catálogo','Productos'] },
    { cat: 'Producción · Alimentos', titulo: 'Línea de empaque automatizada', desc: 'Conoce la maquinaria de empaque y sellado industrial.', viewers: '1.8K', tags: ['Ver catálogo','Servicios'] },
    { cat: 'Usados · Oficina', titulo: 'Liquidación de mobiliario de oficina', desc: 'Escritorios, sillas y archivadores usados en excelente estado.', viewers: '420', tags: ['Ver catálogo','Filtros'] }
  ];
}
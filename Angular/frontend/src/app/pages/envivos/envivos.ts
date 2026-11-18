import { Component, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { FooterComponent } from '../../shared/footer/footer';
import { TransmisionesService, Transmision } from '../../services/transmisiones.service';

interface LiveCard {
  cat: string;
  categoriaNombre: string;
  titulo: string;
  desc: string;
  viewers: string;
  imagen: string | null;
  tags: string[];
  raw: Transmision;
}

@Component({
  selector: 'app-envivos',
  imports: [RouterLink, NavbarComponent, FooterComponent, CommonModule],
  templateUrl: './envivos.html',
  styleUrl: './envivos.css'
})
export class EnvivosComponent implements OnInit {
  private transmisionesService = inject(TransmisionesService);

  readonly FILTRO_TODOS = 'Todos';
  filtro = this.FILTRO_TODOS;
  filtros: string[] = [this.FILTRO_TODOS];

  lives: LiveCard[] = [];
  loading = false;
  error: string | null = null;

  ngOnInit(): void {
    this.cargarTransmisiones();
  }

  private buildCategoriaLabel(t: Transmision): string {
    const nombre = t.categoria?.nombre?.trim() ?? '';
    const sub = t.subcategoria?.trim() ?? '';
    if (nombre && sub) return `${nombre} · ${sub}`;
    return nombre || sub;
  }

  private mapTransmision(t: Transmision): LiveCard {
    const categoriaNombre = t.categoria?.nombre?.trim() ?? '';
    const viewers = t.espectadores_actuales ?? t.espectadores_totales ?? 0;
    const tags = ['Ver catálogo'];
    if (categoriaNombre) tags.push(categoriaNombre);
    if (t.subcategoria && t.subcategoria !== categoriaNombre) tags.push(t.subcategoria);
    return {
      cat: this.buildCategoriaLabel(t),
      categoriaNombre,
      titulo: t.titulo?.trim() || 'Sin título',
      desc: t.descripcion?.trim() || '',
      viewers: typeof viewers === 'number' ? viewers.toLocaleString() : String(viewers),
      imagen: t.imagen_portada || null,
      tags: Array.from(new Set(tags)),
      raw: t
    };
  }

  private buildFiltros(cards: LiveCard[]): void {
    const nombres = Array.from(
      new Set(cards.map((c) => c.categoriaNombre).filter((n): n is string => !!n))
    );
    nombres.sort((a, b) => a.localeCompare(b, 'es'));
    this.filtros = [this.FILTRO_TODOS, ...nombres];
    if (!this.filtros.includes(this.filtro)) {
      this.filtro = this.FILTRO_TODOS;
    }
  }

  cargarTransmisiones(): void {
    this.loading = true;
    this.error = null;
    this.transmisionesService.getAll().subscribe({
      next: (data) => {
        this.lives = data.map((t) => this.mapTransmision(t));
        this.buildFiltros(this.lives);
        this.loading = false;
      },
      error: (err) => {
        console.error('Error al cargar transmisiones:', err);
        this.error = 'No se pudieron cargar las transmisiones. Inténtalo más tarde.';
        this.lives = [];
        this.filtros = [this.FILTRO_TODOS];
        this.loading = false;
      }
    });
  }

  get filteredLives(): LiveCard[] {
    if (this.filtro === this.FILTRO_TODOS) {
      return this.lives;
    }
    return this.lives.filter((l) => l.categoriaNombre === this.filtro);
  }
}

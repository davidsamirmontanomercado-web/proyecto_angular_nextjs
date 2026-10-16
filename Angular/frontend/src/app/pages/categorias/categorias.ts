import { Component, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { FooterComponent } from '../../shared/footer/footer';
import { CategoriasService, Categoria } from '../../services/categorias.service';

interface CategoriaCard {
  id: string;
  ic: string;
  name: string;
  sub: string;
}

@Component({
  selector: 'app-categorias',
  imports: [RouterLink, CommonModule, NavbarComponent, FooterComponent],
  templateUrl: './categorias.html',
  styleUrl: './categorias.css'
})
export class CategoriasComponent implements OnInit {
  private categoriasService = inject(CategoriasService);

  categorias: CategoriaCard[] = [];
  loading = false;
  error: string | null = null;

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.loading = true;
    this.error = null;

    this.categoriasService.getCategorias().subscribe({
      next: (items) => {
        this.categorias = items.map((c) => this.mapCard(c));
        this.loading = false;
      },
      error: (err) => {
        console.error('Error al cargar categorías:', err);
        this.error = 'No se pudieron cargar las categorías. Inténtalo más tarde.';
        this.categorias = [];
        this.loading = false;
      }
    });
  }

  private mapCard(c: Categoria): CategoriaCard {
    return {
      id: c.id,
      ic: (c.icono ?? '').trim() || '📋',
      name: (c.nombre ?? '').trim() || 'Sin nombre',
      sub: this.buildSub(c)
    };
  }

  private buildSub(c: Categoria): string {
    const raw: unknown = c.subcategorias;
    let subs: string[] = [];
    if (Array.isArray(raw)) {
      subs = raw.map((s) => String(s).trim()).filter(Boolean);
    } else if (typeof raw === 'string' && raw.trim()) {
      subs = [raw.trim()];
    }
    if (subs.length > 0) return subs.join(' · ');
    return (c.descripcion ?? '').trim() || 'Ver transmisiones';
  }
}

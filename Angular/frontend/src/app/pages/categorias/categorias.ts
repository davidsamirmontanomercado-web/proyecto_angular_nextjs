import { Component, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { FooterComponent } from '../../shared/footer/footer';
import { CategoriasService, Categoria } from '../../services/categorias.service';

interface CategoriaCard {
  id: string;
  /** Icono en texto/emoji (vacío si el icono es una imagen). */
  ic: string;
  /** URL del icono cuando `categorias.icono` guarda una imagen. */
  icUrl: string | null;
  name: string;
  sub: string;
}

/** Icono por defecto según el slug/nombre cuando la categoría no trae icono. */
const ICONOS_POR_CLAVE: { claves: string[]; icono: string }[] = [
  { claves: ['mueble', 'hogar', 'decoracion'], icono: '🛋️' },
  { claves: ['moda', 'ropa', 'calzado', 'textil'], icono: '👗' },
  { claves: ['tecno', 'electron', 'comput', 'celular'], icono: '💻' },
  { claves: ['aliment', 'comida', 'bebida', 'restaurant'], icono: '🍽️' },
  { claves: ['belleza', 'cosmet', 'cuidado'], icono: '💄' },
  { claves: ['deporte', 'fitness', 'gimnasio'], icono: '🏋️' },
  { claves: ['vehicul', 'auto', 'moto', 'carro'], icono: '🚗' },
  { claves: ['inmueble', 'vivienda', 'arriendo'], icono: '🏠' },
  { claves: ['servicio', 'profesional'], icono: '🛠️' },
  { claves: ['mascota', 'animal'], icono: '🐾' },
  { claves: ['juguete', 'nino', 'infantil', 'bebe'], icono: '🧸' },
  { claves: ['herramienta', 'ferreteria', 'industrial'], icono: '🔧' },
  { claves: ['arte', 'manualidad', 'artesan'], icono: '🎨' },
  { claves: ['salud', 'medic'], icono: '💊' },
  { claves: ['agro', 'campo', 'agric'], icono: '🌾' }
];

const ICONO_FALLBACK = '📋';

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
    const raw = (c.icono ?? '').trim();
    const esImagen = this.esUrlDeImagen(raw);

    return {
      id: c.id,
      ic: esImagen ? '' : raw || this.iconoPorDefecto(c),
      icUrl: esImagen ? raw : null,
      name: (c.nombre ?? '').trim() || 'Sin nombre',
      sub: this.buildSub(c)
    };
  }

  /** `categorias.icono` puede guardar un emoji o la URL de una imagen. */
  private esUrlDeImagen(valor: string): boolean {
    if (!valor) return false;
    if (/^(https?:\/\/|\/\/|\/|data:image\/)/i.test(valor)) return true;
    return /\.(svg|png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(valor);
  }

  private iconoPorDefecto(c: Categoria): string {
    const clave = `${c.slug ?? ''} ${c.nombre ?? ''}`.toLowerCase();
    const encontrado = ICONOS_POR_CLAVE.find((e) => e.claves.some((k) => clave.includes(k)));
    return encontrado?.icono ?? ICONO_FALLBACK;
  }

  /** Si la imagen del icono no carga, cae a un emoji legible. */
  onIconoError(c: CategoriaCard): void {
    c.icUrl = null;
    c.ic = this.iconoPorDefecto({ slug: '', nombre: c.name } as Categoria);
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

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
  accent: string;
  name: string;
  sub: string;
}

/** Icono por defecto según el slug/nombre cuando la categoría no trae icono. */
const ICONOS_POR_CLAVE: { claves: string[]; icono: string; accent: string }[] = [
  { claves: ['maquinaria', 'industrial', 'fabrica'], icono: '⚙️', accent: '#5368d8' },
  { claves: ['mueble', 'hogar', 'decoracion'], icono: '🪑', accent: '#a66b42' },
  { claves: ['moda', 'ropa', 'calzado', 'textil'], icono: '👗', accent: '#c44b8a' },
  { claves: ['tecno', 'electron', 'comput', 'celular'], icono: '💻', accent: '#3976c5' },
  { claves: ['aliment', 'comida', 'bebida', 'restaurant'], icono: '🍽️', accent: '#d58b35' },
  { claves: ['belleza', 'cosmet', 'cuidado'], icono: '💄', accent: '#c44b8a' },
  { claves: ['deporte', 'fitness', 'gimnasio'], icono: '🏋️', accent: '#428b69' },
  { claves: ['vehicul', 'auto', 'moto', 'carro', 'transporte'], icono: '🚗', accent: '#4c6d91' },
  { claves: ['inmueble', 'vivienda', 'arriendo'], icono: '🏠', accent: '#4f927e' },
  { claves: ['servicio', 'profesional'], icono: '🛠️', accent: '#67758a' },
  { claves: ['mascota', 'animal'], icono: '🐾', accent: '#bb8146' },
  { claves: ['juguete', 'nino', 'infantil', 'bebe'], icono: '🧸', accent: '#d47658' },
  { claves: ['herramienta', 'ferreteria'], icono: '🔧', accent: '#c3793f' },
  { claves: ['construccion', 'material', 'acabado'], icono: '🏗️', accent: '#bd8139' },
  { claves: ['electric', 'ilumin', 'cable'], icono: '⚡', accent: '#cf9b2e' },
  { claves: ['empaque', 'embalaje', 'caja'], icono: '�', accent: '#5c8a72' },
  { claves: ['arte', 'manualidad', 'artesan'], icono: '🎨', accent: '#8a65bf' },
  { claves: ['salud', 'medic'], icono: '💊', accent: '#438d91' },
  { claves: ['agro', 'campo', 'agric'], icono: '🌾', accent: '#658f46' }
];

const ICONO_FALLBACK = '📋';
const ACCENT_FALLBACK = '#64748b';

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
      ic: esImagen
        ? ''
        : this.esAbreviatura(raw) || !raw
          ? this.iconoPorDefecto(c)
          : raw,
      icUrl: esImagen ? raw : null,
      accent: this.acentoPorDefecto(c),
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
    return this.configuracionIcono(c)?.icono ?? ICONO_FALLBACK;
  }

  private acentoPorDefecto(c: Categoria): string {
    return this.configuracionIcono(c)?.accent ?? ACCENT_FALLBACK;
  }

  private configuracionIcono(c: Categoria) {
    const clave = `${c.slug ?? ''} ${c.nombre ?? ''}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return ICONOS_POR_CLAVE.find((e) => e.claves.some((k) => clave.includes(k)));
  }

  private esAbreviatura(valor: string): boolean {
    return /^[A-ZÁÉÍÓÚÜÑ]{2,5}$/.test(valor);
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

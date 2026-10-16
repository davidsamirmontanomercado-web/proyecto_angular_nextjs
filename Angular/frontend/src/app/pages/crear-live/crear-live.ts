import { Component, inject, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ToastService } from '../../services/toast.service';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { FooterComponent } from '../../shared/footer/footer';
import { TransmisionesService, LineaNegocio } from '../../services/transmisiones.service';
import { Categoria, CategoriasService } from '../../services/categorias.service';

@Component({
  selector: 'app-crear-live',
  imports: [RouterLink, FormsModule, NavbarComponent, FooterComponent],
  templateUrl: './crear-live.html',
  styleUrl: './crear-live.css'
})
export class CrearLiveComponent implements OnInit {
  private toast = inject(ToastService);
  private router = inject(Router);
  private transmisiones = inject(TransmisionesService);
  private categoriasService = inject(CategoriasService);

  categorias: Categoria[] = [];
  enviando = false;

  // Líneas de negocio válidas (slug -> etiqueta visible).
  readonly lineasNegocio: { valor: LineaNegocio; etiqueta: string }[] = [
    { valor: 'ventas', etiqueta: 'Ventas — Productos nuevos' },
    { valor: 'produccion', etiqueta: 'Producción — Fábrica / Proceso' },
    { valor: 'usados', etiqueta: 'Usados — Productos usados' }
  ];

  // Sólo se envían columnas reales de la tabla transmisiones.
  form = {
    linea_negocio: '' as LineaNegocio | '',
    titulo: '',
    descripcion: '',
    categoria_id: '',
    subcategoria: '',
    imagen_portada: '',
    ubicacion: ''
  };

  ngOnInit(): void {
    this.categoriasService.getCategorias().subscribe({
      next: (data) => (this.categorias = data),
      error: (err) => {
        console.error('Error al cargar categorías:', err);
        this.toast.err('No se pudieron cargar las categorías.');
      }
    });
  }

  get subcategorias(): string[] {
    return this.categorias.find((c) => c.id === this.form.categoria_id)?.subcategorias ?? [];
  }

  onSubmit(e: Event) {
    e.preventDefault();
    if (this.enviando) return;

    const titulo = this.form.titulo.trim();
    const descripcion = this.form.descripcion.trim();

    if (!this.form.linea_negocio) {
      this.toast.err('Selecciona una línea de negocio.');
      return;
    }
    if (!this.form.categoria_id) {
      this.toast.err('Selecciona una categoría.');
      return;
    }
    if (!titulo) {
      this.toast.err('El título es obligatorio.');
      return;
    }
    if (!descripcion) {
      this.toast.err('La descripción es obligatoria.');
      return;
    }

    this.enviando = true;
    this.transmisiones
      .crear({
        titulo,
        descripcion,
        linea_negocio: this.form.linea_negocio,
        categoria_id: this.form.categoria_id,
        subcategoria: this.form.subcategoria || null,
        imagen_portada: this.form.imagen_portada.trim() || null,
        ubicacion: this.form.ubicacion || null
      })
      .subscribe({
        next: () => {
          this.enviando = false;
          this.toast.ok('Transmisión creada · prográmala e iníciala');
          setTimeout(() => this.router.navigateByUrl('/dashboard'), 700);
        },
        error: (err) => {
          this.enviando = false;
          console.error('Error al crear la transmisión:', err);
          this.toast.err(err?.error?.error || 'No se pudo crear la transmisión.');
        }
      });
  }
}

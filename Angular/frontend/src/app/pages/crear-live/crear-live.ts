import { Component, inject, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
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
    { valor: 'ventas_nuevos', etiqueta: 'Ventas — Productos nuevos' },
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
        error: (err: HttpErrorResponse) => {
          this.enviando = false;
          console.error('Error al crear la transmisión:', err.status);
          this.toast.err(this.mensajeDeError(err));
        }
      });
  }

  /** Traduce el estado HTTP a un mensaje claro para el usuario. */
  private mensajeDeError(err: HttpErrorResponse): string {
    const s = err.status;
    if (s === 0) return 'No se pudo conectar con el servidor. Revisa tu conexión.';
    if (s === 400) return this.mensajeServidor(err) || 'Revisa los datos del formulario.';
    if (s === 401) return this.mensajeServidor(err) || 'Tu sesión expiró. Inicia sesión de nuevo.';
    if (s === 403) return 'No tienes permisos para esta operación.';
    if (s >= 500) return 'El servidor no está disponible. Inténtalo más tarde.';
    return 'No se pudo crear la transmisión.';
  }

  private mensajeServidor(err: HttpErrorResponse): string | null {
    const cuerpo = err.error;
    if (cuerpo && typeof cuerpo === 'object' && typeof cuerpo.error === 'string') {
      return cuerpo.error;
    }
    return null;
  }
}

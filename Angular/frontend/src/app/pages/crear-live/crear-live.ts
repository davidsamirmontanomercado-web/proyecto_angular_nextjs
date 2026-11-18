import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal
} from '@angular/core';
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
export class CrearLiveComponent implements OnInit, OnDestroy {
  private toast = inject(ToastService);
  private router = inject(Router);
  private transmisiones = inject(TransmisionesService);
  private categoriasService = inject(CategoriasService);

  /** Input de archivo oculto: se dispara desde el botón visible. */
  @ViewChild('filePortada') filePortada?: ElementRef<HTMLInputElement>;

  categorias: Categoria[] = [];
  enviando = false;

  // Portada por archivo (subida a Storage) con vista previa.
  portadaArchivo = signal<File | null>(null);
  portadaPreview = signal<string | null>(null);
  portadaError = signal<string | null>(null);
  subiendoPortada = signal(false);

  /** Debe coincidir con los tipos aceptados por /api/uploads/portada. */
  private readonly TIPOS_PORTADA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  private readonly MAX_PORTADA_BYTES = 3 * 1024 * 1024;

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

  ngOnDestroy(): void {
    this.liberarPreview();
  }

  get subcategorias(): string[] {
    return this.categorias.find((c) => c.id === this.form.categoria_id)?.subcategorias ?? [];
  }

  /** Abre el selector de archivos nativo (PC y móvil). */
  abrirSelectorPortada(): void {
    this.filePortada?.nativeElement.click();
  }

  /** Valida tipo/tamaño y genera la vista previa local. */
  onPortadaSeleccionada(e: Event): void {
    const input = e.target as HTMLInputElement;
    const archivo = input.files?.[0] ?? null;
    // Permite volver a elegir el mismo archivo después.
    input.value = '';

    if (!archivo) return;

    if (!this.TIPOS_PORTADA.includes(archivo.type)) {
      this.portadaError.set('Formato no permitido. Usa JPG, PNG, WEBP o GIF.');
      return;
    }
    if (archivo.size > this.MAX_PORTADA_BYTES) {
      this.portadaError.set('La imagen supera el máximo de 3 MB.');
      return;
    }

    this.liberarPreview();
    this.portadaError.set(null);
    this.portadaArchivo.set(archivo);
    this.portadaPreview.set(URL.createObjectURL(archivo));
  }

  quitarPortada(): void {
    this.liberarPreview();
    this.portadaArchivo.set(null);
    this.portadaError.set(null);
  }

  private liberarPreview(): void {
    const url = this.portadaPreview();
    if (url) URL.revokeObjectURL(url);
    this.portadaPreview.set(null);
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

    const archivo = this.portadaArchivo();
    this.enviando = true;

    if (archivo) {
      // Sube primero la portada y luego crea, para no guardar Base64 en la tabla.
      this.subiendoPortada.set(true);
      this.transmisiones.subirPortada(archivo).subscribe({
        next: (url) => {
          this.subiendoPortada.set(false);
          this.crear(titulo, descripcion, url);
        },
        error: (err: HttpErrorResponse) => {
          this.subiendoPortada.set(false);
          this.enviando = false;
          console.error('Error al subir la portada:', err.status);
          this.toast.err(this.mensajeDeError(err));
        }
      });
      return;
    }

    this.crear(titulo, descripcion, this.form.imagen_portada.trim() || null);
  }

  private crear(titulo: string, descripcion: string, imagenPortada: string | null): void {
    this.transmisiones
      .crear({
        titulo,
        descripcion,
        linea_negocio: this.form.linea_negocio as LineaNegocio,
        categoria_id: this.form.categoria_id,
        subcategoria: this.form.subcategoria || null,
        imagen_portada: imagenPortada,
        ubicacion: this.form.ubicacion || null
      })
      .subscribe({
        next: (res) => {
          this.enviando = false;
          this.toast.ok('Transmisión creada. ¡Ya puedes iniciarla!');
          // Navega directamente a la pantalla de la transmisión (problema 5).
          this.router.navigate(['/live', res.id]);
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
    if (s === 403) return 'No tienes permisos para subir portadas.';
    if (s === 413) return 'La imagen es demasiado grande.';
    if (s === 503) return 'La subida de portadas aún no está configurada en el servidor.';
    if (s >= 500) return 'El servidor no está disponible. Inténtalo más tarde.';
    return 'No se pudo completar la operación.';
  }

  private mensajeServidor(err: HttpErrorResponse): string | null {
    const cuerpo = err.error;
    if (cuerpo && typeof cuerpo === 'object' && typeof cuerpo.error === 'string') {
      return cuerpo.error;
    }
    return null;
  }
}

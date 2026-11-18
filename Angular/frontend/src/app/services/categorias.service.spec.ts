import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { CategoriasService } from './categorias.service';
import { AuthService } from './auth.service';

describe('CategoriasService', () => {
  let service: CategoriasService;
  let httpMock: HttpTestingController;
  let base: string;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    });
    service = TestBed.inject(CategoriasService);
    httpMock = TestBed.inject(HttpTestingController);
    base = `${TestBed.inject(AuthService).backendUrl}/api/categorias`;
  });

  afterEach(() => {
    service.invalidateCache();
    httpMock.verify();
    localStorage.clear();
  });

  it('hace una sola petición para llamadas repetidas dentro del TTL', () => {
    const respuesta = { data: [{ id: 'c1', nombre: 'Ropa' }], meta: { count: 1 } };

    let primera: unknown;
    let segunda: unknown;
    service.getCategorias().subscribe((c) => (primera = c));
    service.getCategorias().subscribe((c) => (segunda = c));

    const req = httpMock.expectOne((r) => r.url === base);
    expect(req.request.method).toBe('GET');
    req.flush(respuesta);

    expect(primera).toEqual([{ id: 'c1', nombre: 'Ropa' }]);
    expect(segunda).toEqual([{ id: 'c1', nombre: 'Ropa' }]);
  });

  it('no vuelve a pedir en una navegación posterior dentro del TTL', () => {
    service.getCategorias().subscribe();
    httpMock.expectOne(base).flush({ data: [{ id: 'c1', nombre: 'Ropa' }] });

    let recibido: unknown;
    service.getCategorias().subscribe((c) => (recibido = c));

    httpMock.expectNone(base); // se sirve de caché, sin nueva petición
    expect(recibido).toEqual([{ id: 'c1', nombre: 'Ropa' }]);
  });

  it('vuelve a pedir tras invalidateCache', () => {
    service.getCategorias().subscribe();
    httpMock.expectOne(base).flush({ data: [] });

    service.invalidateCache();

    service.getCategorias().subscribe();
    httpMock.expectOne(base).flush({ data: [] });
  });

  it('no cachea los errores: permite reintentar', () => {
    service.getCategorias().subscribe({ error: () => {} });
    httpMock.expectOne(base).error(new ProgressEvent('error'));

    service.getCategorias().subscribe();
    httpMock.expectOne(base).flush({ data: [] });
  });

  it('separa la caché por combinación de opciones', () => {
    service.getCategorias().subscribe();
    httpMock.expectOne((r) => r.url === base && !r.params.has('limit')).flush({ data: [] });

    service.getCategorias({ limit: 5 }).subscribe();
    httpMock.expectOne((r) => r.url === base && r.params.get('limit') === '5').flush({ data: [] });
  });
});

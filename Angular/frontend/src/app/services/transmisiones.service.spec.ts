import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TransmisionesService } from './transmisiones.service';
import { AuthService } from './auth.service';

describe('TransmisionesService', () => {
  let service: TransmisionesService;
  let httpMock: HttpTestingController;
  let base: string;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    });
    service = TestBed.inject(TransmisionesService);
    httpMock = TestBed.inject(HttpTestingController);
    base = `${TestBed.inject(AuthService).backendUrl}/api/transmisiones`;
  });

  afterEach(() => httpMock.verify());

  it('GET por id mapea data de la respuesta', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    let recibido: unknown;

    service.getById(id).subscribe((t) => (recibido = t));

    const req = httpMock.expectOne(`${base}/${id}`);
    expect(req.request.method).toBe('GET');
    req.flush({ data: { id, titulo: 'Prueba', estado: 'en_vivo' } });

    expect(recibido).toEqual({ id, titulo: 'Prueba', estado: 'en_vivo' });
  });

  it('GET /:id/anfitrion devuelve null cuando data es null', () => {
    const id = '22222222-2222-2222-2222-222222222222';
    let recibido: unknown = 'sin-cambios';

    service.getAnfitrion(id).subscribe((a) => (recibido = a));

    const req = httpMock.expectOne(`${base}/${id}/anfitrion`);
    expect(req.request.method).toBe('GET');
    req.flush({ data: null });

    expect(recibido).toBeNull();
  });

  it('GET /mias envía el parámetro estado opcional', () => {
    service.getMias('programada').subscribe();

    const req = httpMock.expectOne((r) => r.url === `${base}/mias`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('estado')).toBe('programada');
    req.flush({ data: [] });
  });

  it('POST crea una transmisión con linea_negocio y categoria_id', () => {
    const payload = {
      titulo: 'Nuevo live',
      linea_negocio: 'ventas_nuevos' as const,
      categoria_id: '33333333-3333-3333-3333-333333333333'
    };
    let recibido: unknown;

    service.crear(payload).subscribe((r) => (recibido = r));

    const req = httpMock.expectOne(base);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush({ data: { id: 'abc', estado: 'programada' } });

    expect(recibido).toEqual({ id: 'abc', estado: 'programada' });
  });

  it('POST /:id/iniciar no envía cuerpo relevante', () => {
    const id = '44444444-4444-4444-4444-444444444444';
    let recibido: unknown;

    service.iniciar(id).subscribe((r) => (recibido = r));

    const req = httpMock.expectOne(`${base}/${id}/iniciar`);
    expect(req.request.method).toBe('POST');
    req.flush({ data: { id, estado: 'en_vivo' } });

    expect(recibido).toEqual({ id, estado: 'en_vivo' });
  });
});

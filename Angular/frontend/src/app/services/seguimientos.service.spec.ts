import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { SeguimientosService } from './seguimientos.service';
import { AuthService } from './auth.service';

describe('SeguimientosService (ámbito transmisión)', () => {
  let service: SeguimientosService;
  let httpMock: HttpTestingController;
  let base: string;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    });
    service = TestBed.inject(SeguimientosService);
    httpMock = TestBed.inject(HttpTestingController);
    base = `${TestBed.inject(AuthService).backendUrl}/api/transmisiones`;
  });

  afterEach(() => httpMock.verify());

  it('estadoDeTransmision hace GET y mapea siguiendo/esPropietario', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    let recibido: { siguiendo: boolean; esPropietario: boolean } | undefined;

    service.estadoDeTransmision(id).subscribe((r) => (recibido = r));

    const req = httpMock.expectOne(`${base}/${id}/seguimiento`);
    expect(req.request.method).toBe('GET');
    req.flush({ data: { siguiendo: true, esPropietario: false } });

    expect(recibido).toEqual({ siguiendo: true, esPropietario: false });
  });

  it('seguirTransmision hace POST y devuelve true', () => {
    const id = '22222222-2222-2222-2222-222222222222';
    let recibido: boolean | undefined;

    service.seguirTransmision(id).subscribe((r) => (recibido = r));

    const req = httpMock.expectOne(`${base}/${id}/seguimiento`);
    expect(req.request.method).toBe('POST');
    req.flush({ data: { siguiendo: true } });

    expect(recibido).toBe(true);
  });

  it('dejarDeSeguirTransmision hace DELETE y devuelve false', () => {
    const id = '33333333-3333-3333-3333-333333333333';
    let recibido: boolean | undefined;

    service.dejarDeSeguirTransmision(id).subscribe((r) => (recibido = r));

    const req = httpMock.expectOne(`${base}/${id}/seguimiento`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ data: { siguiendo: false } });

    expect(recibido).toBe(false);
  });
});

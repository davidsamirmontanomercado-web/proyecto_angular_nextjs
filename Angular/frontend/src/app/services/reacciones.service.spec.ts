import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ReaccionesService } from './reacciones.service';
import { AuthService } from './auth.service';

describe('ReaccionesService', () => {
  let service: ReaccionesService;
  let httpMock: HttpTestingController;
  let base: string;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    });
    service = TestBed.inject(ReaccionesService);
    httpMock = TestBed.inject(HttpTestingController);
    base = `${TestBed.inject(AuthService).backendUrl}/api/reacciones`;
  });

  afterEach(() => httpMock.verify());

  it('meGusta hace GET con el parámetro transmision_id', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    let recibido: boolean | undefined;

    service.meGusta(id).subscribe((r) => (recibido = r));

    const req = httpMock.expectOne((r) => r.url === base);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('transmision_id')).toBe(id);
    req.flush({ data: { me_gusta: true } });

    expect(recibido).toBe(true);
  });

  it('darMeGusta hace POST con el cuerpo esperado', () => {
    const id = '22222222-2222-2222-2222-222222222222';

    service.darMeGusta(id).subscribe();

    const req = httpMock.expectOne(base);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ transmision_id: id });
    req.flush({ data: { me_gusta: true } });
  });

  it('quitarMeGusta hace DELETE con el parámetro transmision_id', () => {
    const id = '33333333-3333-3333-3333-333333333333';

    service.quitarMeGusta(id).subscribe();

    const req = httpMock.expectOne((r) => r.url === base);
    expect(req.request.method).toBe('DELETE');
    expect(req.request.params.get('transmision_id')).toBe(id);
    req.flush({ data: { me_gusta: false } });
  });
});

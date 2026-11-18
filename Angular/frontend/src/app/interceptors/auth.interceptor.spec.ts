import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { authInterceptor } from './auth.interceptor';

const BASE = 'http://localhost:3000';
const URL = `${BASE}/api/transmisiones`;

/** Deja que se resuelvan las microtareas (refresh() es una promesa). */
const siguienteTick = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let getToken: ReturnType<typeof vi.fn>;
  let refresh: ReturnType<typeof vi.fn>;
  let isLoggedIn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getToken = vi.fn().mockReturnValue('token-1');
    refresh = vi.fn().mockResolvedValue(true);
    // Por defecto la sesión sigue en pie: un refresco fallido transitorio no
    // debe expulsar al usuario.
    isLoggedIn = vi.fn().mockReturnValue(true);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: { backendUrl: BASE, getToken, refresh, isLoggedIn },
        },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  it('adjunta el Bearer a las llamadas al backend propio', () => {
    http.get(URL).subscribe();

    const req = httpMock.expectOne(URL);
    expect(req.request.headers.get('Authorization')).toBe('Bearer token-1');
    req.flush({ data: [] });
  });

  it('ante un 401 renueva una vez y reintenta con el token nuevo', async () => {
    http.get(URL).subscribe({ error: () => {} });

    const req1 = httpMock.expectOne(URL);
    expect(req1.request.headers.get('Authorization')).toBe('Bearer token-1');

    getToken.mockReturnValue('token-2');
    req1.flush({ error: 'expirado' }, { status: 401, statusText: 'Unauthorized' });

    await siguienteTick();

    const req2 = httpMock.expectOne(URL);
    expect(req2.request.headers.get('Authorization')).toBe('Bearer token-2');
    req2.flush({ data: [] });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('no reintenta más de una vez ante un segundo 401', async () => {
    http.get(URL).subscribe({ error: () => {} });

    const req1 = httpMock.expectOne(URL);
    req1.flush({}, { status: 401, statusText: 'Unauthorized' });

    await siguienteTick();

    const req2 = httpMock.expectOne(URL);
    req2.flush({}, { status: 401, statusText: 'Unauthorized' });

    await siguienteTick();

    expect(refresh).toHaveBeenCalledTimes(1);
    httpMock.expectNone(URL);
  });

  it('no renueva ante un 401 de un endpoint /api/auth/*', () => {
    const authUrl = `${BASE}/api/auth/login`;
    http.post(authUrl, {}).subscribe({ error: () => {} });

    const req = httpMock.expectOne(authUrl);
    req.flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(refresh).not.toHaveBeenCalled();
  });

  it('si la renovación falla y la sesión quedó inservible, redirige a /login y propaga el error', async () => {
    const router = TestBed.inject(Router);
    const navegar = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    refresh.mockResolvedValue(false);
    isLoggedIn.mockReturnValue(false);
    let errorRecibido = false;
    http.get(URL).subscribe({ error: () => (errorRecibido = true) });

    const req1 = httpMock.expectOne(URL);
    req1.flush({}, { status: 401, statusText: 'Unauthorized' });

    await siguienteTick();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith('/login');
    expect(errorRecibido).toBe(true);
    httpMock.expectNone(URL);
  });

  it('si la renovación falla de forma transitoria no cierra sesión ni navega', async () => {
    const router = TestBed.inject(Router);
    const navegar = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    refresh.mockResolvedValue(false);
    isLoggedIn.mockReturnValue(true);
    let errorRecibido = false;
    http.get(URL).subscribe({ error: () => (errorRecibido = true) });

    const req1 = httpMock.expectOne(URL);
    req1.flush({}, { status: 401, statusText: 'Unauthorized' });

    await siguienteTick();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(navegar).not.toHaveBeenCalled();
    expect(errorRecibido).toBe(true);
    httpMock.expectNone(URL);
  });
});

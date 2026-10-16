import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from './auth.service';

const ENDPOINT_REFRESH = 'http://localhost:3000/api/auth/refresh';

const perfil = { nombre: 'Ana', correo: 'ana@a.com', rol: 'empresa' as const };

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('lm_backend_url', 'http://localhost:3000');
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    service = TestBed.inject(AuthService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('isLoggedIn exige usuario Y token', () => {
    expect(service.isLoggedIn()).toBe(false);

    service.setSession(perfil);
    expect(service.isLoggedIn()).toBe(false);

    service.setSession(perfil, 'token-1');
    expect(service.isLoggedIn()).toBe(true);
  });

  it('clearSession limpia usuario, tokens y estado', () => {
    service.setSession(perfil, 'token-1', 'refresh-1');
    expect(service.isLoggedIn()).toBe(true);

    service.clearSession();

    expect(service.isLoggedIn()).toBe(false);
    expect(localStorage.getItem('lm_user')).toBeNull();
    expect(localStorage.getItem('lm_token')).toBeNull();
    expect(localStorage.getItem('lm_refresh')).toBeNull();
  });

  it('refresh es single-flight y actualiza los tokens', async () => {
    service.setSession(perfil, 'viejo', 'refresh-1');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        session: { access_token: 'nuevo', refresh_token: 'refresh-2', expires_in: 3600 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([service.refresh(), service.refresh()]);

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(ENDPOINT_REFRESH);
    expect(localStorage.getItem('lm_token')).toBe('nuevo');
    expect(localStorage.getItem('lm_refresh')).toBe('refresh-2');
    expect(service.isLoggedIn()).toBe(true);
  });

  it('refresh devuelve false y limpia la sesión si el backend responde error', async () => {
    service.setSession(perfil, 'viejo', 'refresh-1');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    );

    const ok = await service.refresh();

    expect(ok).toBe(false);
    expect(service.isLoggedIn()).toBe(false);
    expect(localStorage.getItem('lm_token')).toBeNull();
  });

  it('refresh no restaura la sesión si el usuario cierra durante la renovación', async () => {
    service.setSession(perfil, 'viejo', 'refresh-1');

    let resolver!: (valor: unknown) => void;
    const pendiente = new Promise((res) => {
      resolver = res;
    });
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pendiente));

    const promesa = service.refresh();
    service.clearSession();

    resolver({
      ok: true,
      json: async () => ({ session: { access_token: 'nuevo', refresh_token: 'refresh-2' } }),
    });

    const ok = await promesa;

    expect(ok).toBe(false);
    expect(service.isLoggedIn()).toBe(false);
    expect(localStorage.getItem('lm_token')).toBeNull();
  });

  it('registerRemote guarda la sesión cuando el backend devuelve access_token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          data: {
            confirmationRequired: false,
            user: { id: 'u1', email: 'ana@a.com' },
            session: { access_token: 'at-1', refresh_token: 'rt-1' },
          },
        }),
      })
    );

    const res = await service.registerRemote({
      nombre: 'Ana',
      correo: 'ana@a.com',
      pass: '123456',
      rol: 'empresa',
    });

    expect(res.ok).toBe(true);
    expect(res.confirmationRequired).toBe(false);
    expect(service.isLoggedIn()).toBe(true);
    expect(localStorage.getItem('lm_token')).toBe('at-1');
  });

  it('registerRemote NO autentica cuando Supabase exige confirmar el correo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ data: { confirmationRequired: true } }),
      })
    );

    const res = await service.registerRemote({
      nombre: 'Ana',
      correo: 'ana@a.com',
      pass: '123456',
      rol: 'empresa',
    });

    expect(res.ok).toBe(true);
    expect(res.confirmationRequired).toBe(true);
    expect(service.isLoggedIn()).toBe(false);
    expect(localStorage.getItem('lm_token')).toBeNull();
  });
});

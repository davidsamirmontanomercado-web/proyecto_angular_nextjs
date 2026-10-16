import {
  HttpContextToken,
  HttpErrorResponse,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/** Marca una petición ya reintentada tras renovar la sesión. */
export const RETRIED_AFTER_REFRESH = new HttpContextToken<boolean>(() => false);

/**
 * Adjunta el access_token de la sesión a todas las llamadas al backend propio,
 * de modo que las rutas /api/* protegidas vean auth.uid() real.
 *
 * Ante un 401 en una ruta de datos propia intenta renovar la sesión una sola
 * vez (single-flight en AuthService.refresh) y reintenta la petición. El flag
 * local `yaReintentado` garantiza un único reintento por petición (sin bucles).
 * Los endpoints /api/auth/* quedan excluidos para no interpretar sus 401 como
 * sesión expirada.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const esEndpointAuth = req.url.includes('/api/auth/');
  const esBackendPropio = req.url.startsWith(auth.backendUrl);
  const token = auth.getToken();

  const saliente =
    !esEndpointAuth && esBackendPropio && token
      ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : req;

  let yaReintentado = req.context.get(RETRIED_AFTER_REFRESH);

  return next(saliente).pipe(
    catchError((err: HttpErrorResponse) => {
      const puedeRenovar =
        err.status === 401 &&
        !esEndpointAuth &&
        esBackendPropio &&
        !yaReintentado;

      if (!puedeRenovar) {
        return throwError(() => err);
      }
      yaReintentado = true;

      return from(auth.refresh()).pipe(
        switchMap((renovado) => {
          if (!renovado) {
            router.navigateByUrl('/login');
            return throwError(() => err);
          }

          const nuevoToken = auth.getToken();
          const reintento = req.clone({
            context: req.context.set(RETRIED_AFTER_REFRESH, true),
            setHeaders: nuevoToken
              ? { Authorization: `Bearer ${nuevoToken}` }
              : {},
          });

          return next(reintento);
        })
      );
    })
  );
};

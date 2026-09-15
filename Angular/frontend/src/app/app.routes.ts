import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './services/auth.service';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/index/index').then(m => m.IndexComponent) },
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./pages/login/login').then(m => m.LoginComponent) },
  { path: 'registro', canActivate: [guestGuard], loadComponent: () => import('./pages/registro/registro').then(m => m.RegistroComponent) },
  { path: 'dashboard', canActivate: [authGuard], loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.DashboardComponent) },
  { path: 'envivos', loadComponent: () => import('./pages/envivos/envivos').then(m => m.EnvivosComponent) },
  { path: 'live', loadComponent: () => import('./pages/live/live').then(m => m.LiveComponent) },
  { path: 'crear-live', canActivate: [authGuard], loadComponent: () => import('./pages/crear-live/crear-live').then(m => m.CrearLiveComponent) },
  { path: 'perfil', loadComponent: () => import('./pages/perfil/perfil').then(m => m.PerfilComponent) },
  { path: 'categorias', loadComponent: () => import('./pages/categorias/categorias').then(m => m.CategoriasComponent) },
  { path: 'configuracion', canActivate: [authGuard], loadComponent: () => import('./pages/configuracion/configuracion').then(m => m.ConfiguracionComponent) },
  { path: '**', redirectTo: '' }
];
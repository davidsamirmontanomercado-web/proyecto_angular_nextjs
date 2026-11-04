import { Injectable, signal } from '@angular/core';

export interface Toast { id: number; message: string; type: 'ok' | 'err' | 'info'; }

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private counter = 0;

  show(message: string, type: 'ok' | 'err' | 'info' = 'info', duration = 3200) {
    const id = ++this.counter;
    const toast: Toast = { id, message, type };
    this.toasts.update(arr => [...arr, toast]);
    setTimeout(() => this.remove(id), duration);
  }

  ok(msg: string) { this.show(msg, 'ok'); }
  err(msg: string) { this.show(msg, 'err'); }
  info(msg: string) { this.show(msg, 'info'); }

  remove(id: number) {
    this.toasts.update(arr => arr.filter(t => t.id !== id));
  }
}
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, IonButton, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';

/**
 * Aviso no bloqueante para el panel: "te falta activar algo".
 *
 * Nunca tapa la pantalla ni impide usar la app: sólo informa y ofrece un botón.
 * Aparece en vez de dejar que la persona descubra sola que el SOS no suena.
 */
@Component({
  selector: 'app-aviso-permisos',
  standalone: true,
  template: `
    @if (visible) {
      <div class="aviso" [class.urgente]="urgente" role="status">
        <div class="aviso-ico">
          <ion-icon [name]="urgente ? 'alert-circle' : 'information-circle'"></ion-icon>
        </div>

        <div class="aviso-texto">
          <strong>{{ titulo }}</strong>
          <span>{{ detalle }}</span>
        </div>

        <div class="aviso-accion">
          @if (ocupado) {
            <ion-spinner name="crescent"></ion-spinner>
          } @else {
            <ion-button size="small" class="btn" (click)="corregir.emit()">Corregir</ion-button>
          }
        </div>

        <button type="button" class="cerrar" (click)="cerrar()" aria-label="Cerrar aviso">
          <ion-icon name="close"></ion-icon>
        </button>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }

    .aviso {
      display: flex;
      align-items: center;
      gap: 10px;
      background: var(--sc-warn-soft, #fdf2e0);
      border: 1px solid color-mix(in srgb, var(--sc-warn, #e07b00) 32%, transparent);
      border-radius: var(--sc-radius, 14px);
      padding: 10px 10px 10px 12px;
      margin: 12px 16px 0;
      animation: aparecer 0.28s ease;
    }

    .aviso.urgente {
      background: var(--sc-danger-soft, #fdeaea);
      border-color: color-mix(in srgb, var(--sc-danger, #dc2626) 32%, transparent);
    }

    @keyframes aparecer {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .aviso-ico {
      flex-shrink: 0;
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--sc-warn, #e07b00) 20%, transparent);
      color: var(--sc-warn-dark, #b86300);
    }

    .urgente .aviso-ico {
      background: color-mix(in srgb, var(--sc-danger, #dc2626) 18%, transparent);
      color: var(--sc-danger-dark, #b91c1c);
    }

    .aviso-ico ion-icon { font-size: 18px; }

    .aviso-texto {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .aviso-texto strong {
      font-size: 13px;
      font-weight: 700;
      color: var(--sc-ink, #1a1d26);
      line-height: 1.3;
    }

    .aviso-texto span {
      font-size: 11.5px;
      line-height: 1.4;
      color: var(--sc-ink-2, #443c56);
    }

    .aviso-accion { flex-shrink: 0; }

    ion-spinner { width: 18px; height: 18px; }

    .btn {
      --border-radius: var(--sc-radius-pill, 999px);
      --padding-start: 12px;
      --padding-end: 12px;
      font-size: 12px;
      font-weight: 700;
      text-transform: none;
      min-height: 30px;
      margin: 0;
    }

    .cerrar {
      flex-shrink: 0;
      background: none;
      border: none;
      padding: 4px;
      cursor: pointer;
      color: var(--sc-ink-muted, #6b6480);
      display: grid;
      place-items: center;
    }

    .cerrar ion-icon { font-size: 16px; }
  `],
  imports: [CommonModule, IonIcon, IonButton, IonSpinner]
})
export class AvisoPermisosComponent {

  @Input() titulo = '';

  @Input() detalle = '';

  @Input() visible = false;

  /** El aviso más rojo: sin notificaciones el SOS no suena. */
  @Input() urgente = false;

  @Input() ocupado = false;

  @Output() corregir = new EventEmitter<void>();

  @Output() cerrado = new EventEmitter<void>();

  constructor() {
    addIcons(icons);
  }

  cerrar() {
    this.visible = false;
    this.cerrado.emit();
  }
}

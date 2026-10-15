import {
  Component,
  Input,
  Output,
  EventEmitter,
  ElementRef,
  ViewChild,
  OnChanges,
  AfterViewInit,
  OnDestroy,
  SimpleChanges,
  ChangeDetectorRef
} from '@angular/core';

@Component({
  selector: 'app-rueda',
  templateUrl: './rueda.component.html',
  styleUrls: ['./rueda.component.scss'],
  imports: [],
})
export class RuedaComponent implements OnChanges, AfterViewInit, OnDestroy {

  @Input() items: number[] = [];
  @Input() valor: number = 0;
  @Input() reiniciar = 0;
  @Output() valorChange = new EventEmitter<number>();

  @ViewChild('strip', { static: false }) stripRef!: ElementRef<HTMLDivElement>;

  private readonly ITEM_H = 48;
  private readonly COPIAS = 3;
  private readonly VISTA = 144;

  filas: number[] = [];
  centroGlobal: number = 0;
  indiceSeleccionado: number = 0;

  private sel = 0;
  private arrastrando = false;
  private inicioY = 0;
  private selInicio = 0;
  private tiempoInicio = 0;
  private velocidad = 0;
  private frameId: any = null;
  private ultimo: number | null = null;
  private prevClientY = 0;
  private prevMoveT = 0;

  private alMover = (evento: PointerEvent) => this.onMover(evento);
  private alSoltar = () => this.onSoltar();

  constructor(private changeDetectorRef: ChangeDetectorRef) {}

  ngOnChanges(cambios: SimpleChanges) {
    if (cambios['items'] && this.items) {
      this.filas = [...this.items, ...this.items, ...this.items];
      this.sincronizarSel();
    }
    if (cambios['valor'] && !this.arrastrando && this.filas.length) {
      this.sincronizarSel();
    }
    if (cambios['reiniciar']) {
      this.sincronizarSel();
    }
    this.pintar(true);
  }

  ngAfterViewInit() {
    this.pintar(true);
  }

  ngOnDestroy() {
    this.detenerMomentum();
    window.removeEventListener('pointermove', this.alMover);
    window.removeEventListener('pointerup', this.alSoltar);
  }

  private sincronizarSel() {
    if (!this.items.length) {
      return;
    }
    const indice = this.items.indexOf(this.valor);
    this.sel = indice >= 0 ? indice : 0;
  }

  private valorEn(valorVirtual: number): number {
    const n = this.items.length;
    return this.items[((valorVirtual % n) + n) % n];
  }

  private pintar(soloVisual = false) {
    const n = this.items.length;
    if (!n || !this.stripRef) {
      return;
    }

    const k = ((Math.round(this.sel) % n) + n) % n;
    this.centroGlobal = k + n;

    const y = -this.centroGlobal * this.ITEM_H + (this.VISTA - this.ITEM_H) / 2;
    this.stripRef.nativeElement.style.transform = `translateY(${y}px)`;

    this.indiceSeleccionado = this.items[k];

    if (this.ultimo !== this.indiceSeleccionado) {
      this.ultimo = this.indiceSeleccionado;
      if (!soloVisual) {
        this.valorChange.emit(this.indiceSeleccionado);
      }
    }

    this.changeDetectorRef.markForCheck();
  }

  formato(valorNum: number): string {
    return valorNum.toString().padStart(2, '0');
  }

  onStart(evento: PointerEvent) {
    evento.preventDefault();
    this.detenerMomentum();
    this.arrastrando = true;
    this.inicioY = evento.clientY;
    this.selInicio = this.sel;
    this.tiempoInicio = performance.now();
    this.velocidad = 0;
    this.prevClientY = evento.clientY;
    this.prevMoveT = performance.now();

    window.addEventListener('pointermove', this.alMover);
    window.addEventListener('pointerup', this.alSoltar);
  }

  private onMover(evento: PointerEvent) {
    if (!this.arrastrando) {
      return;
    }
    const dy = evento.clientY - this.inicioY;
    this.sel = this.selInicio - dy / this.ITEM_H;

    const ahora = performance.now();
    const dt = ahora - this.prevMoveT;
    if (dt > 0) {
      this.velocidad = -(evento.clientY - this.prevClientY) / dt;
    }
    this.prevClientY = evento.clientY;
    this.prevMoveT = ahora;

    this.pintar();
  }

  private onSoltar() {
    if (!this.arrastrando) {
      return;
    }
    this.arrastrando = false;
    window.removeEventListener('pointermove', this.alMover);
    window.removeEventListener('pointerup', this.alSoltar);

    this.sel = Math.round(this.sel);
    this.pintar();
    this.arrastrarConMomentum(this.velocidad);
  }

  private arrastrarConMomentum(velocidadPxMs: number) {
    let velocidad = velocidadPxMs;
    const paso = () => {
      if (Math.abs(velocidad) < 0.002) {
        this.sel = Math.round(this.sel);
        this.pintar();
        return;
      }
      this.sel += (velocidad * 16) / this.ITEM_H;
      velocidad *= 0.94;
      this.pintar();
      this.frameId = requestAnimationFrame(paso);
    };
    this.frameId = requestAnimationFrame(paso);
  }

  private detenerMomentum() {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }
}
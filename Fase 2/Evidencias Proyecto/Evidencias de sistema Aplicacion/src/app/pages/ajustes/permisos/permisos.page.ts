import { Component, OnInit, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonButton,
  IonIcon,
  IonSpinner,
  IonToggle
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { PermisosService, PermisoInfo, EstadoPermiso } from '../../../services/permisos/permisos.service';
import { PushNotificationService, DiagnosticoPush } from '../../../services/Backend/push-notification/push-notification';
import { VERSION_APP, BUILD_APP } from '../../../version';

@Component({
  selector: 'app-permisos',
  templateUrl: './permisos.page.html',
  styleUrls: ['./permisos.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonSpinner,
    IonToggle,
    CommonModule
  ]
})
export class PermisosPage implements OnInit, OnDestroy {

  permisos: PermisoInfo[] = [];

  cargando = true;

  permisoProcesando: string | null = null;

  /** Marca de build: sirve para confirmar qué APK está instalado. */
  build = `${VERSION_APP} · ${BUILD_APP}`;

  /**
   * Muestra el bloque de diagnóstico de alertas.
   *
   * OCULTO A PROPÓSITO: es una herramienta para averiguar por qué no llegan los
   * push, no algo que deba ver una persona mayor en su lista de permisos. Para
   * volver a mostrarlo basta con poner `true` acá; el bloque está completo en
   * la plantilla.
   */
  readonly mostrarDiagnostico = false;

  diag: DiagnosticoPush | null = null;

  cargandoDiag = true;

  reintentando = false;

  /** Los que se piden al entrar a la app. */
  grupoInicial: PermisoInfo[] = [];

  /** Los que se piden en el momento en que se usan. */
  grupoAlUsar: PermisoInfo[] = [];

  /** Aviso flotante (ver plantilla). */
  avisoVisible = false;
  avisoTexto = '';
  private temporizadorAviso: any = null;

  private suscripcion: Subscription | null = null;

  /**
   * Escucha el retorno desde los ajustes del sistema. Ver
   * `escucharRetornoDeAjustes`.
   *
   * Se guarda la promesa porque en esta versión de @capacitor/app `addListener`
   * es asíncrono.
   */
  private escuchaApp: Promise<{ remove: () => Promise<void> }> | null = null;

  /**
   * Enquanto está en true, el valor del interruptor se fuerza a false.
   *
   * Existe para poder "cambiar" el valor de `[checked]` aunque el estado real
   * no haya cambiado: si el binding sigue valiendo lo mismo, Angular no
   * reescribe el DOM y el interruptor queda donde el usuario lo dejó.
   */
  sincronizando = false;

  /**
   * Cuando está en true, los cambios del interruptor que vengan del código se
   * ignoran. Ver `cambiar` y `revertirInterruptor`: sin esto, revertir el
   * interruptor dispara un `ionChange` que parece un apagado del usuario.
   */
  private ignorarCambio = false;

  constructor(
    private router: Router,
    private permisosService: PermisosService,
    private pushService: PushNotificationService,
    private cdr: ChangeDetectorRef
  ) {
    addIcons(icons);
  }

  async ngOnInit() {
    // Se pinta el catálogo antes de consultar al sistema: la pantalla aparece
    // de inmediato y después se completa con el estado real.
    this.permisos = this.permisosService.getPermisosPorDefecto();
    this.partition();

    this.suscripcion = this.permisosService.cambios.subscribe((lista) => {
      this.permisos = lista;
      this.partition();
      this.cdr.detectChanges();
    });

    await this.cargarPermisos();
    await this.cargarDiagnostico();
    this.escucharRetornoDeAjustes();
  }

  ngOnDestroy() {
    this.suscripcion?.unsubscribe();
    void this.escuchaApp?.then((h) => h.remove()).catch(() => {});
    this.escuchaApp = null;
    if (this.temporizadorAviso) clearTimeout(this.temporizadorAviso);
  }

  async ionViewWillEnter() {
    // Al volver de Ajustes del sistema hay que releer: el usuario pudo
    // cambiar algo ahí fuera.
    await this.cargarPermisos();
  }

  /**
   * Relee los permisos cada vez que la app vuelve al primer plano.
   *
   * ESTE ERA EL BUG: la pantalla sólo se actualizaba en `ionViewWillEnter`, que
   * se dispara al NAVEGAR dentro de la app. Abrir los ajustes del sistema y
   * volver no es una navegación, así que la pantalla seguía mostrando el estado
   * viejo: el usuario activaba el permiso, volvía, y el interruptory el texto
   * seguían diciendo "Sin activar". Desde ahí parecía que la app no activaba
   * nada, cuando en realidad el permiso ya estaba granted.
   *
   * `appStateChange` sí se dispara al volver de los ajustes del sistema, que es
   * justo lo que faltaba.
   */
  private escucharRetornoDeAjustes(): void {
    if (!Capacitor.isNativePlatform()) return;
    if (this.escuchaApp) return;

    this.escuchaApp = App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      void this.cargarPermisos();
    });
  }
  private partition() {
    this.grupoInicial = this.permisos.filter((p) => p.momento === 'inicial');
    this.grupoAlUsar = this.permisos.filter((p) => p.momento === 'al-usar');
  }

  async cargarPermisos() {
    this.cargando = true;
    this.cdr.detectChanges();

    try {
      this.permisos = await this.permisosService.verificarTodos();
    } catch (e) {
      console.error('No se pudieron leer los permisos:', e);
      if (this.permisos.length === 0) {
        this.permisos = this.permisosService.getPermisosPorDefecto();
      }
    } finally {
      this.cargando = false;
      this.partition();
      this.cdr.detectChanges();
    }
  }

  /**
   * Estado del circuito de push.
   *
   * No va en el servicio de permisos porque consulta a FCM y a `push_tokens`,
   * que son cosas distintas.
   *
   * Sólo se consulta si el bloque está visible: pedir el registro a FCM tiene un
   * costo real y no tiene sentido pagarlo en una pantalla donde no se muestra.
   */
  async cargarDiagnostico() {
    if (!this.mostrarDiagnostico) return;

    this.cargandoDiag = true;
    this.cdr.detectChanges();

    try {
      this.diag = await this.pushService.diagnostico();
    } catch (e) {
      console.error('No se pudo hacer el diagnóstico de push:', e);
      this.diag = null;
    } finally {
      this.cargandoDiag = false;
      this.cdr.detectChanges();
    }
  }

  async reintentarRegistro() {
    this.reintentando = true;
    this.cdr.detectChanges();

    try {
      await this.pushService.reintentarRegistro();
    } finally {
      this.reintentando = false;
      await this.cargarDiagnostico();
    }
  }

  // =====================================================
  // ESTADO
  // =====================================================

  /**
   * Icono del estado.
   *
   * "Aprobado" con matiz (ubicación aproximada) NO cuenta como todo bien: se
   * muestra en amarillo para que la persona decida si la cambia, en vez de
   * dejarla creyendo que tiene la ubicación exacta.
   */
  estadoDe(p: PermisoInfo): 'ok' | 'aviso' | 'falta' | 'bloqueado' | 'no-aplica' {
    if (p.estado === 'no-aplica') return 'no-aplica';
    if (p.estado === 'concedido') return p.nota ? 'aviso' : 'ok';
    if (p.estado === 'bloqueado') return 'bloqueado';
    if (p.estado === 'denegado') return 'falta';
    return 'aviso';
  }

  /**
   * Texto del estado, junto al nombre.
   *
   * "Concedido con matiz" (ubicación aproximada) NO dice "Activo": sería
   * engañoso, porque la ubicación no es exacta.
   */
  etiqueta(estado: EstadoPermiso): string {
    switch (estado) {
      case 'concedido': return 'Activo';
      case 'denegado': return 'Sin activar';
      case 'bloqueado': return 'Bloqueado';
      case 'no-aplica': return 'No aplica';
      default: return 'Comprobando';
    }
  }

  /** Contador para el encabezado: cuántos importantes están apagados. */
  get faltanCriticos(): number {
    return this.permisos.filter(
      (p) => p.critico && (p.estado === 'denegado' || p.estado === 'bloqueado')
    ).length;
  }

  // =====================================================
  // ACCIONES
  // =====================================================

  /**
   * Estado del interruptor: encendido cuando el permiso está concedido.
   *
   * "Aprobado con matiz" (ubicación aproximada) también cuenta como encendido:
   * el permiso está concedido, lo que se marca aparte es el texto de estado.
   */
  activo(p: PermisoInfo): boolean {
    return p.estado === 'concedido';
  }

  /**
   * El interruptor sólo sabe pedir. Encenderlo pide el permiso; apagarlo no
   * puede hacerse desde la app (Android no lo permite de forma limpia), así que
   * se lleva a los ajustes del sistema y se explica.
   */
  async cambiar(permiso: PermisoInfo, evento: any): Promise<void> {
    // BUG QUE SE PRODUJO AL ARREGLAR EL ANTERIOR:
    //
    // `ion-toggle` dispara `ionChange` también cuando su `checked` cambia desde
    // el código, no sólo cuando lo toca la persona. Al revertir el interruptor
    // (para devolverlo al estado real) se disparaba un `ionChange` con
    // `checked: false`, que el handler leía como "la persona acaba de apagarlo".
    // Como el permiso acababa de concederse, caía en la rama de "no se puede
    // apagar desde la app" y ABRÍA LOS AJUSTES DEL SISTEMA. Para la persona
    // eso era "no se pudo activar": la app lo sacaba del panel asettings.
    //
    // Con este flag los cambios que hacemos nosotros se ignoran.
    if (this.ignorarCambio) return;

    const encendidoPorUsuario = !!evento?.detail?.checked;

    if (this.permisoProcesando) {
      await this.revertirInterruptor();
      return;
    }

    // Encender: se pide el permiso.
    if (encendidoPorUsuario) {
      await this.activar(permiso);
      // Si el permiso terminó denied o bloqueado, el interruptor NO debe
      // quedar encendido: se revierte al valor real.
      await this.revertirInterruptor();
      return;
    }

    // Apagar un permiso que está concedido no se puede desde la app.
    await this.revertirInterruptor();

    if (this.activo(permiso)) {
      this.mostrarAviso(
        `Para desactivar ${permiso.nombre} tienes que hacerlo en los ajustes de tu teléfono.`
      );
      await this.permisosService.abrirAjustesApp();
    }
  }

  /**
   * Devuelve los interruptores a lo que dice el estado real.
   *
   * NO alcanza con `detectChanges()`: si el valor vinculado no cambió (sigue
   * siendo `true`), Angular no vuelve a escribir el DOM y el interruptor se
   * queda donde lo dejó la persona. Por eso se lo fuerza en dos pasos: primero
   * a `false`, después al valor real.
   *
   * El flag `ignorarCambio` se mantiene durante los DOS pasos y un poco más,
   * porque cada repintado dispara un `ionChange` que, sin el flag, el handler
   * interpretaría como que la persona movió el interruptor.
   */
  private async revertirInterruptor(): Promise<void> {
    this.ignorarCambio = true;

    this.sincronizando = true;
    this.cdr.detectChanges();

    // Un turno para que Angular termine de pintar el estado anulado.
    await new Promise((r) => setTimeout(r, 60));

    this.sincronizando = false;
    this.cdr.detectChanges();

    // Y un poco más, para que se ignore también el `ionChange` del segundo
    // repintado (que puede volver a poner el interruptor en `true`).
    setTimeout(() => {
      this.ignorarCambio = false;
    }, 150);
  }

  async activar(permiso: PermisoInfo) {
    if (this.permisoProcesando) return;

    this.permisoProcesando = permiso.id;
    this.cdr.detectChanges();

    try {
      if (permiso.estado === 'bloqueado' || !permiso.puedePedir) {
        // Se pregunta POR QUÉ no se puede pedir, en vez de mostrar un mensaje
        // genérico. Con notificaciones hay tres motivos distintos y cada uno va
        // a una pantalla de Ajustes diferente.
        const motivo = await this.permisosService.motivoFallo(permiso.id);
        this.mostrarAviso(motivo.texto || `Android no deja pedir ${permiso.nombre}.`);
        await this.permisosService.abrirAjustesPara(permiso.id);
        return;
      }

      const resultado = await this.permisosService.pedir(permiso.id);

      if (resultado && this.activo(resultado)) {
        this.mostrarAviso(`${permiso.nombre} activado.`);
      } else {
        // Sigue sin activarse: se informa el motivo real en vez de un
        // "no se pudo activar" que no dice nada.
        const motivo = await this.permisosService.motivoFallo(permiso.id);
        this.mostrarAviso(motivo.texto || `No se pudo activar ${permiso.nombre}.`);
      }
    } catch (e) {
      console.warn('No se pudo activar el permiso:', e);
      const mensaje = e instanceof Error ? e.message : String(e);
      this.mostrarAviso(`Error al activar ${permiso.nombre}: ${mensaje}`);
    } finally {
      this.permisoProcesando = null;
      await this.cargarPermisos();
    }
  }

  private mostrarAviso(texto: string): void {
    this.avisoTexto = texto;
    this.avisoVisible = true;
    this.cdr.detectChanges();

    if (this.temporizadorAviso) clearTimeout(this.temporizadorAviso);
    this.temporizadorAviso = setTimeout(() => {
      this.avisoVisible = false;
      this.cdr.detectChanges();
    }, 4500);
  }

  volver() {
    this.router.navigate(['/ajustes']);
  }
}

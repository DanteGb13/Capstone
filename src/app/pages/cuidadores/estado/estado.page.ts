import { Component, OnInit, OnDestroy, ChangeDetectorRef, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonButton,
  IonIcon,
  IonRefresher,
  IonRefresherContent
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';
import { Vinculacion } from '../../../services/Backend/vinculacion/vinculacion';
import { Salud, type ResumenSalud } from '../../../services/Backend/salud/salud';
import { NavegacionRolService } from '../../../services/navegacion-rol/navegacion-rol';
import { SupabaseService } from '../../../services/supabase/supabase';
import { EstadoConexionComponent } from '../../../components/estado-conexion/estado-conexion.component';

/** Una persona a cargo con su estado de salud ya resuelto. */
interface AdultoConSalud {
  id_usuario: string;
  nombre: string;
  apellido: string;
  fotoUrl: string | null;
  ultimoVisto: string | null;
  comuna: string | null;
  salud: ResumenSalud | null;
}

/**
 * Cuánto puede pasar sin reportar antes de avisarle al cuidador.
 *
 * Los relojes Xiaomi y Amazfit vuelcan sus datos a Health Connect cuando la
 * app del fabricante sincroniza, no de forma continua. Por eso 3 horas sin
 * actualizar no significa necesariamente que algo esté mal: significa que
 * nadie abrió la app del reloj. El aviso va en gris, no en rojo, justamente
 * para no asustar al cuidador por un retraso normal del reloj.
 */
const MINUTOS_PARA_AVISAR_RANCIO = 180;

@Component({
  selector: 'app-estado',
  templateUrl: './estado.page.html',
  styleUrls: ['./estado.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonRefresher,
    IonRefresherContent,
    CommonModule,
    EstadoConexionComponent
  ]
})
export class EstadoPage implements OnInit, OnDestroy {

  @ViewChild(IonRefresher) refresher!: IonRefresher;

  adultos: AdultoConSalud[] = [];

  cargando = false;

  /** Pasa a `true` cuando ya se intentó leer y no hay datos: distingue "cargando" de "no hay". */
  private cargoAlMenosUnaVez = false;

  private vinculacionService = inject(Vinculacion);

  private saludService = inject(Salud);

  private supabaseService = inject(SupabaseService);

  private navRol = inject(NavegacionRolService);

  private cdr = inject(ChangeDetectorRef);

  constructor() {
    addIcons(icons);
  }

  async ngOnInit() {
    await this.cargar();
    this.iniciarAutoRefresh();
  }

  /** Se relee al volver: el adulto mayor pudo reportar mientras esta pantalla no estaba abierta. */
  async ionViewWillEnter() {
    if (this.cargoAlMenosUnaVez) {
      await this.cargar();
    }
  }

  /** El temporizador se detiene al salir de la pantalla: si no, sigue consultando en segundo plano. */
  ngOnDestroy() {
    this.detenerAutoRefresh();
  }

  /**
   * Refresca desde el botón o desde el pull-to-refresher.
   *
   * Se llama desde los dos lados, así que `event` no siempre es el
   * `IonRefresher`: si viene de un botón es un click y no tiene
   * `complete()`. Antes de llamar sin optional chaining reventaba.
   */
  async handleRefresh(event?: any) {
    await this.cargar();
    event?.target?.complete?.();
  }

  async cargar() {
    this.cargando = true;
    this.cdr.detectChanges();

    try {
      const vinculos = await this.vinculacionService.obtenerAdultosACargo();
      await this.cargarFotos(vinculos);

      const ids = vinculos
        .map((v: any) => v?.id_usuario)
        .filter(Boolean) as string[];

      // Una sola consulta para todos: leer persona por persona multiplicaba
      // los viajes a la base por el mismo pantallazo.
      const saludPorUsuario = await this.saludService.obtenerSaludVinculados(ids);

      this.adultos = vinculos.map((v: any) => ({
        id_usuario: v.id_usuario,
        nombre: v.adulto_mayor?.nombre || '',
        apellido: v.adulto_mayor?.apellidopa || '',
        fotoUrl: v.adulto_mayor?.foto_url || null,
        ultimoVisto: v.adulto_mayor?.ultimo_visto || null,
        comuna: v.adulto_mayor?.direccion?.comuna || null,
        salud: saludPorUsuario.get(v.id_usuario) || null
      }));
    } catch (e) {
      console.error('Error cargando el estado de salud:', e);
    } finally {
      this.cargando = false;
      this.cargoAlMenosUnaVez = true;
      this.cdr.detectChanges();
    }
  }

  /**
   * Pide datos frescos a una persona.
   *
   * SE RETIRA A PROPÓSITO. La primera versión tenía un botón "Pedir datos
   * frescos" porque parecía que el cuidador iba a necesitar empujar la
   * sincronización. En la práctica estorba: la subida es automática y pedirla
   * sólo producía un botón que se quedaba en "Actualización solicitada" sin
   * que nada mejorara, porque el teléfono del adulto mayor es el único que
   * puede leer su reloj.
   *
   * Lo que sí hace falta es que esta pantalla no se quede mirando un dato
   * viejo, y eso se resuelve refrescando sola (ver `iniciarAutoRefresh`).
   */
  /**
   * Recarga SOLO los datos de salud, sin volver a pedir la lista de adultos.
   *
   * Antes el refresco automático llamaba a `cargar()` completo, que rehace
   * `obtenerAdultosACargo()` más las fotos de perfil. Eso son varias llamadas
   * a la red y, con que una sola fallara, la lista entera se quedaba como
   * estaba. Y como el refresco era silencioso, el cuidador veía una pantalla
   * congelada sin ninguna pista de por qué.
   *
   * Ahora el vuelco automático toca una sola tabla. Si los datos de salud se
   * actualizan, se nota; si fallan, el error queda a la vista.
   */
  private async refrescarSoloSalud(): Promise<void> {
    const ids = this.adultos
      .map((a) => a.id_usuario)
      .filter(Boolean) as string[];

    if (ids.length === 0) return;

    try {
      const saludPorUsuario = await this.saludService.obtenerSaludVinculados(ids);

      this.adultos = this.adultos.map((a) => ({
        ...a,
        salud: saludPorUsuario.get(a.id_usuario) || a.salud
      }));

      this.cdr.detectChanges();
    } catch (e) {
      console.warn('[Estado] no se pudo refrescar la salud:', e);
    }
  }

  private iniciarAutoRefresh(): void {
    this.detenerAutoRefresh();

    this.timerRefresco = setInterval(() => {
      void this.refrescarSoloSalud();
    }, this.INTERVALO_REFRESCO_MS);
  }

  private detenerAutoRefresh(): void {
    if (this.timerRefresco) {
      clearInterval(this.timerRefresco);
      this.timerRefresco = null;
    }
  }

  /** Cuánto se espera entre lecturas automáticas de la base. */
  private readonly INTERVALO_REFRESCO_MS = 60000;

  private timerRefresco: any = null;

  private async cargarFotos(vinculos: any[]): Promise<void> {
    const supabase = this.supabaseService.getClient();

    await Promise.all(
      vinculos.map(async (item) => {
        const userId = item?.adulto_mayor?.id;
        if (!userId) return;

        try {
          const { data } = await supabase.storage
            .from('fotos-perfil')
            .list(`${userId}/`, { limit: 1 });

          if (data && data.length > 0) {
            const { data: signedUrlData } = await supabase.storage
              .from('fotos-perfil')
              .createSignedUrl(`${userId}/${data[0].name}`, 3600);
            item.adulto_mayor.foto_url = signedUrlData?.signedUrl || null;
          } else {
            item.adulto_mayor.foto_url = null;
          }
        } catch {
          item.adulto_mayor.foto_url = null;
        }
      })
    );
  }

  // =====================================================
  // PRESENTACIÓN
  // =====================================================

  nombreAdulto(a: AdultoConSalud): string {
    return `${a.nombre} ${a.apellido}`.trim();
  }

  iniciales(a: AdultoConSalud): string {
    const base = this.nombreAdulto(a);
    if (!base) return '?';
    return base
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p: string) => p[0].toUpperCase())
      .join('');
  }

  /**
   * Una cifra o "—".
   *
   * El guion es a propósito: `0` y `sin dato` son cosas distintas. Un reloj
   * que no midió nada no es lo mismo que alguien que no se movió en todo el
   * día, y en una pantalla de cuidado esa diferencia importa.
   */
  valor(v: number | null | undefined, sufijo = ''): string {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
    return `${v}${sufijo}`;
  }

  /**
   * Hay alguna fila en la base, aunque sea de una medida que no se enseña.
   *
   * Se mira el resumen entero a propósito, no sólo los campos visibles: un
   * reloj que sólo mide pulso sí tiene datos, y decir "no ha registrado nada"
   * sería mentira.
   */
  tieneAlgunDato(a: AdultoConSalud): boolean {
    const s = a.salud;
    if (!s) return false;
    return [
      s.pasos, s.distancia_metros, s.calorias, s.fc_media, s.fc_reposo,
      s.spo2, s.respiracion, s.sueno_minutos
    ].some((v) => v !== null && v !== undefined);
  }

  /**
   * Al menos uno de los datos que esta pantalla sí muestra.
   *
   * No es lo mismo que `tieneAlgunDato`. Tras quitar el bloque del pulso, un
   * reloj que sólo sabe medir eso deja de tener dónde mostrar un número: sin
   * esta comprobación, esa persona se veía una fila entera de guiones sin una
   * sola palabra que lo explicara.
   */
  tieneMetricasVisibles(a: AdultoConSalud): boolean {
    const s = a.salud;
    if (!s) return false;
    return [s.pasos, s.calorias, s.spo2, s.sueno_minutos]
      .some((v) => v !== null && v !== undefined);
  }

  /** Sin fila en la base: el adulto todavía no ha sincronizado nunca. */
  nuncaReporto(a: AdultoConSalud): boolean {
    return !a.salud;
  }

  datosRancios(a: AdultoConSalud): boolean {
    const min = a.salud?.antiguedadMinutos;
    return min !== null && min !== undefined && min > MINUTOS_PARA_AVISAR_RANCIO;
  }

  /** "hace 5 min" / "hace 3 h" / "sin datos" */
  antiguedad(a: AdultoConSalud): string {
    const min = a.salud?.antiguedadMinutos;
    if (min === null || min === undefined) return 'Nunca ha enviado datos';

    if (min < 1) return 'Actualizado hace un momento';
    if (min < 60) return `Actualizado hace ${min} min`;

    const horas = Math.floor(min / 60);
    if (horas < 24) return `Actualizado hace ${horas} h`;

    const dias = Math.floor(horas / 24);
    return `Actualizado hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
  }

  /** El nombre del reloj o de la app que escribió el dato, si se sabe. */
  origen(a: AdultoConSalud): string | null {
    const s = a.salud;
    if (!s) return null;

    const partes: string[] = [];
    if (s.fuente) partes.push(s.fuente);

    // Health Connect sólo da el tipo de dispositivo ('watch', 'fitnessBand'),
    // no la marca. Se traduce a algo que un cuidador entienda.
    if (s.dispositivo) {
      const legible = this.traducirDispositivo(s.dispositivo);
      if (legible) partes.push(legible);
    }

    return partes.length ? partes.join(' · ') : null;
  }

  private traducirDispositivo(d: string): string | null {
    const mapa: Record<string, string> = {
      watch: 'reloj',
      fitnessBand: 'pulsera',
      ring: 'anillo',
      chestStrap: 'banda de pecho',
      phone: 'teléfono',
      scale: 'báscula',
      headMounted: 'casco'
    };
    return mapa[d] || null;
  }

  /** Minutos de sueño en formato "7 h 20 min". */
  formatearSueno(minutos: number | null | undefined): string {
    if (minutos === null || minutos === undefined) return '—';
    const h = Math.floor(minutos / 60);
    const m = Math.round(minutos % 60);
    if (h === 0) return `${m} min`;
    if (m === 0) return `${h} h`;
    return `${h} h ${m} min`;
  }

  async volver() {
    await this.navRol.irAPanelPrincipal();
  }

}

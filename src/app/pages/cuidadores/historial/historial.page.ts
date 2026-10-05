import { Component, OnInit, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonIcon,
  IonRefresher,
  IonRefresherContent,
  AlertController
} from '@ionic/angular';

import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';

import { Vinculacion } from '../../../services/Backend/vinculacion/vinculacion';
import { SupabaseService } from '../../../services/supabase/supabase';
import {
  HistorialEventos,
  TipoEventoHistorial
} from '../../../services/Backend/historial-eventos/historial-eventos';


export type TipoEvento = TipoEventoHistorial;


export interface EventoHistorial {
  id: string;
  idAdulto: string;
  tipo: TipoEvento;
  titulo: string;
  detalle: string;
  fecha: Date;
}


export interface GrupoHistorial {
  etiqueta: string;
  eventos: EventoHistorial[];
}


interface Filtro {
  id: string;
  etiqueta: string;
  tipos: TipoEvento[];
}


const MESES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic'
];


const ICONOS_TIPO: Record<TipoEvento, string> = {
  sos: 'alert-circle-outline',
  desplazamiento: 'walk-outline',
  zona: 'shield-outline',
  recordatorio: 'notifications-outline',
  salud: 'pulse-outline',
  manual: 'document-text-outline',
  llamada: 'call-outline',
  nota: 'chatbubble-outline',
  estado_casa: 'home-outline',
  ubicacion: 'location-outline'
};


@Component({
  selector: 'app-historial',

  templateUrl: './historial.page.html',

  styleUrls: ['./historial.page.scss'],

  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonIcon,
    IonRefresher,
    IonRefresherContent,
    CommonModule,
    FormsModule
  ]
})


export class HistorialPage implements OnInit {


  adultosACargo: any[] = [];

  adultoSeleccionado: any = null;

  eventos: EventoHistorial[] = [];

  cargando = false;

  cargandoEventos = false;

  busqueda = '';

  filtroActivo = 'todos';

  readonly filtros: Filtro[] = [
    { id: 'todos', etiqueta: 'Todos', tipos: [] },
    { id: 'sos', etiqueta: 'SOS', tipos: ['sos'] },
    { id: 'desplazamientos', etiqueta: 'Desplazamientos', tipos: ['desplazamiento'] },
    { id: 'alertas', etiqueta: 'Alertas', tipos: ['zona'] },
    { id: 'recordatorios', etiqueta: 'Recordatorios', tipos: ['recordatorio'] },
    { id: 'salud', etiqueta: 'Salud', tipos: ['salud'] }
  ];


  private idPendiente: string | null = null;

  private yaCargo = false;


  private vinculacionService = inject(Vinculacion);

  private historialService = inject(HistorialEventos);

  private supabaseService = inject(SupabaseService);

  private route = inject(ActivatedRoute);

  private alertController = inject(AlertController);

  private changeDetectorRef = inject(ChangeDetectorRef);


  constructor() {
    addIcons(icons);
  }


  async ngOnInit() {
    this.route.queryParams.subscribe((params) => {
      const id = params['id'];
      if (id) {
        this.idPendiente = id;
        this.aplicarSeleccion(id);
      }
    });

    await this.cargarAdultos();
  }


  async ionViewWillEnter() {
    if (this.yaCargo) {
      await this.cargarAdultos();
    }
  }


  async handleRefresh(event: any) {
    await this.cargarAdultos();
    event?.target?.complete?.();
  }


  async cargarAdultos() {
    this.cargando = true;
    this.changeDetectorRef.detectChanges();

    try {
      const vinculos = await this.vinculacionService.obtenerAdultosACargo();
      await this.cargarFotos(vinculos);

      this.adultosACargo = vinculos;

      const idPrevio =
        this.idDe(this.adultoSeleccionado) ||
        this.idPendiente ||
        null;

      this.aplicarSeleccion(idPrevio);
    } catch (error: any) {
      console.error('Error al obtener el historial:', error);
    } finally {
      this.cargando = false;
      this.yaCargo = true;
      this.changeDetectorRef.detectChanges();
    }
  }


  private async cargarFotos(vinculos: any[]) {
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
  // SELECCIÓN DE ADULTO MAYOR
  // =====================================================

  private idDe(item: any): string | null {
    return item?.adulto_mayor?.id || item?.id_usuario || item?.id || null;
  }


  private aplicarSeleccion(id: string | null) {
    const encontrado = id
      ? this.adultosACargo.find(
          (item) =>
            item.id === id ||
            item.adulto_mayor?.id === id ||
            item.id_usuario === id
        )
      : null;

    this.adultoSeleccionado = encontrado || this.adultosACargo[0] || null;
    this.refrescarEventos();
  }


  seleccionarAdulto(adulto: any) {
    this.adultoSeleccionado = adulto;
    this.idPendiente = this.idDe(adulto);
    this.refrescarEventos();
    this.changeDetectorRef.detectChanges();
  }


  esSeleccionado(adulto: any): boolean {
    return this.idDe(adulto) === this.idDe(this.adultoSeleccionado);
  }


  nombreSeleccionado(): string {
    const a = this.adultoSeleccionado?.adulto_mayor;
    if (!a) return '';
    return `${a.nombre || ''} ${a.apellidopa || ''} ${a.apellidoma || ''}`.trim();
  }


  iniciales(adulto: any): string {
    const a = adulto?.adulto_mayor;
    const base = `${a?.nombre || ''} ${a?.apellidopa || ''}`.trim();
    if (!base) return '?';

    return base
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p: string) => p[0].toUpperCase())
      .join('');
  }


  // =====================================================
  // EVENTOS (vista historial_eventos de Supabase)
  // =====================================================

  private async refrescarEventos() {
    const id = this.idDe(this.adultoSeleccionado);

    if (!id) {
      this.eventos = [];
      this.cargandoEventos = false;
      return;
    }

    this.cargandoEventos = true;
    this.changeDetectorRef.detectChanges();

    try {
      const filas = await this.historialService.obtenerEventos(id);

      this.eventos = filas.map((fila) => ({
        id: fila.id,
        idAdulto: fila.id_usuario,
        tipo: fila.tipo,
        titulo: fila.titulo,
        detalle: fila.detalle || '',
        fecha: new Date(fila.fecha)
      }));
    } catch (error) {
      console.error('Error al cargar los eventos del historial:', error);
      this.eventos = [];
    } finally {
      this.cargandoEventos = false;
      this.changeDetectorRef.detectChanges();
    }
  }


  // =====================================================
  // FILTRO Y BÚSQUEDA
  // =====================================================

  get eventosFiltrados(): EventoHistorial[] {
    const filtro = this.filtros.find((f) => f.id === this.filtroActivo);
    const tipos = filtro?.tipos || [];
    const texto = this.busqueda.trim().toLowerCase();

    return this.eventos
      .filter(
        (evento) => tipos.length === 0 || tipos.includes(evento.tipo)
      )
      .filter(
        (evento) =>
          !texto ||
          evento.titulo.toLowerCase().includes(texto) ||
          evento.detalle.toLowerCase().includes(texto)
      )
      .sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
  }


  get grupos(): GrupoHistorial[] {
    const grupos: GrupoHistorial[] = [];

    for (const evento of this.eventosFiltrados) {
      const etiqueta = this.etiquetaDeFecha(evento.fecha);
      const ultimo = grupos[grupos.length - 1];

      if (ultimo && ultimo.etiqueta === etiqueta) {
        ultimo.eventos.push(evento);
      } else {
        grupos.push({ etiqueta, eventos: [evento] });
      }
    }

    return grupos;
  }


  private etiquetaDeFecha(fecha: Date): string {
    const ahora = new Date();
    const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    const dia = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    const dias = Math.round((hoy.getTime() - dia.getTime()) / 86400000);

    if (dias === 0) return 'Hoy';
    if (dias === 1) return 'Ayer';

    const corto = `${fecha.getDate()} ${MESES[fecha.getMonth()]}`;
    return fecha.getFullYear() === ahora.getFullYear()
      ? corto
      : `${corto} ${fecha.getFullYear()}`;
  }


  hora(fecha: Date): string {
    const horas = String(fecha.getHours()).padStart(2, '0');
    const minutos = String(fecha.getMinutes()).padStart(2, '0');
    return `${horas}:${minutos}`;
  }


  iconoDe(tipo: TipoEvento): string {
    return ICONOS_TIPO[tipo];
  }


  limpiarBusqueda() {
    this.busqueda = '';
  }


  // =====================================================
  // DETALLE DEL EVENTO
  // =====================================================

  /**
   * Abre el detalle de un evento.
   *
   * El mensaje va como texto plano con saltos de línea, no como HTML: esta app
   * tiene `innerHTMLTemplatesEnabled` en false, así que un `<strong>` o un
   * `<br>` se verían escritos literalmente en pantalla. Por eso no se usan
   * etiquetas acá.
   */
  async abrirEvento(evento: EventoHistorial) {
    const detalle = evento.detalle || 'Sin detalle adicional';

    const lineas = [
      detalle,
      '',
      this.nombreSeleccionado(),
      `${this.etiquetaDeFecha(evento.fecha)} · ${this.hora(evento.fecha)}`
    ];

    const alert = await this.alertController.create({
      header: evento.titulo,
      cssClass: 'alerta-detalle-historial',
      message: lineas.join('\n'),
      buttons: ['Cerrar']
    });

    await alert.present();
  }


  /**
   * Abre el mapa en la posición donde se registró el evento.
   *
   * Antes esta función mostraría coordenadas fijas de Santiago
   * (-33.3669, -70.6784) con un comentario que decía "posteriormente vendrán
   * desde el GPS". Se quitó: un número inventado es peor que no mostrar nada,
   * porque el cuidador lo toma por real.
   *
   * Ahora la posición sale de la última lectura guardada del adulto, que es
   * dato real, y se aclara en el texto que es esa y no el lugar del evento.
   */
  async verUbicacion(evento: EventoHistorial) {
    const idUsuario = evento.idAdulto;

    const info = await this.ultimaUbicacion(idUsuario);

    if (!info) {
      const alert = await this.alertController.create({
        header: 'Ubicación',
        cssClass: 'alerta-detalle-historial',
        message: 'No hay ninguna posición guardada de esta persona todavía.',
        buttons: ['Cerrar']
      });
      await alert.present();
      return;
    }

    const when = info.fecha
      ? `${new Date(info.fecha).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
      : 'sin fecha conocida';

    const lineas = [
      'Esta es la última posición guardada, no el lugar exacto del evento.',
      '',
      `Coordenadas: ${info.latitud}, ${info.longitud}`,
      `Registrada: ${when}`
    ];

    const alert = await this.alertController.create({
      header: 'Última ubicación registrada',
      cssClass: 'alerta-detalle-historial',
      message: lineas.join('\n'),
      buttons: [
        { text: 'Cerrar', role: 'cancel' },
        {
          text: 'Abrir mapa',
          handler: () => this.abrirMapa(info.latitud, info.longitud)
        }
      ]
    });

    await alert.present();
  }


  /** Última posición guardada del adulto, o `null` si nunca hubo. */
  private async ultimaUbicacion(idUsuario: string) {
    if (!idUsuario) return null;

    try {
      const supabase = this.supabaseService.getClient();

      const { data, error } = await supabase
        .from('ubicacion')
        .select('latitud, longitud, fecha')
        .eq('id_usuario', idUsuario)
        .order('fecha', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data?.latitud || !data?.longitud) return null;

      const lat = parseFloat(data.latitud);
      const lng = parseFloat(data.longitud);
      if (isNaN(lat) || isNaN(lng)) return null;

      return { latitud: lat, longitud: lng, fecha: data.fecha as string };
    } catch {
      return null;
    }
  }


  abrirMapa(latitud: number, longitud: number) {
    const url =
      `https://www.google.com/maps?q=${latitud},${longitud}`;

    window.open(url, '_blank');
  }

}

import { AfterViewInit, ChangeDetectorRef, Component, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonSpinner, IonIcon, IonModal } from '@ionic/angular';
import { WebNav } from '../web-nav/web-nav';
import { Vinculacion } from '../../services/Backend/vinculacion/vinculacion';
import { Gps, UbicacionInfo } from '../../services/Backend/gps/gps';
import { SupabaseService } from '../../services/supabase/supabase';
import { addIcons } from 'ionicons';
import { shieldCheckmarkOutline, downloadOutline, closeOutline } from 'ionicons/icons';

declare const L: any;

@Component({
  selector: 'app-ubicaciones',
  templateUrl: 'ubicaciones.page.html',
  styleUrls: ['ubicaciones.page.scss'],
  imports: [WebNav, IonContent, IonSpinner, IonIcon, IonModal, CommonModule, FormsModule],
})
export class UbicacionesPage implements AfterViewInit, OnDestroy {
  personas: any[] = [];
  personaId = '';
  ubicacion: UbicacionInfo | null = null;
  cargando = true;
  zonasSeguras: any[] = [];
  ubicacionesVisitadas: any[] = [];
  zonaSeleccionadaId: string | null = null;
  mostrarModalDescarga = false;

  private readonly vinculacion = inject(Vinculacion);
  private readonly gps = inject(Gps);
  private readonly supabaseService = inject(SupabaseService);
  private readonly cdr = inject(ChangeDetectorRef);
  private mapa: any;
  private marcador: any;
  private capaZonaSegura: any;
  private intervalo: ReturnType<typeof setInterval> | null = null;

  constructor() {
    addIcons({ shieldCheckmarkOutline, downloadOutline, closeOutline });
  }

  abrirModalDescarga(): void {
    this.mostrarModalDescarga = true;
  }

  cerrarModalDescarga(): void {
    this.mostrarModalDescarga = false;
  }

  ngAfterViewInit(): void {
    void this.cargarPersonas();
  }

  ngOnDestroy(): void {
    if (this.intervalo) clearInterval(this.intervalo);
    this.mapa?.remove();
  }

  async cargarPersonas(): Promise<void> {
    try {
      this.personas = await this.vinculacion.obtenerAdultosACargo();
      await this.cargarFotos();
      if (this.personas.length) {
        this.personaId = this.idPersona(this.personas[0]);
        this.inicializarMapa();
        await this.actualizarUbicacion();
        this.intervalo = setInterval(() => void this.actualizarUbicacion(), 30000);
      }
    } catch (error) {
      console.error('No se pudo cargar las personas a cargo:', error);
    } finally {
      this.cargando = false;
      this.cdr.markForCheck();
    }
  }

  async seleccionarPersona(event: Event): Promise<void> {
    this.personaId = (event.target as HTMLSelectElement).value ?? '';
    this.zonaSeleccionadaId = null;
    if (this.capaZonaSegura) {
      this.mapa.removeLayer(this.capaZonaSegura);
      this.capaZonaSegura = null;
    }
    await this.actualizarUbicacion();
  }

  get personaSeleccionada(): any | null {
    return this.personas.find((persona) => this.idPersona(persona) === this.personaId) ?? null;
  }

  get nombrePersona(): string {
    const persona = this.personaSeleccionada?.adulto_mayor;
    if (!persona) return 'Persona seleccionada';
    return `${persona.nombre ?? ''} ${persona.apellidopa ?? ''}`.trim();
  }

  get edadPersona(): string {
    const fechaNacimiento = this.personaSeleccionada?.adulto_mayor?.fecha_nacimiento;
    if (!fechaNacimiento) return 'No disponible';

    const nacimiento = new Date(fechaNacimiento);
    if (Number.isNaN(nacimiento.getTime())) return 'No disponible';

    const hoy = new Date();
    let edad = hoy.getFullYear() - nacimiento.getFullYear();
    const cumpleanosPendiente =
      hoy.getMonth() < nacimiento.getMonth() ||
      (hoy.getMonth() === nacimiento.getMonth() && hoy.getDate() < nacimiento.getDate());
    if (cumpleanosPendiente) edad--;

    return edad >= 0 ? `${edad} años` : 'No disponible';
  }

  get telefonoPersona(): string {
    return this.personaSeleccionada?.adulto_mayor?.telefono || 'No disponible';
  }

  get direccionCasaPersona(): string {
    const direccion = this.personaSeleccionada?.adulto_mayor?.direccion;
    if (!direccion) return 'No disponible';

    const domicilio = [direccion.calle, direccion.numero].filter(Boolean).join(' ');
    const sector = [direccion.comuna, direccion.region].filter(Boolean).join(', ');
    return [domicilio, sector].filter(Boolean).join(', ') || 'No disponible';
  }

  private async cargarDatosAdicionales(idUsuario: string): Promise<void> {
    const supabase = this.supabaseService.getClient();

    const [{ data: zonas }, { data: ubicaciones }] = await Promise.all([
      supabase
        .from('zona_segura')
        .select('id, nombre, direccion_texto, latitud_centro, longitud_centro, radio_metros, es_casa')
        .eq('id_usuario', idUsuario)
        .eq('activa', true),
      supabase
        .from('ubicacion')
        .select('latitud, longitud, fecha')
        .eq('id_usuario', idUsuario)
        .order('fecha', { ascending: false })
        .limit(12),
    ]);

    this.zonasSeguras = (zonas ?? []).map((zona: any) => ({
      id: zona.id,
      nombre: zona.nombre || (zona.es_casa ? 'Casa' : 'Zona segura'),
      direccion: zona.direccion_texto || '',
      latitud: Number(zona.latitud_centro),
      longitud: Number(zona.longitud_centro),
      radio: Number(zona.radio_metros) || 150,
    }));

    const recientes = new Map<string, any>();
    for (const punto of ubicaciones ?? []) {
      const latitud = Number(punto.latitud);
      const longitud = Number(punto.longitud);
      if (!Number.isFinite(latitud) || !Number.isFinite(longitud)) continue;
      const clave = `${latitud.toFixed(3)},${longitud.toFixed(3)}`;
      if (!recientes.has(clave)) recientes.set(clave, { ...punto, latitud, longitud });
      if (recientes.size === 4) break;
    }

    this.ubicacionesVisitadas = await Promise.all([...recientes.values()].map(async (punto: any) => ({
      direccion: await this.gps.obtenerDireccionTexto(punto.latitud, punto.longitud),
      fecha: punto.fecha,
    })));
  }

  idPersona(persona: any): string {
    return persona.adulto_mayor?.id || persona.id_usuario || persona.id || '';
  }

  fotoPersona(persona: any | null = this.personaSeleccionada): string | null {
    return persona?.adulto_mayor?.foto_url ?? persona?.adulto_mayor?.fotoUrl ?? null;
  }

  inicialesPersona(persona: any | null = this.personaSeleccionada): string {
    const datos = persona?.adulto_mayor;
    const iniciales = `${datos?.nombre?.charAt(0) ?? ''}${datos?.apellidopa?.charAt(0) ?? ''}`;
    return iniciales.toUpperCase() || 'SC';
  }

  mostrarZonaSegura(zona: any): void {
    if (!this.mapa || !Number.isFinite(zona.latitud) || !Number.isFinite(zona.longitud)) return;

    this.zonaSeleccionadaId = zona.id;
    if (this.capaZonaSegura) this.mapa.removeLayer(this.capaZonaSegura);

    const centro = [zona.latitud, zona.longitud];
    this.capaZonaSegura = L.featureGroup([
      L.circle(centro, {
        radius: zona.radio,
        color: '#7715c7',
        fillColor: '#7715c7',
        fillOpacity: 0.12,
        weight: 2,
      }),
      L.circleMarker(centro, {
        radius: 7,
        color: '#fff',
        weight: 3,
        fillColor: '#7715c7',
        fillOpacity: 1,
      }).bindPopup(zona.nombre),
    ]).addTo(this.mapa);

    this.mapa.fitBounds(this.capaZonaSegura.getBounds(), { padding: [45, 45], maxZoom: 17 });
    setTimeout(() => this.mapa.invalidateSize(), 0);
  }

  volverUbicacionActual(): void {
    if (!this.mapa || !this.ubicacion) return;

    if (this.capaZonaSegura) {
      this.mapa.removeLayer(this.capaZonaSegura);
      this.capaZonaSegura = null;
    }
    this.zonaSeleccionadaId = null;
    this.mapa.stop();
    this.mapa.invalidateSize({ animate: false });
    this.mapa.setView([this.ubicacion.latitud, this.ubicacion.longitud], 16, { animate: false });
    this.marcador?.openPopup();
    requestAnimationFrame(() => this.mapa.invalidateSize({ animate: false }));
  }

  private async cargarFotos(): Promise<void> {
    const supabase = this.supabaseService.getClient();
    await Promise.all(this.personas.map(async (persona) => {
      const id = this.idPersona(persona);
      if (!id) return;
      try {
        const { data } = await supabase.storage.from('fotos-perfil').list(`${id}/`, { limit: 1 });
        if (!data?.length) {
          persona.adulto_mayor.foto_url = null;
          return;
        }
        const { data: firmado } = await supabase.storage
          .from('fotos-perfil')
          .createSignedUrl(`${id}/${data[0].name}`, 3600);
        persona.adulto_mayor.foto_url = firmado?.signedUrl ?? null;
      } catch {
        persona.adulto_mayor.foto_url = null;
      }
    }));
  }

  private inicializarMapa(): void {
    if (this.mapa || typeof L === 'undefined' || !document.getElementById('ubicaciones-mapa')) return;

    this.mapa = L.map('ubicaciones-mapa', {
      center: [-33.4489, -70.6693],
      zoom: 15,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.mapa);
  }

  private async actualizarUbicacion(): Promise<void> {
    const persona = this.personaSeleccionada;
    if (!persona) return;

    this.cargando = true;
    this.cdr.markForCheck();
    try {
      const ubicacion = await this.gps.obtenerUbicacionAdulto(this.idPersona(persona));
      this.ubicacion = ubicacion;
      this.mostrarUbicacion(ubicacion);
      await this.cargarDatosAdicionales(this.idPersona(persona));
    } catch (error) {
      console.error('No se pudo obtener la ubicación:', error);
    } finally {
      this.cargando = false;
      this.cdr.markForCheck();
    }
  }

  private mostrarUbicacion(ubicacion: UbicacionInfo): void {
    if (!this.mapa) return;
    const coords = [ubicacion.latitud, ubicacion.longitud];
    if (this.marcador) {
      this.marcador.setLatLng(coords);
    } else {
      const marcadorMorado = L.divIcon({
        className: 'marcador-ubicacion',
        html: '<span></span>',
        iconSize: [34, 44],
        iconAnchor: [17, 44],
        popupAnchor: [0, -38],
      });
      this.marcador = L.marker(coords, { icon: marcadorMorado }).addTo(this.mapa);
    }
    this.marcador.bindPopup(this.nombrePersona).openPopup();
    this.mapa.setView(coords, 16);
    setTimeout(() => this.mapa.invalidateSize(), 0);
  }
}

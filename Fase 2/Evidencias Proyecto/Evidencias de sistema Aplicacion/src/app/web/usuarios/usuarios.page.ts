import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { SupabaseService } from '../../services/supabase/supabase';
import { WebNav } from '../web-nav/web-nav';

interface UsuarioFila {
  id: string;
  nombre: string | null;
  apellidopa: string | null;
  apellidoma: string | null;
  correo: string | null;
  estado: boolean | null;
  ultimo_visto: string | null;
  rol: { nombre: string } | { nombre: string }[] | null;
}

interface UsuarioVista {
  nombre: string;
  correo: string;
  rol: string;
  activo: boolean;
  ultimoVisto: string | null;
}

@Component({
  selector: 'app-usuarios',
  templateUrl: 'usuarios.page.html',
  styleUrls: ['usuarios.page.scss'],
  imports: [WebNav, IonContent],
})
export class UsuariosPage implements OnInit {

  cargando = true;
  error = '';
  usuarios: UsuarioVista[] = [];

  private cdr = inject(ChangeDetectorRef);
  private supabaseService = inject(SupabaseService);

  async ngOnInit() {
    try {
      const { data, error } = await this.supabaseService.getClient()
        .from('usuario')
        .select(`
          id,
          nombre,
          apellidopa,
          apellidoma,
          correo,
          estado,
          ultimo_visto,
          rol (nombre)
        `)
        .order('nombre');

      if (error) throw new Error(error.message);

      this.usuarios = ((data ?? []) as UsuarioFila[]).map((fila) => {
        const rolData = fila.rol as any;
        const rol = Array.isArray(rolData) ? rolData[0]?.nombre : rolData?.nombre;

        const nombre = [
          fila.nombre,
          fila.apellidopa,
          fila.apellidoma
        ].filter(Boolean).join(' ').trim();

        return {
          nombre: nombre || 'Sin nombre',
          correo: fila.correo ?? '—',
          rol: rol ?? '—',
          activo: fila.estado !== false,
          ultimoVisto: fila.ultimo_visto ?? null
        };
      });

    } catch (e: any) {
      this.error = e?.message || 'No se pudieron cargar los usuarios.';
    } finally {
      this.cargando = false;
      this.refrescar();
    }
  }

  /**
   * "hace 3 días", "hace 2 horas". Con una fecha absoluta cuesta saber de un
   * vistazo a quién se le apagó la cuenta.
   */
  haceCuanto(iso: string | null): string {
    if (!iso) return 'Nunca';

    const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutos < 1) return 'Hace un momento';
    if (minutos < 60) return `Hace ${minutos} min`;

    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `Hace ${horas} h`;

    const dias = Math.floor(horas / 24);
    if (dias === 1) return 'Ayer';
    return `Hace ${dias} días`;
  }

  /**
   * La app corre SIN zone.js (zoneless): cambiar el estado después de un
   * await NO repinta la vista por sí solo.
   */
  private refrescar() {
    this.cdr.markForCheck();
  }
}

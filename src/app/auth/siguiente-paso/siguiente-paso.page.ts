import { Component, OnInit } from '@angular/core';
import { IonContent, IonButton, IonIcon, IonInput } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { addIcons } from 'ionicons';
import {
  arrowBackOutline,
  cardOutline,
  calendarOutline,
  personOutline,
  callOutline,
  locationOutline,
  homeOutline,
  mapOutline,
  checkmarkCircleOutline
} from 'ionicons/icons';
import { registro } from '../../services/guards/registro/registro';
import { SupabaseService } from '../../services/supabase/supabase';

@Component({
  selector: 'app-siguiente-paso',
  templateUrl: './siguiente-paso.page.html',
  styleUrls: ['./siguiente-paso.page.scss'],
  imports: [
    IonContent,
    IonButton,
    IonIcon,
    IonInput,
    CommonModule,
    FormsModule,
    RouterLink
  ]
})
export class SiguientePasoPage implements OnInit {

  // Datos personales
  nombre: string = '';
  apellidopa: string = '';
  apellidoma: string = '';
  rut: string = '';
  fechaNacimiento: string = '';
  telefono: string = '';

  // Datos de dirección
  region: string = '';
  comuna: string = '';
  calle: string = '';
  numero: string = '';

  tipoCuenta: 'Usuario' | 'Familiar' = 'Usuario';
  mensajeError: string = '';
  cargando: boolean = false;

  constructor(
    private registroService: registro,
    private supabaseService: SupabaseService,
    private router: Router
  ) {
    addIcons({
      arrowBackOutline,
      cardOutline,
      calendarOutline,
      personOutline,
      callOutline,
      locationOutline,
      homeOutline,
      mapOutline,
      checkmarkCircleOutline
    });
  }

  async ngOnInit() {
    // 1. Intentar cargar desde datos temporales si vino de registro tradicional
    const datosTemp = this.registroService.obtenerDatosRegistroTemporal();
    if (datosTemp) {
      if (datosTemp.nombreCompleto) {
        this.desglosarNombre(datosTemp.nombreCompleto);
      }
      if (datosTemp.telefono) {
        this.telefono = datosTemp.telefono;
      }
      if (datosTemp.tipoCuenta) {
        this.tipoCuenta = datosTemp.tipoCuenta;
      }
    }

    // 2. Si vino de Google o sesión activa, cargar info de Supabase
    try {
      const supabase = this.supabaseService.getClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        // Cargar nombre desde metadata de Google si no está seteado
        if (!this.nombre) {
          const fullName =
            user.user_metadata?.['full_name'] ||
            user.user_metadata?.['name'] ||
            '';
          if (fullName) {
            this.desglosarNombre(fullName);
          }
        }

        // Consultar rol asignado en la BD
        const { data: usuario } = await supabase
          .from('usuario')
          .select(`
            id,
            nombre,
            apellidopa,
            apellidoma,
            telefono,
            id_rol,
            rol (
              id,
              nombre
            )
          `)
          .eq('id', user.id)
          .maybeSingle();

        if (usuario) {
          if (usuario.nombre && !this.nombre) this.nombre = usuario.nombre;
          if (usuario.apellidopa && !this.apellidopa) this.apellidopa = usuario.apellidopa;
          if (usuario.apellidoma && !this.apellidoma) this.apellidoma = usuario.apellidoma;
          if (usuario.telefono && !this.telefono) this.telefono = usuario.telefono;

          const rolData = usuario.rol as any;
          const rolNombre = Array.isArray(rolData) ? rolData[0]?.nombre : rolData?.nombre;
          if (rolNombre === 'Usuario' || rolNombre === 'Familiar') {
            this.tipoCuenta = rolNombre;
          }
        }
      }
    } catch (err) {
      console.warn('No se pudieron precargar datos de sesión en siguiente paso:', err);
    }
  }

  private desglosarNombre(nombreCompleto: string) {
    const partes = nombreCompleto.trim().split(' ').filter(p => p.length > 0);
    if (partes.length === 1) {
      this.nombre = partes[0];
    } else if (partes.length === 2) {
      this.nombre = partes[0];
      this.apellidopa = partes[1];
    } else if (partes.length >= 3) {
      this.nombre = partes[0];
      this.apellidopa = partes[1];
      this.apellidoma = partes.slice(2).join(' ');
    }
  }

  async guardarYContinuar() {
    this.mensajeError = '';

    // Validaciones básicas
    if (!this.nombre || !this.apellidopa || !this.rut || !this.fechaNacimiento) {
      this.mensajeError = 'Por favor completa los datos personales obligatorios.';
      return;
    }

    if (!this.region || !this.comuna || !this.calle || !this.numero) {
      this.mensajeError = 'Por favor completa todos los campos de tu dirección.';
      return;
    }

    this.cargando = true;

    try {
      const resultado = await this.registroService.completarPerfilUsuario({
        nombre: this.nombre.trim(),
        apellidopa: this.apellidopa.trim(),
        apellidoma: this.apellidoma.trim(),
        rut: this.rut.trim(),
        fechaNacimiento: this.fechaNacimiento,
        telefono: this.telefono.trim(),
        region: this.region.trim(),
        comuna: this.comuna.trim(),
        calle: this.calle.trim(),
        numero: this.numero.trim(),
        tipoCuenta: this.tipoCuenta
      });

      console.log('Perfil completado exitosamente con rol:', resultado.tipoCuenta);

      // Redirección según rol
      if (resultado.tipoCuenta === 'Usuario') {
        await this.router.navigate(['/adulto-mayor']);
      } else if (resultado.tipoCuenta === 'Familiar') {
        await this.router.navigate(['/cuidador']);
      } else {
        await this.router.navigate(['/adulto-mayor']);
      }

    } catch (error: any) {
      console.error('Error al guardar datos del perfil:', error);
      this.mensajeError = error?.message || 'No se pudieron guardar los datos. Inténtalo de nuevo.';
    } finally {
      this.cargando = false;
    }
  }

}

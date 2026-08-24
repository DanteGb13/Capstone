import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonIcon, IonTitle, IonToolbar, IonButton, IonButtons, IonInput } from '@ionic/angular';
import { CuidadoresService } from '../../../services/Backend/cuidadores/cuidadores';
import { Router } from '@angular/router';
import { ChangeDetectorRef } from '@angular/core';

import { addIcons } from 'ionicons';
import * as icons from 'ionicons/icons';
import { SupabaseService } from '../../../services/supabase/supabase';

@Component({
  selector: 'app-editar-informacion',
  templateUrl: './editar-informacion.page.html',
  styleUrls: ['./editar-informacion.page.scss'],
  imports: [
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonIcon,
    IonButton,
    CommonModule,
    FormsModule,
    IonButtons,
    IonInput
  ]
})
export class EditarInformacionPage implements OnInit {

  constructor(
    private cuidadoresService: CuidadoresService,
    private router: Router,
    private changeDetectorRef: ChangeDetectorRef, 
    private supabaseService: SupabaseService
  ) {
    addIcons(icons);
  }

  nombreUsuario: string = '';
  usuario: any = {};
  usuarioOriginal: any = {}; // Copia para respaldar los datos originales al cancelar
  modoEditar = false;

  async ngOnInit() {
    try {
      this.nombreUsuario = await this.cuidadoresService.cargarUsuarioNombre();
      const datosUsuario = await this.cuidadoresService.cargarUsuario();

      if (datosUsuario) {
        this.usuario = datosUsuario;
        // Creamos una copia de respaldo profunda de los datos cargados (incluyendo la dirección)
        this.usuarioOriginal = JSON.parse(JSON.stringify(datosUsuario));
      }

      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error("Error al cargar los datos del usuario:", error);
    }
  }

  editarPerfil() {
    if (this.modoEditar) {
      this.guardarCambios();
    }
    this.modoEditar = !this.modoEditar;
  }

  // Función para cancelar la edición y restaurar los datos anteriores
  cancelarEdicion() {
    // Restauramos los datos desde la copia de respaldo
    this.usuario = JSON.parse(JSON.stringify(this.usuarioOriginal));
    // Salimos del modo edición
    this.modoEditar = false;
  }

  async guardarCambios() {
    try {
      console.log("Datos a actualizar:", this.usuario);

      // 1. Si el usuario tiene una dirección asociada, actualizamos la tabla 'direccion'
      if (this.usuario.id_direccion && this.usuario.direccion) {
        const { error: errorDireccion } = await this.supabaseService.getClient()
          .from('direccion')
          .update({
            region: this.usuario.direccion.region,
            comuna: this.usuario.direccion.comuna,
            calle: this.usuario.direccion.calle,
            numero: this.usuario.direccion.numero
          })
          .eq('id', this.usuario.id_direccion);

        if (errorDireccion) {
          console.error("Error al actualizar la dirección:", errorDireccion.message);
          return;
        }
      }

      // 2. Actualizamos los datos personales en la tabla 'usuario'
      const { data, error } = await this.supabaseService.getClient()
        .from('usuario')
        .update({
          nombre: this.usuario.nombre,
          apellidopa: this.usuario.apellidopa,
          apellidoma: this.usuario.apellidoma,
          telefono: this.usuario.telefono,
          fecha_nacimiento: this.usuario.fecha_nacimiento
        })
        .eq('id', this.usuario.id);

      if (error) {
        console.error("Error al actualizar el usuario en Supabase:", error.message);
        return;
      }

      // Actualizamos también la copia original con los nuevos datos guardados con éxito
      this.usuarioOriginal = JSON.parse(JSON.stringify(this.usuario));

      console.log("¡Perfil y dirección actualizados con éxito!");

    } catch (err) {
      console.error("Error inesperado al guardar los cambios:", err);
    }
  }

  volver() {
    window.history.back();
  }
}
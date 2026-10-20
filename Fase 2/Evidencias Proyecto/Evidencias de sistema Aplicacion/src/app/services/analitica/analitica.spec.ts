import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SupabaseService } from '../supabase/supabase';
import { AnaliticaService } from './analitica';

@Component({ standalone: true, template: '' })
class PantallaVacia {}

describe('AnaliticaService', () => {

  let eventos: { ruta: string; usuario_id: string | null; plataforma: string }[];

  /**
   * Sólo lo que el servicio usa: `from(...).insert(fila).then(ok, err)` y las
   * dos llamadas de `auth`. El resto del cliente real no hace falta.
   */
  const supabaseMock = {
    from: () => ({
      insert: (fila: any) => {
        eventos.push(fila);
        return Promise.resolve({ error: null });
      }
    }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => { /* nada */ } } }
      })
    }
  };

  beforeEach(() => {
    eventos = [];

    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'panel-control', component: PantallaVacia },
          { path: 'analitica', component: PantallaVacia },
          { path: 'usuarios', component: PantallaVacia },
          { path: 'mi-perfil', component: PantallaVacia },
          { path: 'inicio', component: PantallaVacia },
          { path: 'planes', component: PantallaVacia },
          { path: 'adulto-mayor', component: PantallaVacia },
          { path: 'cuidador', component: PantallaVacia }
        ]),
        { provide: SupabaseService, useValue: { getClient: () => supabaseMock } }
      ]
    });

    TestBed.inject(AnaliticaService).iniciar();
  });

  /**
   * El registro va con `void`: no se espera a la promesa, así que hay que
   * dejar correr los microtareas antes de mirar si quedó algo.
   */
  async function abrir(ruta: string) {
    await TestBed.inject(Router).navigateByUrl(ruta);
    await new Promise((resolver) => setTimeout(resolver, 0));
  }

  it('registra las pantallas públicas y las de la app', async () => {
    await abrir('/inicio');
    expect(eventos.map((e) => e.ruta)).toEqual(['/inicio']);

    await abrir('/adulto-mayor');
    expect(eventos.map((e) => e.ruta)).toEqual(['/inicio', '/adulto-mayor']);
  });

  it('ignora las rutas del panel del administrador', async () => {
    await abrir('/panel-control');
    await abrir('/analitica');
    await abrir('/usuarios');
    await abrir('/mi-perfil');

    // El administrador mirando su propio panel no es dato de uso.
    expect(eventos).toEqual([]);
  });

  it('no registra dos veces la misma pantalla seguida', async () => {
    await abrir('/planes');
    await abrir('/planes');

    expect(eventos.length).toBe(1);
  });

  it('marca la plataforma según dónde corra', async () => {
    await abrir('/cuidador');

    // En las pruebas Capacitor.isNativePlatform() es false, así que web.
    expect(eventos[0].plataforma).toBe('web');
  });
});

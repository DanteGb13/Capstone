import { Injectable } from '@angular/core';
import { SupabaseService } from '../../supabase/supabase';



@Injectable({
  providedIn: 'root'
})


export class Gps {
    constructor(
        private supabaseService: SupabaseService
    ) { }




}
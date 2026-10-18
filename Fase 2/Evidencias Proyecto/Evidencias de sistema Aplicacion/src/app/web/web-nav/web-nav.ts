import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-web-nav',
  templateUrl: 'web-nav.html',
  styleUrls: ['web-nav.scss'],
  imports: [RouterLink, RouterLinkActive],
})
export class WebNav {}
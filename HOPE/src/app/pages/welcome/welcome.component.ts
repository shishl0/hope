import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-welcome',
  imports: [RouterLink],
  template: `
    <main class="screen welcome">
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Next Gen Web-Tank Combat</p>
          <h1>Добро пожаловать, командир</h1>
          <p class="lead">Выбери танк, собери экипаж в лобби и выходи на темную броневую арену.</p>
          <div class="actions">
            <a routerLink="/login" class="button primary">Войти</a>
            <a routerLink="/register" class="button secondary">Регистрация</a>
          </div>
        </div>

        <div class="hero-tank-image" aria-hidden="true">
          <span class="hero-block turret"></span>
          <span class="hero-block barrel"></span>
          <span class="hero-block body one"></span>
          <span class="hero-block body two"></span>
          <span class="hero-block body three"></span>
          <span class="hero-block track one"></span>
          <span class="hero-block track two"></span>
          <span class="hero-block track three"></span>
        </div>
      </section>
    </main>
  `,
})
export class WelcomeComponent {}

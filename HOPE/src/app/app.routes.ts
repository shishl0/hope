import { Routes } from '@angular/router';
import { GameComponent } from './core/pages/game/game';
import { authGuard } from './core/guards/auth.guard';
import { WelcomeComponent } from './pages/welcome/welcome.component';
import { LoginComponent } from './pages/login/login.component';
import { RegisterComponent } from './pages/register/register.component';
import { ProfileComponent } from './pages/profile/profile.component';
import { GarageComponent } from './pages/garage/garage.component';
import { LobbyComponent } from './pages/lobby/lobby.component';
import { FriendsComponent } from './pages/friends/friends.component';

export const routes: Routes = [
    { path: '', redirectTo: 'profile', pathMatch: 'full' },
    { path: 'login', component: LoginComponent },
    { path: 'register', component: RegisterComponent },
    { path: 'profile', component: ProfileComponent, canActivate: [authGuard] },
    { path: 'garage', component: GarageComponent, canActivate: [authGuard] },
    { path: 'lobby', component: LobbyComponent, canActivate: [authGuard] },
    { path: 'lobby/:id', component: LobbyComponent, canActivate: [authGuard] },
    { path: 'friends', component: FriendsComponent, canActivate: [authGuard] },
    { path: 'game', component: GameComponent, canActivate: [authGuard] },
    { path: 'game/:id', component: GameComponent, canActivate: [authGuard] },
    { path: '**', redirectTo: '' },
];

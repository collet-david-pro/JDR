import type { RouteDefinition } from './router';
import type { PageComponent } from './lib/page';
import Home from './pages/Home.svelte';
import Login from './pages/Login.svelte';
import Register from './pages/Register.svelte';

/**
 * SPA routes (projet.md section 13.1). Core pages (shell, auth, dashboard) are bundled in
 * the initial chunk; the others are loaded on demand. Order matters: first match wins.
 * `access` (lib/guard.ts): omitted = `protected` (signed-in users only).
 */
export const routes: readonly RouteDefinition<PageComponent>[] = [
  { name: 'home', path: '/', component: Home, titleKey: 'app.name' },
  {
    name: 'login',
    path: '/login',
    component: Login,
    titleKey: 'pages.login.title',
    access: 'guest',
  },
  {
    name: 'register',
    path: '/register',
    component: Register,
    titleKey: 'pages.register.title',
    access: 'guest',
  },
  {
    name: 'invite',
    path: '/invite/:code',
    component: Register,
    titleKey: 'pages.register.title',
    access: 'guest',
  },
  {
    name: 'forgot',
    path: '/forgot',
    load: () => import('./pages/Forgot.svelte'),
    titleKey: 'pages.forgot.title',
    access: 'public',
  },
  {
    name: 'reset',
    path: '/reset/:token',
    load: () => import('./pages/Reset.svelte'),
    titleKey: 'pages.reset.title',
    access: 'public',
  },
  {
    // Path used by the server for the links it sends (app/Domain/Support/Links.php).
    name: 'reset-password',
    path: '/reset-password/:token',
    load: () => import('./pages/Reset.svelte'),
    titleKey: 'pages.reset.title',
    access: 'public',
  },
  {
    name: 'game',
    path: '/games/:id',
    load: () => import('./pages/Game.svelte'),
    titleKey: 'pages.game.title',
  },
  {
    name: 'map-editor',
    path: '/games/:id/maps/:mapId/edit',
    load: () => import('./pages/Editor.svelte'),
    titleKey: 'pages.editor.title',
  },
  {
    name: 'session',
    path: '/sessions/:id',
    load: () => import('./pages/Session.svelte'),
    titleKey: 'pages.session.title',
  },
  {
    name: 'join',
    path: '/join/:code?',
    load: () => import('./pages/Join.svelte'),
    titleKey: 'pages.join.title',
  },
  {
    name: 'display',
    path: '/display',
    load: () => import('./pages/Display.svelte'),
    titleKey: 'pages.display.title',
    access: 'public',
  },
  {
    name: 'library',
    path: '/library',
    load: () => import('./pages/Library.svelte'),
    titleKey: 'pages.library.title',
  },
  {
    name: 'profile',
    path: '/profile',
    load: () => import('./pages/profile/Profile.svelte'),
    titleKey: 'pages.profile.title',
  },
  {
    name: 'admin',
    path: '/admin/*',
    load: () => import('./pages/admin/Admin.svelte'),
    titleKey: 'pages.admin.title',
    access: 'admin',
  },
];

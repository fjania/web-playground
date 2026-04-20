/**
 * Bootstrap for the Compose harness — mounts ComposeApp.svelte.
 */

import { mount } from 'svelte';
import ComposeApp from './ComposeApp.svelte';

const host = document.getElementById('compose-app');
if (!host) throw new Error('missing #compose-app host element');

mount(ComposeApp, { target: host });

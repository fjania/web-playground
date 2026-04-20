/**
 * Bootstrap for the TrimPanel harness — mounts TrimApp.svelte into
 * the page. All pipeline + URL-param wiring lives in the Svelte
 * component itself.
 */

import { mount } from 'svelte';
import TrimApp from './TrimApp.svelte';

const host = document.getElementById('trim-app');
if (!host) throw new Error('missing #trim-app host element');

mount(TrimApp, { target: host });

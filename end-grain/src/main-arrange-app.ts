/**
 * Bootstrap for the Arrange harness — mounts ArrangeApp.svelte.
 */

import { mount } from 'svelte';
import ArrangeApp from './ArrangeApp.svelte';

const host = document.getElementById('arrange-app');
if (!host) throw new Error('missing #arrange-app host element');

mount(ArrangeApp, { target: host });

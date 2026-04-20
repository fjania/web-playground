/**
 * Bootstrap for the Cut harness — mounts CutApp.svelte. All
 * URL-param + pipeline + tile-promote logic lives in the component.
 */

import { mount } from 'svelte';
import CutApp from './CutApp.svelte';

const host = document.getElementById('cut-app');
if (!host) throw new Error('missing #cut-app host element');

mount(CutApp, { target: host });

/**
 * Bootstrap for the workbench — mounts Workbench.svelte.
 */

import { mount } from 'svelte';
import Workbench from './Workbench.svelte';

const host = document.getElementById('workbench-app') ?? document.body;
mount(Workbench, { target: host });

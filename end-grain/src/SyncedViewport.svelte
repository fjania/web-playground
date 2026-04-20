<script lang="ts" module>
  /**
   * SyncedViewport — wraps setupViewport in a Svelte lifecycle.
   *
   * Receives a Three Group to render plus a $bindable CameraState
   * shared by all synced viewports in the workbench. Tumbling any
   * one pushes the new CameraState out through the binding; pipeline
   * reruns reconstruct the group but leave the binding intact, so
   * orientation survives reruns.
   */

  import type { CameraState } from './scene/viewport';
  export type { CameraState };
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { Group } from 'three';
  import { setupViewport, type ViewportHandle, type ViewportOptions } from './scene/viewport';

  interface Props {
    group: Group;
    /** Shared camera orientation — bound so peer viewports stay in sync. */
    camera?: CameraState | null;
    vertical?: 'z' | 'x';
    mode?: ViewportOptions['mode'];
    /** Optional callback fired when the user tumbles this viewport. */
    onCameraChange?: (state: CameraState) => void;
  }

  let { group, camera = $bindable(null), vertical, mode, onCameraChange }: Props = $props();

  let container: HTMLDivElement | undefined = $state();
  let handle: ViewportHandle | null = null;
  /** Last CameraState we applied (either via setCameraState or via
   *  our own emit). */
  let lastAppliedCamera: CameraState | null = null;
  /** Reference-equality tracker — only remount when the Group
   *  identity actually changes. */
  let currentGroup: Group | null = null;

  function mount(g: Group): void {
    if (!container) return;
    handle?.dispose();
    currentGroup = g;
    handle = setupViewport(container, g, {
      vertical,
      mode,
      initialCameraState: camera ?? undefined,
    });
    // Seed shared camera from this viewport's default fit if the
    // binding hasn't been initialised yet.
    if (camera == null) {
      const fresh = handle.getCameraState();
      lastAppliedCamera = fresh;
      camera = fresh;
    } else {
      lastAppliedCamera = camera;
    }
    handle.onCameraChange((state) => {
      lastAppliedCamera = state;
      camera = state;
      onCameraChange?.(state);
    });
  }

  onMount(() => {
    mount(group);
    return () => {
      handle?.dispose();
      handle = null;
    };
  });

  // Remount when the underlying Three Group changes (e.g. pipeline
  // rerun produces a new group).
  $effect(() => {
    if (!handle) return;
    if (group === currentGroup) return;
    mount(group);
  });

  // Apply incoming camera updates from peer viewports. setCameraState
  // suppresses onCameraChange internally so we don't loop.
  $effect(() => {
    if (!handle || !camera) return;
    if (camera === lastAppliedCamera) return;
    lastAppliedCamera = camera;
    handle.setCameraState(camera);
  });
</script>

<div class="viewport-host" bind:this={container}></div>

<style>
  .viewport-host {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>

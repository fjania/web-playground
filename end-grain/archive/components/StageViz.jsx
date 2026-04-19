import { useRef, useEffect } from 'preact/hooks';
import { renderStage } from '../stage-renderers.js';

export function StageViz({ snap, prevSnap, width = 300, height = 120 }) {
  const ref = useRef();

  useEffect(() => {
    const svg = ref.current;
    if (!svg || !snap) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const pad = 6;
    renderStage(svg, snap, prevSnap, { x: pad, y: pad, w: width - pad * 2, h: height - pad * 2 });
  }, [snap, prevSnap, width, height]);

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
    />
  );
}

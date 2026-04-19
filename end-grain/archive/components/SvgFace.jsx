import { useRef, useEffect } from 'preact/hooks';
import { drawLayout } from '../render.js';

export function SvgFace({ face, width = 200, height = 150, class: cls = '' }) {
  const ref = useRef();

  useEffect(() => {
    const svg = ref.current;
    if (!svg || !face) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const pad = 4;
    drawLayout(svg, face, { x: pad, y: pad, w: width - pad * 2, h: height - pad * 2 });
  }, [face, width, height]);

  if (!face) return null;

  return (
    <svg
      ref={ref}
      class={cls}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
    />
  );
}

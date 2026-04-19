import { useState, useRef, useEffect } from 'preact/hooks';
import { SPECIES } from '../pipeline.js';

export function SpeciesPicker({ selected, onSelect, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', close, true);
    return () => document.removeEventListener('click', close, true);
  }, [open]);

  return (
    <span ref={ref} style="position:relative">
      <span onClick={() => setOpen(!open)}>{children}</span>
      {open && (
        <div class="popover" style="position:absolute; left:0; top:100%; z-index:10; display:block">
          <h4>Species</h4>
          <div class="species-grid">
            {Object.entries(SPECIES).map(([key, sp]) => (
              <button
                class="species-option"
                onClick={() => { onSelect(key); setOpen(false); }}
              >
                <span class="sw" style={{ background: sp.color }} />
                {sp.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

import { render } from 'preact';
import { stockThickness } from './state.js';
import { PresetPicker } from './components/PresetPicker.jsx';
import { StripEditor } from './components/StripEditor.jsx';
import { OperationList } from './components/OperationList.jsx';
import { PipelineView } from './components/PipelineView.jsx';
import { FinalFace } from './components/FinalFace.jsx';
import { SliderRow } from './components/SliderRow.jsx';

function App() {
  return (
    <div class="app">
      <header class="topbar">
        <a class="back" href="../">&larr; Playground</a>
        <div class="title-group">
          <h1 class="site-title">End <em>Grain</em></h1>
          <p class="site-subtitle">Cutting board pattern designer</p>
        </div>
      </header>

      <main class="main">
        <aside class="sidebar">
          <PresetPicker />
          <StripEditor />

          <section class="panel">
            <h2 class="panel-title">Stock</h2>
            <SliderRow
              label="Thickness"
              min={15} max={40} step={1}
              value={stockThickness.value}
              onChange={v => { stockThickness.value = v; }}
              unit="mm"
            />
          </section>

          <OperationList />
        </aside>

        <section class="stages">
          <PipelineView />
          <FinalFace />
        </section>
      </main>
    </div>
  );
}

render(<App />, document.getElementById('app'));

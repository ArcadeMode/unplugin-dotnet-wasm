import './styles.css';

// Blazor does not auto-start if the entry is loaded as a module (see webpack.config.js).
import '_framework/blazor.webassembly';
// await window.Blazor.start();

import 'favicon.png';
import './sample-data/weather.json';

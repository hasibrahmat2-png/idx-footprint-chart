import { calculateMovingAverageIndicatorValues } from './src/indicators/moving-average/moving-average-calculation';
import * as fs from 'fs';
const data = JSON.parse(fs.readFileSync('public/JELI_5m.json', 'utf8'));
data.forEach(d => { if (typeof d.time === 'string') d.time = Math.floor(new Date(d.time).getTime() / 1000); });
const maData = calculateMovingAverageIndicatorValues(data, { length: 20, source: 'close' });
console.log(maData.slice(-5));

import autoprefixer from 'autoprefixer';
import tailwindcss from '@tailwindcss/postcss';
import remToPx from './postcss.rem2px.mjs';

export default {
  plugins: [remToPx({ baseValue: 16 }), tailwindcss, autoprefixer],
};

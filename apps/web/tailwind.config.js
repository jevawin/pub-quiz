/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Gate `hover:` utilities behind `@media (hover: hover)` so hover styles
  // only apply with a real hover-capable pointer (mouse). On touch devices a
  // tapped element no longer keeps its :hover state until you tap elsewhere.
  future: { hoverOnlyWhenSupported: true },
  theme: { extend: {} },
  plugins: [],
};

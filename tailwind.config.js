/** @type {import('tailwindcss').Config} */
// Same theme the page used to hand to the play CDN at runtime, now compiled ahead of time.
module.exports = {
  content: ['./index.html'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] },
      // NB: the old inline config also set cyan/rose/emerald/amber to single hex values, which
      // silently replaced the whole shade palette and killed classes like text-cyan-300.
      // Those hexes are Tailwind's own 400 shades anyway, so the built-in palette does the job.
      colors: { void: '#05050a', panel: '#0c0c14', border: '#1a1a28', accent: '#6366f1' }
    }
  }
};

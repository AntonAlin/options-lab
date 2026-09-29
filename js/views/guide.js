import { t, L } from '../i18n.js';
import { esc, card, pageHead } from '../ui.js';
import { GUIDE } from '../guide.js';

// How to work the platform, one card per topic. Content lives in js/guide.js.
function block(b) {
  if (b.h) return `<h3 class="h3">${esc(L(b.h))}</h3>`;
  if (b.p) return `<p>${esc(L(b.p))}</p>`;
  if (b.steps) return `<ol class="guide-steps">${b.steps.map(s => `<li>${esc(L(s))}</li>`).join('')}</ol>`;
  if (b.list) return `<ul class="guide-list">${b.list.map(s => `<li>${esc(L(s))}</li>`).join('')}</ul>`;
  if (b.note) return `<div class="guide-note ${b.tone || 'info'}">${esc(L(b.note))}</div>`;
  if (b.code) return `<pre class="meth-formula">${esc(b.code)}</pre>`;
  if (b.href) return `<p><a class="btn btn-sm" href="${esc(b.href)}" target="_blank" rel="noopener noreferrer">${esc(L(b.label))} ↗</a></p>`;
  if (b.link) return `<p><a class="btn btn-sm" href="#/${esc(b.link)}">${esc(L(b.label))} →</a></p>`;
  return '';
}

export default {
  noPortfolio: true,
  render(root) {
    root.innerHTML = `
      ${pageHead(t('nav.guide'), esc(t('guide.sub')))}
      <nav class="meth-toc" aria-label="${esc(t('guide.toc'))}">${GUIDE.map(s => `<a href="#/guide?s=${s.id}" data-jump="${s.id}">${esc(L(s.title))}</a>`).join('')}</nav>
      ${GUIDE.map(s => card(L(s.title), `<div class="guide">${s.blocks.map(block).join('')}</div>`, { id: 'guide-' + s.id, cls: s.id === 'privacy' ? 'guide-privacy' : '' })).join('')}
    `;
    const jump = id => document.getElementById('guide-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    root.querySelectorAll('[data-jump]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); jump(a.dataset.jump); }));
    // Links elsewhere in the app point at a section with #/guide?s=privacy.
    const s = new URLSearchParams(location.hash.split('?')[1] || '').get('s');
    if (s) requestAnimationFrame(() => jump(s));
  }
};

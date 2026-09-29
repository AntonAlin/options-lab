import { t, L } from '../i18n.js';
import { esc, card, pageHead } from '../ui.js';
import { METHODOLOGY } from '../methodology.js';
import { REPO_URL } from '../guide.js';

// 'analytics.js (factorModel) · pricing.js' → each file name links to the file on GitHub, so every
// method can be checked in the code; the rest of the text stays as it is.
const moduleLinks = mods => `<code>${esc(mods).replace(/[\w-]+\.js/g, f => `<a href="${REPO_URL}/blob/main/js/${f}" target="_blank" rel="noopener noreferrer">${f}</a>`)}</code>`;

// Every calculation, one card per area. Formulas are shown verbatim in a monospace block; the
// notes say what is simplified. Nothing here is computed — it documents the modules that do.
export default {
  noPortfolio: true,
  render(root) {
    root.innerHTML = `
      ${pageHead(t('nav.methodology'), esc(t('meth.sub')))}
      <nav class="meth-toc" aria-label="${esc(t('meth.toc'))}">${METHODOLOGY.map(s => `<a href="#/methodology?s=${s.id}" data-jump="${s.id}">${esc(L(s.title))}</a>`).join('')}</nav>
      ${METHODOLOGY.map(s => card(L(s.title), `
        ${s.intro ? `<p class="muted">${esc(L(s.intro))}</p>` : ''}
        <dl class="meth-list">${s.items.map(it => `
          <div class="meth-item">
            <dt>${esc(L(it))}</dt>
            <dd>
              <pre class="meth-formula">${esc(it.formula)}</pre>
              ${L(it.notes) ? `<p>${esc(L(it.notes))}</p>` : ''}
              ${it.params ? `<p class="meth-params"><span>${esc(t('meth.params'))}</span> <code>${esc(it.params)}</code></p>` : ''}
            </dd>
          </div>`).join('')}</dl>
        <p class="footnote">${esc(t('meth.module'))} ${moduleLinks(s.module)}</p>`, { id: 'meth-' + s.id })).join('')}
      <p class="footnote">${esc(t('meth.foot'))} <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">${esc(t('app.source'))} ↗</a></p>
    `;
    root.querySelectorAll('[data-jump]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      document.getElementById('meth-' + a.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }
};

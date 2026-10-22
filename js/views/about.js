// About: what the app is, why it exists, how private it is, how it calculates and who built it.
// Readable without a data source (an open route in js/app.js).
import { t, L } from '../i18n.js';
import { esc, card, pageHead, privacyCallout } from '../ui.js';
import { METHODOLOGY } from '../methodology.js';
import { REPO_URL } from '../guide.js';

const GITHUB_PROFILE = 'https://github.com/AntonAlin';
// TODO(Anton): your LinkedIn profile URL. The link is left out until it is set.
const LINKEDIN_URL = '';
// 'about.why' in js/i18n.js holds a TODO(Anton) placeholder; its card stays hidden until it is written.

export default {
  noPortfolio: true,
  render(root) {
    const ext = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
    root.innerHTML = `
      ${pageHead(t('nav.about'), esc(t('about.sub')))}
      ${card(t('about.whatTitle'), `<p>${esc(t('about.what'))}</p>`)}
      ${/^TODO\(/.test(t('about.why')) ? '' : card(t('about.whyTitle'), `<p>${esc(t('about.why'))}</p>`)}
      ${card(t('about.privacyTitle'), `${privacyCallout(t('about.privacy'))}`)}
      ${card(t('about.methodTitle'), `<p>${esc(t('about.method'))}</p>
        <ul class="guide-list">${METHODOLOGY.map(s => `<li><a href="#/methodology?s=${esc(s.id)}">${esc(L(s.title))}</a></li>`).join('')}</ul>
        <p><a class="btn btn-sm" href="#/methodology">${esc(t('about.methodAll'))}</a></p>`)}
      ${card(t('about.byTitle'), `<p>${esc(t('about.by'))}</p>
        <p class="btn-row">${ext(GITHUB_PROFILE, 'GitHub: AntonAlin')}${LINKEDIN_URL ? ` · ${ext(LINKEDIN_URL, 'LinkedIn')}` : ''} · ${ext(REPO_URL, t('about.source'))}</p>`)}
      ${card(t('rep.disclaimerTitle'), `<p class="muted">${esc(t('rep.disclaimer'))}</p>`)}`;
  }
};

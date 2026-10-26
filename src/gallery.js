import { examples } from './examples.js';
const cards = document.getElementById('cards');
const elements = examples.map(example => {
  const card = document.createElement('article'); card.className = 'gallery-card';
  const image = document.createElement('img'); image.src = `examples/screenshots/${example.id}.png`; image.alt = `${example.title} running in the Apptron console`; image.loading = 'lazy'; image.width = 640; image.height = 360;
  image.onerror = () => { image.hidden = true; };
  const preview = document.createElement('div'); preview.className = 'card-preview';
  const label = document.createElement('span'); label.textContent = '>_ ' + example.language; label.setAttribute('aria-hidden', 'true'); preview.append(label, image);
  const content = document.createElement('div'); content.className = 'card-content';
  const meta = document.createElement('div'); meta.className = 'card-meta'; meta.textContent = example.language;
  if (example.needsRelay) { const badge = document.createElement('span'); badge.className = 'relay-badge'; badge.textContent = 'Needs relay'; meta.append(badge); }
  const title = document.createElement('h2'); title.textContent = example.title;
  const description = document.createElement('p'); description.textContent = example.description;
  const link = document.createElement('a'); link.href = `./?example=${example.id}`; link.textContent = 'Load in editor →'; link.setAttribute('aria-label', `Load ${example.title} in editor`);
  content.append(meta, title, description, link); card.append(preview, content); cards.append(card); return { card, text: `${example.title} ${example.description} ${example.language}`.toLowerCase() };
});
const input = document.getElementById('search');
function filter() {
  let count = 0; for (const { card, text } of elements) { card.hidden = !text.includes(input.value.trim().toLowerCase()); if (!card.hidden) count++; }
  document.getElementById('results').textContent = `${count} playground${count === 1 ? '' : 's'}`; document.getElementById('empty').hidden = count !== 0;
}
input.addEventListener('input', filter); filter();

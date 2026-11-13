import {mountGalleryAi,aiCallback} from './ai-client.js';
import {config,type} from './fragment-config.js';
if(aiCallback()) await new Promise(()=>{});
function mountGallery(options){const gallery=mountOriginalGallery(options);queueMicrotask(()=>void mountGalleryAi({config,type,...options}).catch(error=>{const p=document.createElement('p');p.setAttribute('role','status');p.textContent=error.message;options.container.before(p);}));return gallery;}
import{mountGallery as mountOriginalGallery}from'../vendor/fragment-kit-v0.4.3/src/index.js';
import{catalog}from'./gallery-catalog.js';
const container=document.getElementById('gallery'),state={build:doc=>{const sample=catalog.find(sample=>sample.document===doc);return{href:'./?example='+encodeURIComponent(sample.id)};}};
mountGallery({container,catalog:catalog.map(sample=>({...sample,cover:'gallery/covers/'+sample.id+'.png'})),urlState:state});
container.querySelector('input').id='search';container.querySelector('select').id='tag';container.querySelector('[role=status]').id='results';const grid=container.querySelector('.fk-gallery-grid');grid.id='cards';
function decorate(){for(const card of grid.children){const sample=catalog.find(sample=>sample.title===card.querySelector('h2').textContent);if(!sample||card.dataset.decorated)continue;card.dataset.decorated='true';card.classList.add('gallery-card');
 const preview=document.createElement('div');preview.className='card-preview';preview.append(card.querySelector('img'));const content=document.createElement('div');content.className='card-content';content.append(...card.childNodes);card.append(preview,content);
 const link=content.querySelector('a');link.textContent='Load in editor →';link.setAttribute('aria-label','Load '+sample.title+' in editor');if(sample.needsRelay){const badge=document.createElement('span');badge.className='relay-badge';badge.textContent='Needs relay';content.prepend(badge);}
}}
new MutationObserver(decorate).observe(grid,{childList:true});decorate();

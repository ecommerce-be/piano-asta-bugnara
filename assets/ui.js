/* Finestre di dialogo del sito, al posto di prompt() e confirm() del browser.
   Usano l'elemento <dialog>: chiusura con Esc, sfondo che blocca il resto della
   pagina, e soprattutto l'aspetto del sito invece di quello di Chrome. */

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function apri(html, prepara) {
  return new Promise(risolvi => {
    const d = document.createElement('dialog');
    d.className = 'modale';
    d.innerHTML = html;
    document.body.appendChild(d);

    let esito = null;
    const chiudi = valore => { esito = valore; d.close(); };

    d.addEventListener('close', () => { d.remove(); risolvi(esito); });
    d.addEventListener('cancel', e => { e.preventDefault(); chiudi(null); });
    // clic sullo sfondo scuro: il target è il dialog stesso, non il suo contenuto
    d.addEventListener('click', e => { if (e.target === d) chiudi(null); });
    d.querySelectorAll('[data-annulla]').forEach(b => b.onclick = () => chiudi(null));

    prepara?.(d, chiudi);
    d.showModal();
    (d.querySelector('[autofocus]') || d.querySelector('input,select,button'))?.focus();
  });
}

/**
 * Finestra con uno o più campi.
 * campi: [{ id, etichetta, tipo: 'testo'|'numero'|'scelta', valore, opzioni:[{v,t}],
 *           min, max, aiuto, obbligatorio }]
 * Restituisce un oggetto { id: valore } oppure null se si annulla.
 */
export function chiediCampi({ titolo, testo, campi, ok = 'Conferma', annulla = 'Annulla' }) {
  const corpo = campi.map((c, i) => {
    const attr = `id="mc_${c.id}" name="${esc(c.id)}"${i === 0 ? ' autofocus' : ''}${c.obbligatorio ? ' required' : ''}`;
    let campo;
    if (c.tipo === 'scelta') {
      campo = `<select ${attr}>${(c.opzioni || []).map(o =>
        `<option value="${esc(o.v)}"${o.v === c.valore ? ' selected' : ''}>${esc(o.t)}</option>`).join('')}</select>`;
    } else if (c.tipo === 'numero') {
      campo = `<input type="number" ${attr} value="${esc(c.valore ?? '')}"
        ${c.min != null ? `min="${c.min}"` : ''} ${c.max != null ? `max="${c.max}"` : ''} inputmode="numeric">`;
    } else {
      campo = `<input type="text" ${attr} value="${esc(c.valore ?? '')}"
        ${c.placeholder ? `placeholder="${esc(c.placeholder)}"` : ''}>`;
    }
    return `<div class="mcampo">
      <label for="mc_${esc(c.id)}">${esc(c.etichetta)}</label>
      ${campo}
      ${c.aiuto ? `<span class="maiuto">${esc(c.aiuto)}</span>` : ''}</div>`;
  }).join('');

  return apri(`
    <form method="dialog" class="mbox">
      <h3>${esc(titolo)}</h3>
      ${testo ? `<p class="mtesto">${esc(testo)}</p>` : ''}
      <div class="mcampi">${corpo}</div>
      <div class="mazioni">
        <button type="button" class="chip" data-annulla>${esc(annulla)}</button>
        <button type="submit" class="btn" data-ok>${esc(ok)}</button>
      </div>
    </form>`,
    (d, chiudi) => {
      d.querySelector('form').addEventListener('submit', e => {
        e.preventDefault();
        const out = {};
        for (const c of campi) {
          const el = d.querySelector('#mc_' + CSS.escape(c.id));
          out[c.id] = c.tipo === 'numero' ? (parseInt(el.value, 10) || 0) : el.value.trim();
          if (c.obbligatorio && !String(out[c.id]).length) { el.focus(); return; }
        }
        chiudi(out);
      });
    });
}

/** Una domanda sì/no. Restituisce true o false. */
export function conferma({ titolo, testo, ok = 'Conferma', annulla = 'Annulla', pericolo = false }) {
  return apri(`
    <div class="mbox">
      <h3>${esc(titolo)}</h3>
      ${testo ? `<p class="mtesto">${esc(testo)}</p>` : ''}
      <div class="mazioni">
        <button type="button" class="chip" data-annulla>${esc(annulla)}</button>
        <button type="button" class="btn${pericolo ? ' pericolo' : ''}" data-si autofocus>${esc(ok)}</button>
      </div>
    </div>`,
    (d, chiudi) => { d.querySelector('[data-si]').onclick = () => chiudi(true); })
    .then(v => v === true);
}

/** Un messaggio con un solo pulsante. */
export function avvisa({ titolo, testo, ok = 'Ho capito' }) {
  return apri(`
    <div class="mbox">
      <h3>${esc(titolo)}</h3>
      ${testo ? `<p class="mtesto">${esc(testo)}</p>` : ''}
      <div class="mazioni"><button type="button" class="btn" data-annulla autofocus>${esc(ok)}</button></div>
    </div>`);
}

/** Messaggio breve in basso, per le conferme che non meritano una finestra. */
export function toast(messaggio) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = messaggio;
  el.classList.add('on');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('on'), 2400);
}

/**
 * Salvataggio automatico: raccoglie le modifiche e salva quando ci si ferma.
 * Restituisce { tocca, subito, inCorso }.
 */
export function autosalva(salva, attesa = 1500) {
  let timer = null, inVolo = false, ancora = false;

  const esegui = async () => {
    if (inVolo) { ancora = true; return; }
    inVolo = true;
    try { await salva(); } finally {
      inVolo = false;
      if (ancora) { ancora = false; esegui(); }
    }
  };

  return {
    tocca() { clearTimeout(timer); timer = setTimeout(esegui, attesa); },
    subito() { clearTimeout(timer); return esegui(); },
    get inCorso() { return inVolo; },
  };
}

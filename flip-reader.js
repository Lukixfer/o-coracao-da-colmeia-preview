(() => {
  // Helpers
  const qs = (s, el=document) => el.querySelector(s);
  const qsa = (s, el=document) => [...el.querySelectorAll(s)];
  const params = new URLSearchParams(location.search);
  const lang = (params.get('lang') || 'pt').toLowerCase().startsWith('en') ? 'en' : 'pt';

  // i18n labels
  const I18N = {
    pt: { cap: 'Capítulo', stdReader: 'Leitor padrão', page: 'Página' },
    en: { cap: 'Chapter', stdReader: 'Standard reader', page: 'Page' }
  };

  // Apply language labels
  document.documentElement.lang = lang === 'en' ? 'en' : 'pt-br';
  qsa('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const t = I18N[lang]?.[key];
    if (t) el.textContent = t;
  });
  const std = qs('#openStdReader');
  if (std) std.href = `reader.html${lang==='en' ? '?lang=en' : ''}`;
  const wip = qs('#wipTag');
  if (wip && lang==='en') { wip.style.display = 'inline-block'; }

  // Theme
  const root = document.documentElement;
  const THEME_KEY = 'colmeia-theme';
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme) root.setAttribute('data-theme', savedTheme);
  qs('#themeToggle').addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
  });

  // Font size controls
  const FONT_KEY = 'colmeia-fontsize';
  const base = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const clamp = (v,min,max)=>Math.min(Math.max(v,min),max);
  const applyFont = (px)=>{
    document.documentElement.style.setProperty('--reader-font-size', `${px/base}rem`);
  };
  const savedFont = parseFloat(localStorage.getItem(FONT_KEY));
  if (!isNaN(savedFont)) applyFont(savedFont);
  // Repaginar após mudança de fonte (ver função repaginateCurrent mais abaixo)
  qs('#fontInc').addEventListener('click', ()=>{ const cur=parseFloat(getComputedStyle(qs('.content')||document.documentElement).fontSize)||16; const next=clamp(cur+1, 12, 24); applyFont(next); localStorage.setItem(FONT_KEY, String(next)); repaginateCurrent(); });
  qs('#fontDec').addEventListener('click', ()=>{ const cur=parseFloat(getComputedStyle(qs('.content')||document.documentElement).fontSize)||16; const next=clamp(cur-1, 12, 24); applyFont(next); localStorage.setItem(FONT_KEY, String(next)); repaginateCurrent(); });

  // Chapter sources
  const MAX = 6; // using 1..6 previews
  const CH_SRC = (n) => lang==='en' ? `./chapters-en/OSDB${n}_en.txt` : `./chapters/OSDB${n}.txt`;

  // Chapter select options
  const chSel = qs('#chapterSelect');
  for (let i=1;i<=MAX;i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `${I18N[lang].cap} ${i}`;
    chSel.appendChild(opt);
  }

  // Book state
  let pages = []; // array of HTMLElements (.page)
  let pageIndex = 0; // current visible page index
  let currentChapter = { n: 1, title: '', paragraphs: [] };

  const book = qs('#book');
  const pageCurrent = qs('#pageCurrent');
  const pageTotal = qs('#pageTotal');

  function formatTextToHTML(raw) {
    // Primeira linha é o título; corpo em parágrafos preservando quebras duplas
    const lines = raw.replace(/\r\n?/g,'\n').split('\n');
    const title = (lines[0]||'').trim();
    const body = lines.slice(1).join('\n');
    // Regras:
    // - Duplas quebras = novo parágrafo
    // - Linhas com travessão no início viram parágrafo de diálogo com indentação pendente
    // - Linhas começando com '>' viram blockquote
    // - Linhas contendo apenas '---' viram separador horizontal
    const rawParas = body.replace(/\n{3,}/g, '\n\n').split(/\n\n+/).map(p=>p.trim()).filter(Boolean);
    const paragraphs = rawParas.map(p => {
      if (/^\s*---\s*$/.test(p)) return '<hr class="hr" />';
      if (p.startsWith('>')) {
        const inner = p.replace(/^>\s?/gm,'').replace(/\n+/g,' ').trim();
        return `<blockquote>${inner}</blockquote>`;
      }
      // Normaliza travessão
      const normalized = p.split('\n').map(l => l.replace(/^[−–—-]\s*/, '— ').trim()).join(' ').trim();
      if (/^—\s/.test(normalized)) {
        return `<p class="dialogue"><span class="dialogue">${normalized}</span></p>`;
      }
      return `<p>${normalized}</p>`;
    });
    return { title, paragraphs };
  }

  function paginateWithTitle(title, paragraphs) {
    // Paginação por parágrafo com cabeçalho opcional na primeira página.
    // Evita criar página apenas com título e move o título para a próxima página quando necessário.
    const result = [];
    const titleHTML = `<h2>${title}</h2><div class="hr"></div>`;

    // Elemento de medição
    const probe = document.createElement('div');
    probe.className = 'page';
    probe.style.visibility = 'hidden';
    probe.innerHTML = `<div class="paper-grad"></div><div class="content"></div>`;
    book.appendChild(probe);
    const content = qs('.content', probe);

    let i = 0; // índice do parágrafo atual
    let firstPage = true;
    let carryTitleToNext = false; // se true, próxima página exibirá o título

    const buildPage = (withTitle) => {
      content.innerHTML = '';
      let headerEl = null;
      if (withTitle) {
        const header = document.createElement('div');
        header.innerHTML = titleHTML;
        headerEl = header;
        content.appendChild(header);
      }
      const body = document.createElement('div');
      // Reservar altura do corpo considerando o cabeçalho
      // Ajustaremos após inserir para medir corretamente
      content.appendChild(body);
      // Calcular altura disponível para o corpo
      const totalH = content.clientHeight;
      const headH = headerEl ? headerEl.offsetHeight : 0;
      body.style.height = `${Math.max(0, totalH - headH)}px`;
      body.style.overflow = 'hidden';
      return { body, headerPresent: !!headerEl };
    };

    const commitPage = (pageHTML, headerPresent) => {
      // Não criar página sem conteúdo de parágrafos
      if (!pageHTML || pageHTML.length === 0) return;
      const pageEl = document.createElement('div');
      pageEl.className = 'page';
      const headerMarkup = headerPresent ? titleHTML : '';
      pageEl.innerHTML = `<div class="paper-grad"></div><div class="content">${headerMarkup}${pageHTML.join('')}</div>`;
      result.push(pageEl);
    };

    // Tenta dividir um HTML de parágrafo para caber no espaço restante do body
    // Retorna { fittedHTML, remainderHTML } ou null se nada couber
    const splitParagraphToFit = (html, body) => {
      // HR não divide; blockquote e p dividem por palavras
      const isHR = /^<hr\b/i.test(html);
      if (isHR) return null;

      // Identificar tag e classe
      let tag = 'p';
      let cls = '';
      if (/^<blockquote\b/i.test(html)) tag = 'blockquote';
      if (/^<p\b[^>]*class=\"dialogue\"/i.test(html)) { tag = 'p'; cls = 'dialogue'; }

      // Extrair texto simples
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const fullText = (tmp.textContent || '').trim();
      if (!fullText) return null;

      const words = fullText.split(/\s+/);
      let lo = 0, hi = words.length, best = 0;
      const test = document.createElement(tag);
      if (cls) test.className = cls;

      // Busca binária do maior prefixo que cabe
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        test.textContent = words.slice(0, mid).join(' ');
        // Inserir para medir
        body.appendChild(test);
        const fits = body.scrollHeight <= body.clientHeight;
        body.removeChild(test);
        if (fits) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
      }

      if (best <= 0) return null;

      // Construir elementos finais
      const fittedNode = document.createElement(tag);
      if (cls) fittedNode.className = cls;
      fittedNode.textContent = words.slice(0, best).join(' ');
      body.appendChild(fittedNode);

      const remainderWords = words.slice(best);
      const remainderText = remainderWords.join(' ');
      const remainderHTML = remainderText ? (tag === 'blockquote'
        ? `<blockquote>${remainderText}</blockquote>`
        : (cls ? `<p class="dialogue">${remainderText}</p>` : `<p>${remainderText}</p>`)) : '';

      return { fittedHTML: body.lastChild.outerHTML, remainderHTML };
    };

    while (i < paragraphs.length) {
      // Define se esta página mostrará título
      const showTitle = firstPage && !carryTitleToNext ? true : (carryTitleToNext ? true : false);
      // Após usar a bandeira carry, limpamos
      carryTitleToNext = false;

      const { body, headerPresent } = buildPage(showTitle);
      const pageHTML = [];
      let addedAny = false;

      // Tentar preencher a página com parágrafos
      while (i < paragraphs.length) {
        const html = paragraphs[i];
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        body.appendChild(wrapper);
        if (body.scrollHeight > body.clientHeight) {
          // Estourou: remover e finalizar a página
          body.removeChild(wrapper);
          if (!addedAny) {
            // Nenhum parágrafo coube nesta página.
            if (headerPresent && firstPage) {
              // Caso especial: título + nenhum parágrafo coube na primeira página.
              // Solução: mover o título para a próxima página e recomputar esta página sem título.
              carryTitleToNext = true; // próxima página terá título
              // Reconfigurar a página atual sem título e tentar novamente com o mesmo parágrafo
              const rebuilt = buildPage(false);
              const body2 = rebuilt.body;
              // tentar adicionar o parágrafo sem o cabeçalho
              body2.appendChild(wrapper);
              if (body2.scrollHeight > body2.clientHeight) {
                // Mesmo sem título, parágrafo não cabe inteiro. Não vamos quebrá-lo; empurraremos para a página seguinte.
                // Tentar dividir o parágrafo para caber parcialmente
                const split = splitParagraphToFit(html, body2);
                if (split && split.fittedHTML) {
                  pageHTML.push(split.fittedHTML);
                  addedAny = true;
                  // Se sobrar, substitui o atual paragraphs[i] pelo restante
                  if (split.remainderHTML) {
                    paragraphs[i] = split.remainderHTML;
                  } else {
                    i++; // consumiu tudo
                  }
                  // Atualiza o body visível para body2
                  content.innerHTML = '';
                  content.appendChild(body2);
                } else {
                  // Nem divisão ajudou; não cria página vazia, segue para próxima página
                  break;
                }
              } else {
                // Coube sem título; comitar página sem título com este parágrafo
                pageHTML.push(html);
                addedAny = true;
                // Substituir body atual por body2 para continuar preenchendo
                content.innerHTML = '';
                content.appendChild(body2);
              }
            } else {
              // Não é a primeira página com título; não cabe nada aqui — não criar página e tentar em próxima.
              break;
            }
          } else {
            // Já havia conteúdo; finaliza página e tenta na próxima
            // Antes de quebrar, tentar dividir o parágrafo para aproveitar espaço restante
            const split = splitParagraphToFit(html, body);
            if (split && split.fittedHTML) {
              pageHTML.push(split.fittedHTML);
              // Se sobrou, mantém o restante para próxima página sem avançar i
              if (split.remainderHTML) {
                paragraphs[i] = split.remainderHTML;
              } else {
                i++;
              }
            }
            break;
          }
        } else {
          pageHTML.push(html);
          addedAny = true;
          i++; // consumimos este parágrafo
        }
      }

      if (addedAny) {
        commitPage(pageHTML, showTitle && !carryTitleToNext);
        firstPage = false;
      } else {
        // Nada foi adicionado; evitar loop infinito
        // Segurança: se um parágrafo é maior que a página inteira, forçamos movê-lo sozinho para a próxima página sem título
        // (deixando a quebra para o navegador, embora overflow hidden impeça exibição parcial)
        // Para não travar, avançamos o índice e comitamos mesmo assim.
        const fallback = paragraphs[i];
        commitPage([fallback], false);
        i++;
        firstPage = false;
      }
    }

    // remover probe
    book.removeChild(probe);
    return result;
  }

  function renderBook(title, pagesEls) {
    book.innerHTML = '';
    pages = pagesEls;
    pageIndex = 0;

    pages.forEach((p, i) => {
      p.style.zIndex = String(100 - i);
      if (i < pageIndex) p.classList.add('is-flipped');
      if (i === pageIndex) p.classList.add('is-current');
      book.appendChild(p);
    });

    updatePageInfo();
  }

  function updatePageInfo() {
    pageCurrent.textContent = String(pageIndex + 1);
    pageTotal.textContent = String(pages.length || 1);
  }

  function goNext() {
    if (pageIndex >= pages.length - 1) return;
    const p = pages[pageIndex];
    p.classList.add('is-flipped');
    p.classList.remove('is-current');
    pageIndex++;
    const next = pages[pageIndex];
    next.classList.add('is-current');
    updatePageInfo();
  }

  function goPrev() {
    if (pageIndex <= 0) return;
    const current = pages[pageIndex];
    current.classList.remove('is-current');
    pageIndex--;
    const prev = pages[pageIndex];
    prev.classList.remove('is-flipped');
    prev.classList.add('is-current');
    updatePageInfo();
  }

  // Controls
  qs('#next').addEventListener('click', goNext);
  qs('#prev').addEventListener('click', goPrev);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') goNext();
    if (e.key === 'ArrowLeft') goPrev();
  });

  // Load chapter
  async function loadChapter(n) {
    try {
      let res = await fetch(CH_SRC(n));
      if (!res.ok) {
        // fallback: try local chapters-en (in case of different hosting layout)
        res = await fetch(`./chapters-en/OSDB${n}_en.txt`);
      }
      const txt = await res.text();
      const { title, paragraphs } = formatTextToHTML(txt);
      const theTitle = title || `${I18N[lang].cap} ${n}`;
      currentChapter = { n, title: theTitle, paragraphs };
      const pagesEls = paginateWithTitle(theTitle, paragraphs);
      renderBook(theTitle, pagesEls);
    } catch (err) {
      console.error(err);
      book.innerHTML = `<div class="page"><div class="content"><p>Erro ao carregar capítulo.</p></div></div>`;
    }
  }

  chSel.addEventListener('change', () => loadChapter(Number(chSel.value)));

  // Initial chapter (from ?ch=)
  const start = Math.min(Math.max(parseInt(params.get('ch')||'1',10) || 1, 1), MAX);
  chSel.value = String(start);
  loadChapter(start);

  // Repaginação ao redimensionar a janela (debounced)
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => repaginateCurrent(true), 150);
  });

  // Recria as páginas do capítulo atual; se keepPosition, tenta preservar a posição relativa
  function repaginateCurrent(keepPosition=false) {
    if (!currentChapter || !currentChapter.paragraphs || !currentChapter.paragraphs.length) return;
    const prevTotal = pages.length || 1;
    const prevIndex = pageIndex;
    const newPages = paginateWithTitle(currentChapter.title, currentChapter.paragraphs);
    // Heurística: manter proporção da página
    let newIndex = 0;
    if (keepPosition && prevTotal > 0) {
      const ratio = prevIndex / prevTotal;
      newIndex = Math.max(0, Math.min(newPages.length-1, Math.round(ratio * newPages.length)));
    }
    renderBook(currentChapter.title, newPages);
    pageIndex = Math.max(0, Math.min(pages.length-1, newIndex));
    // Ajustar classes visuais após setar pageIndex
    pages.forEach(p => { p.classList.remove('is-current'); });
    if (pages[pageIndex]) pages[pageIndex].classList.add('is-current');
    updatePageInfo();
  }
})();

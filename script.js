const DATA_VERSION = "1.0"; 
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
    import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
    import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

    const firebaseConfig = {
      apiKey: "AIzaSyB7zUjd4yGPvJkd_dZxy7gADHmNK7UUe-I",
      authDomain: "pokemon-tcg-sp.firebaseapp.com",
      projectId: "pokemon-tcg-sp",
      storageBucket: "pokemon-tcg-sp.firebasestorage.app",
      messagingSenderId: "898774636210",
      appId: "1:898774636210:web:c385cc8df48aecd2c55bab"
    };

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const ADMIN_UID = "PZt2BWoC0TMjFOmDKH8DkfoEj6z2";

    const $ = (s) => document.querySelector(s);
    const state = { 
      user: null, 
      collections: {}, 
      pokedexSpecies: [], 
      pokedexCardsBySpecies: {}, 
      representatives: {}, 
      currentCollection: null, 
      unsubscribeMap: {},
      searchQuery: "",
      pokedexSearch: "",
      currentView: "albums"
    };

    // --- UTILITÁRIOS ---
    
    function getBaseName(fullName) {
      if (!fullName) return "";
      return fullName.replace(/\s(ex|GX|VMAX|VSTAR|V|Tera|TAG\sTEAM|EX|Prime|LEGEND|ex\sTera|LV\.X)\b/gi, '').trim();
    }

    // --- AUTENTICAÇÃO ---
    $("#login-btn").addEventListener("click", async () => {
      const email = $("#login-email").value;
      const pass = $("#login-pass").value;
      $("#login-error").classList.add("hidden");
      try { await signInWithEmailAndPassword(auth, email, pass); } catch (err) { $("#login-error").classList.remove("hidden"); }
    });
    $("#logout-btn").addEventListener("click", () => signOut(auth));

    onAuthStateChanged(auth, (user) => {
      if (user && user.uid === ADMIN_UID) {
        state.user = user;
        $("#login-screen").classList.add("hidden");
        $("#main-content").classList.remove("hidden");
        loadData();
        attachPokedexPrefsListener();
      } else {
        state.user = null;
        $("#login-screen").classList.remove("hidden");
        $("#main-content").classList.add("hidden");
        Object.values(state.unsubscribeMap).forEach(unsub => unsub());
        state.unsubscribeMap = {};
      }
    });

    // --- NAVEGAÇÃO ---
    document.querySelectorAll(".view-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        const view = tab.dataset.view;
        state.currentView = view;
        document.querySelectorAll(".view-tab").forEach(t => t.className = "view-tab px-4 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition");
        tab.className = "view-tab px-4 py-1.5 rounded-lg text-xs font-medium transition bg-sky-500 text-slate-950";
        
        if (view === "albums") {
          $("#view-albums").classList.remove("hidden");
          $("#view-pokedex").classList.add("hidden");
        } else {
          $("#view-albums").classList.add("hidden");
          $("#view-pokedex").classList.remove("hidden");
          renderPokedex();
        }
      });
    });

    // --- PESQUISA ---
    $("#card-search").addEventListener("input", (e) => { state.searchQuery = e.target.value.toLowerCase(); renderCards(); });
    $("#pokedex-search").addEventListener("input", (e) => { state.pokedexSearch = e.target.value.toLowerCase(); renderPokedex(); });

    // --- LÓGICA DE DADOS ---
    

async function loadData() {
  // 1. Tenta pegar os dados salvos no navegador do utilizador
  const cachedVersion = localStorage.getItem("pokemon_data_version");
  const cachedTCG = localStorage.getItem("tcg_data");
  const cachedPokedex = localStorage.getItem("pokedex_data");

  // 2. Verifica se existem e se a versão é a mesma
  if (cachedVersion === DATA_VERSION && cachedTCG && cachedPokedex) {
    console.log("⚡ Carregando dados do Cache (Modo Rápido)...");
    try {
      // Converte o texto salvo de volta para objetos JSON
      state.pokedexSpecies = JSON.parse(cachedPokedex);
      processTCGJson(JSON.parse(cachedTCG));
      return; // Sai da função aqui, economizando internet
    } catch (e) {
      console.warn("Cache corrompido, baixando novamente...");
      // Se der erro, o código continua para o download abaixo
    }
  }

  // 3. Se não tiver cache ou a versão for antiga, baixa da internet
  console.log("🌐 Baixando dados atualizados do servidor...");
  try {
    const [tcgRes, pokedexRes] = await Promise.all([
      fetch("./TCG_CARD.json"),
      fetch("./pokedex.json")
    ]);

    const tcgJson = await tcgRes.json();
    const pokedexJson = await pokedexRes.json();
    
    // Ordena a pokedex antes de salvar (para economizar processamento futuro)
    const sortedPokedex = pokedexJson.sort((a, b) => a.id - b.id);

    // 4. Salva os novos dados no LocalStorage para a próxima vez
    try {
      localStorage.setItem("tcg_data", JSON.stringify(tcgJson));
      localStorage.setItem("pokedex_data", JSON.stringify(sortedPokedex));
      localStorage.setItem("pokemon_data_version", DATA_VERSION);
      console.log("✅ Dados salvos no cache com sucesso!");
    } catch (e) {
      console.warn("⚠️ Não foi possível salvar no cache (provavelmente limite de espaço atingido). O site funcionará, mas sem modo offline.");
    }

    // Atualiza o estado da aplicação
    state.pokedexSpecies = sortedPokedex;
    processTCGJson(tcgJson);

  } catch (e) { 
    console.error("Erro fatal ao carregar arquivos JSON:", e); 
    alert("Erro ao carregar dados. Verifique sua conexão.");
  }
}

    function processTCGJson(json) {
      state.pokedexCardsBySpecies = {};
      const speciesMap = {};
      state.pokedexSpecies.forEach(s => {
        speciesMap[s.name.english.toLowerCase()] = s.name.english;
        state.pokedexCardsBySpecies[s.name.english] = [];
      });

      // Identifica TODAS as coleções presentes no JSON dinamicamente
      const dynamicCollections = new Set();
      json.forEach(card => {
        const baseName = getBaseName(card.Pokemon).toLowerCase();
        const officialName = speciesMap[baseName];
        if (officialName) state.pokedexCardsBySpecies[officialName].push(card);
        
        if (card.Coleção) dynamicCollections.add(card.Coleção);
      });

      // Cria os álbuns baseados nas coleções encontradas
      Array.from(dynamicCollections).sort().forEach(name => {
        const filteredCards = json.filter(c => c.Coleção === name);
        const id = name.replace(/\s/g, '').toLowerCase();
        
        if (!state.collections[id]) {
          state.collections[id] = { name, cards: filteredCards, owned: new Set() };
          attachCollectionListener(id);
        }
      });
      
      renderAlbums();
      renderPokedex();
    }

    function attachCollectionListener(colId) {
      const docRef = doc(db, "artifacts", firebaseConfig.appId, "users", ADMIN_UID, "collections", colId);
      if (state.unsubscribeMap[colId]) state.unsubscribeMap[colId]();
      
      state.unsubscribeMap[colId] = onSnapshot(docRef, (snap) => {
        const data = snap.data() || {};
        if (state.collections[colId]) {
           state.collections[colId].owned = new Set(Object.keys(data).filter(k => data[k]));
           if (state.currentCollection === colId) renderCards();
           renderAlbums();
           updateGlobalProgress();
           if (state.currentView === 'pokedex') renderPokedex();
        }
      }, (err) => console.error(`Erro na coleção ${colId}:`, err));
    }

    function attachPokedexPrefsListener() {
      const docRef = doc(db, "artifacts", firebaseConfig.appId, "users", ADMIN_UID, "pokedex_prefs", "representatives");
      onSnapshot(docRef, (snap) => {
        state.representatives = snap.data() || {};
        if (state.currentView === 'pokedex') renderPokedex();
      }, (err) => console.error("Erro nas preferências da Pokedex:", err));
    }

    // --- RENDERIZADORES ---

    function renderAlbums() {
      const grid = $("#albums-grid"); grid.innerHTML = "";
      // Ordena alfabeticamente para ficar organizado
      Object.keys(state.collections).sort().forEach(id => {
        const col = state.collections[id];
        const pct = Math.round((col.owned.size / col.cards.length) * 100) || 0;
        const btn = document.createElement("button");
        btn.className = "group p-5 bg-slate-800/50 border border-slate-700 rounded-2xl text-left hover:border-sky-500 transition shadow-xl";
        btn.innerHTML = `<div class="flex justify-between items-start mb-4"><h4 class="font-bold text-sky-400">${col.name}</h4><span class="text-[10px] bg-slate-700 px-2 py-1 rounded-md text-slate-300">${pct}%</span></div><p class="text-xs text-slate-400">${col.owned.size} / ${col.cards.length} obtidas</p><div class="mt-3 w-full h-1.5 bg-slate-700 rounded-full overflow-hidden"><div class="h-full bg-sky-500" style="width: ${pct}%"></div></div>`;
        btn.onclick = () => { state.currentCollection = id; state.searchQuery = ""; $("#card-search").value = ""; $("#details-title").textContent = col.name; $("#collection-details").classList.remove("hidden"); renderCards(); };
        grid.appendChild(btn);
      });
    }

    function renderCards() {
  const grid = document.querySelector("#cards-grid"); 
  grid.innerHTML = "";
  
  const col = state.collections[state.currentCollection];
  const filtered = col.cards.filter(c => c.Pokemon.toLowerCase().includes(state.searchQuery) || c.Número.includes(state.searchQuery));
  
  // Atualiza contadores (código existente...)
  document.querySelector("#details-subtitle").textContent = `${col.owned.size} obtidas de ${col.cards.length} totais`;
  document.querySelector("#details-progress-bar").style.width = `${(col.owned.size / col.cards.length) * 100}%`;

  filtered.forEach(card => {
    const cardId = `${card.Coleção}#${card.Número}`;
    const isOwned = col.owned.has(cardId);
    
    // Cria o container
    const container = document.createElement("div");
    // Note que adicionei a classe 'card-container' e removi 'hologram' e 'card-3d'
    container.className = `flex flex-col gap-2 items-center bg-slate-900/40 p-2 rounded-2xl border border-slate-800 hover:border-slate-700 transition`;

    // HTML interno do card
    container.innerHTML = `
      <div class="card-container relative w-full aspect-[3/4] cursor-pointer transition ${isOwned ? '' : 'grayscale opacity-40'}">
         <img src="${card.Imagem}" class="w-full h-full object-cover rounded-xl border ${isOwned ? 'border-sky-500/50' : 'border-slate-800'}" loading="lazy">
         <div class="absolute bottom-0 inset-x-0 p-2 bg-black/60 backdrop-blur-sm rounded-b-xl opacity-0 hover:opacity-100 transition text-center z-30">
            <p class="text-[8px] font-bold truncate">${card.Pokemon}</p>
         </div>
      </div>
      <div class="flex items-center justify-between w-full px-1">
         <span class="text-[9px] font-mono text-slate-500">#${card.Número}</span>
         <div class="pokeball-toggle ${isOwned ? 'active' : ''}"></div>
      </div>
    `;

    // Seleciona o elemento que terá o efeito holográfico
    const holoCard = container.querySelector('.card-container');

    if (isOwned) {
        // --- LÓGICA MATEMÁTICA DO CODEPEN (Adaptada) ---
        holoCard.addEventListener('mousemove', (e) => {
            const rect = holoCard.getBoundingClientRect();
            
            // Posição do mouse relativa ao card
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const w = rect.width;
            const h = rect.height;

            // Math do CodePen original (Inversão de eixos e cálculos de brilho)
            const px = Math.abs(Math.floor(100 / w * x) - 100);
            const py = Math.abs(Math.floor(100 / h * y) - 100);
            const pa = (50 - px) + (50 - py);

            // Posições dos gradientes e background
            const lp = (50 + (px - 50) / 1.5);
            const tp = (50 + (py - 50) / 1.5);
            const px_spark = (50 + (px - 50) / 7);
            const py_spark = (50 + (py - 50) / 7);
            const p_opc = 20 + (Math.abs(pa) * 1.5);

            // Injeta as variáveis CSS dinamicamente
            holoCard.classList.add("active");
            holoCard.style.setProperty('--grad-pos-x', `${lp}%`);
            holoCard.style.setProperty('--grad-pos-y', `${tp}%`);
            holoCard.style.setProperty('--spark-pos-x', `${px_spark}%`);
            holoCard.style.setProperty('--spark-pos-y', `${py_spark}%`);
            holoCard.style.setProperty('--opacity', `${p_opc / 100}`);
        });

        holoCard.addEventListener('mouseleave', () => {
            holoCard.classList.remove("active");
            holoCard.removeAttribute("style"); // Limpa os estilos inline
        });
        
        // Eventos de clique (mantidos do original)
        holoCard.onclick = () => openModal(card, cardId, isOwned);
    }

    container.querySelector('.pokeball-toggle').onclick = (e) => { e.stopPropagation(); toggleCard(cardId, isOwned); };
    grid.appendChild(container);
  });
}

    function renderPokedex() {
      const grid = $("#pokedex-grid"); grid.innerHTML = "";
      const filteredSpecies = state.pokedexSpecies.filter(s => 
        s.name.english.toLowerCase().includes(state.pokedexSearch) || 
        s.id.toString().includes(state.pokedexSearch)
      );

      filteredSpecies.forEach(species => {
        const name = species.name.english;
        const tcgCards = state.pokedexCardsBySpecies[name] || [];
        const ownedCards = tcgCards.filter(c => {
          const cid = `${c.Coleção}#${c.Número}`;
          const colId = c.Coleção.replace(/\s/g, '').toLowerCase();
          return state.collections[colId]?.owned.has(cid);
        });

        const hasAny = ownedCards.length > 0;
        let displayImage = species.image.thumbnail;
        
        if (hasAny) {
          const repId = state.representatives[name];
          const favoriteCard = ownedCards.find(c => `${c.Coleção}#${c.Número}` === repId);
          displayImage = favoriteCard ? favoriteCard.Imagem : ownedCards[0].Imagem;
        }

        const card = document.createElement("button");
        card.className = `relative flex flex-col items-center p-4 rounded-3xl border-2 transition transform hover:scale-105 pokedex-card-bg ${hasAny ? 'border-slate-600 shadow-[0_10px_30px_rgba(0,0,0,0.5)]' : 'grayscale opacity-30 border-slate-800'}`;
        card.innerHTML = `
          <div class="absolute top-2 left-2 pokedex-number-badge">#${species.id.toString().padStart(3, '0')}</div>
          <div class="w-full aspect-square mb-3 flex items-center justify-center relative">
            <img src="${displayImage}" class="max-h-full max-w-full object-contain drop-shadow-2xl">
            ${hasAny ? '<i class="fa-solid fa-circle-check absolute -bottom-1 -right-1 text-emerald-400 text-lg bg-slate-900 rounded-full"></i>' : ''}
          </div>
          <p class="text-[10px] font-black uppercase text-center truncate w-full tracking-wider text-slate-100">${name}</p>
          <p class="text-[8px] text-slate-500 font-bold">${ownedCards.length}/${tcgCards.length} Cards</p>
        `;
        card.onclick = () => openPokedexModal(species);
        grid.appendChild(card);
      });
    }

    // --- LOGICA POKEDEX MODAL ---

    function openPokedexModal(species) {
      const name = species.name.english;
      const tcgCards = state.pokedexCardsBySpecies[name] || [];
      
      $("#pokedex-modal-name").textContent = name;
      $("#pokedex-modal-id").textContent = `#${species.id.toString().padStart(3, '0')}`;
      
      const container = $("#pokedex-cards-container");
      container.innerHTML = "";

      if (tcgCards.length === 0) {
        container.innerHTML = `<div class="col-span-full py-20 text-center text-slate-500"><i class="fa-solid fa-box-open text-4xl mb-4"></i><p>Nenhum card TCG deste Pokémon encontrado.</p></div>`;
      }

      tcgCards.forEach(card => {
        const cardId = `${card.Coleção}#${card.Número}`;
        const colId = card.Coleção.replace(/\s/g, '').toLowerCase();
        const isOwned = state.collections[colId]?.owned.has(cardId);
        const isFav = state.representatives[name] === cardId;

        const cardEl = document.createElement("div");
        cardEl.className = `relative flex flex-col gap-2 p-3 bg-slate-800/40 rounded-2xl border-2 transition ${isFav ? 'border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.2)]' : 'border-slate-700 opacity-60 hover:opacity-100'}`;
        cardEl.innerHTML = `
          <div class="relative group aspect-[3/4] mb-2 overflow-hidden rounded-lg">
             <img src="${card.Imagem}" class="w-full h-full object-cover">
             <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-3">
                <button class="set-fav-btn flex items-center gap-2 px-3 py-1.5 bg-amber-400 text-slate-950 rounded-lg text-[10px] font-bold hover:bg-amber-300 transition">
                  <i class="fa-solid fa-star"></i> Favorito
                </button>
                <button class="zoom-card-btn flex items-center gap-2 px-3 py-1.5 bg-sky-500 text-slate-950 rounded-lg text-[10px] font-bold hover:bg-sky-400 transition">
                  <i class="fa-solid fa-magnifying-glass-plus"></i> Ampliar
                </button>
             </div>
          </div>
          <div class="space-y-1">
            <p class="text-[9px] text-slate-100 font-bold truncate">${card.Pokemon}</p>
            <p class="text-[8px] text-sky-400 font-medium truncate uppercase tracking-wider italic opacity-80">${card.Coleção}</p>
            <div class="flex items-center justify-between pt-1">
              <span class="text-[8px] text-slate-500 font-mono">#${card.Número}</span>
              <div class="pokeball-toggle sm ${isOwned ? 'active' : ''}"></div>
            </div>
          </div>
        `;
        
        cardEl.querySelector('.set-fav-btn').onclick = (e) => { e.stopPropagation(); setPokedexRepresentative(name, cardId); };
        cardEl.querySelector('.zoom-card-btn').onclick = (e) => { e.stopPropagation(); openModal(card, cardId, isOwned); };
        cardEl.querySelector('.pokeball-toggle').onclick = (e) => { e.stopPropagation(); toggleCard(cardId, isOwned); };
        container.appendChild(cardEl);
      });

      $("#pokedex-modal").classList.remove("hidden");
      $("#pokedex-modal").classList.add("flex");
    }

    $("#pokedex-modal-close").onclick = () => $("#pokedex-modal").classList.add("hidden");

    async function setPokedexRepresentative(pokemonName, cardId) {
      const docRef = doc(db, "artifacts", firebaseConfig.appId, "users", ADMIN_UID, "pokedex_prefs", "representatives");
      await setDoc(docRef, { [pokemonName]: cardId }, { merge: true });
    }

    // --- UTILITÁRIOS ---

    async function toggleCard(cardId, isOwned) {
      const colId = cardId.split('#')[0].replace(/\s/g, '').toLowerCase();
      const docRef = doc(db, "artifacts", firebaseConfig.appId, "users", ADMIN_UID, "collections", colId);
      await setDoc(docRef, { [cardId]: !isOwned }, { merge: true });
    }

    function openModal(card, cardId, isOwned) {
  // Preencher dados básicos
  const titleEl = document.querySelector("#modal-title");
  const imgEl = document.querySelector("#modal-image");
  const numEl = document.querySelector("#modal-number");
  const wrapper = document.querySelector("#modal-card-wrapper"); // Seleciona o novo wrapper

  titleEl.textContent = card.Pokemon;
  imgEl.src = card.Imagem;
  numEl.textContent = `Nº ${card.Número} | ${card.Coleção}`;

  // Mostrar o modal
  const modal = document.querySelector("#card-modal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");

  // Configurar botão
  const btn = document.querySelector("#modal-toggle-btn");
  btn.textContent = isOwned ? "Remover da Coleção" : "Adicionar à Coleção";
  // Resetar classes do botão para garantir o estilo
  btn.className = "w-full py-4 text-lg bg-sky-500 text-slate-950 font-black rounded-2xl hover:bg-sky-400 transition shadow-xl shadow-sky-500/20 active:scale-95";
  
  btn.onclick = async () => { 
      await toggleCard(cardId, isOwned); 
      modal.classList.add("hidden"); 
  };

  // --- LÓGICA HOLOGRÁFICA DO MODAL ---
  
  // Reseta estados anteriores
  wrapper.classList.remove("active");
  wrapper.removeAttribute("style");
  
  // Se tivermos a carta, iniciamos a lógica
  if (isOwned) {
      // 1. Adiciona a animação automática assim que abre
      wrapper.classList.add("auto-holo");

      wrapper.onmousemove = (e) => {
          // 2. Remove a animação automática quando o usuário interage
          wrapper.classList.remove("auto-holo");
          wrapper.classList.add("active");

          const rect = wrapper.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          
          // Cálculo matemático (igual ao anterior)
          const w = rect.width;
          const h = rect.height;
          const px = Math.abs(Math.floor(100 / w * x) - 100);
          const py = Math.abs(Math.floor(100 / h * y) - 100);
          const pa = (50 - px) + (50 - py);
          const lp = (50 + (px - 50) / 1.5);
          const tp = (50 + (py - 50) / 1.5);
          const px_spark = (50 + (px - 50) / 7);
          const py_spark = (50 + (py - 50) / 7);
          const p_opc = 20 + (Math.abs(pa) * 1.5);

          wrapper.style.setProperty('--grad-pos-x', `${lp}%`);
          wrapper.style.setProperty('--grad-pos-y', `${tp}%`);
          wrapper.style.setProperty('--spark-pos-x', `${px_spark}%`);
          wrapper.style.setProperty('--spark-pos-y', `${py_spark}%`);
          wrapper.style.setProperty('--opacity', `${p_opc / 100}`);
      };

      wrapper.onmouseleave = () => {
          // 3. Ao tirar o mouse, volta para a animação automática
          wrapper.classList.remove("active");
          wrapper.removeAttribute("style"); // Limpa estilos inline manuais
          wrapper.classList.add("auto-holo"); // Reativa o loop automático
      };
  } else {
      // Se não tem a carta, garante que não anima
      wrapper.classList.remove("auto-holo");
      wrapper.onmousemove = null;
      wrapper.onmouseleave = null;
  }
}

    $("#modal-close").onclick = () => $("#card-modal").classList.add("hidden");

    function updateGlobalProgress() {
      let total = 0, owned = 0;
      Object.values(state.collections).forEach(c => { total += c.cards.length; owned += c.owned.size; });
      const pct = Math.round((owned / total) * 100) || 0;
      $("#global-progress").classList.remove("hidden");
      $("#global-progress-bar").style.width = `${pct}%`;
      $("#global-progress-text").textContent = `${pct}%`;
    }

    $("#file-input").onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const text = await file.text(); processTCGJson(JSON.parse(text));
    };
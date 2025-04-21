// Sélection des éléments du DOM
const audioPlayer = document.getElementById('audio-player');
const playBtn = document.getElementById('play');
const pauseBtn = document.getElementById('pause');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const playlistItems = document.getElementById('playlist-items');
const fileInput = document.getElementById('file-input');
const clearPlaylistBtn = document.getElementById('clear-playlist');
const progressBar = document.getElementById('progress-bar');
const timeDisplay = document.getElementById('time-display');
const currentTrackDisplay = document.getElementById('current-track');
const currentTrackCover = document.getElementById('current-track-cover'); // Pochette actuelle
const volumeSlider = document.getElementById('volume-slider');
const shuffleBtn = document.getElementById('shuffle');
const repeatBtn = document.getElementById('repeat');

// Variables d'état
let currentTrackIndex = 0;
let playlist = []; // Contiendra { id, title, artist, album, pictureUrl, src, blob }
let isShuffle = false;
let repeatMode = 0; // 0: Pas de répétition, 1: Répéter un, 2: Répéter tout
const DB_NAME = 'MusicPlayerDB';
const DB_VERSION = 3; // Incrémenter si structure change (ajout index, changement keyPath...)
const STORE_NAME = 'tracks';
const PLACEHOLDER_IMAGE = 'placeholder.png'; // Chemin vers l'image par défaut
const themeSelector = document.querySelector('.theme-selector');
const themeButtons = themeSelector ? themeSelector.querySelectorAll('button[data-theme]') : [];
const THEME_STORAGE_KEY = 'musicPlayerTheme'; // Clé pour localStorage
const volumeIcon = document.getElementById('volume-icon');

// Vérification initiale des éléments essentiels
if (!audioPlayer || !playBtn || !pauseBtn || !currentTrackCover || !playlistItems || !fileInput || !progressBar) {
  console.error('Éléments DOM essentiels manquants. Le script ne peut pas continuer.');
  // Afficher une erreur à l'utilisateur pourrait être utile ici
  // document.body.innerHTML = "Erreur critique : Impossible de charger l'interface du lecteur.";
}

// --- Gestion IndexedDB ---

// Fonction pour ouvrir la base de données
function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
        console.warn("IndexedDB n'est pas supporté par ce navigateur.");
        return reject(new Error("IndexedDB non supporté"));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      console.log(`Mise à niveau IndexedDB vers version ${DB_VERSION}`);
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // Utiliser 'id' comme clé serait plus robuste que 'title'
        // mais pour rester simple pour l'instant, on garde 'title'.
        // Si vous changez pour 'id', modifiez ici : { keyPath: 'id' }
        // et assurez-vous que 'id' est unique.
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'title' });
         // Optionnel : Ajouter des index pour faciliter recherches/tris futurs
         store.createIndex('id', 'id', { unique: true }); // Index sur notre ID unique
         store.createIndex('artist', 'artist', { unique: false });
         console.log(`Object store "${STORE_NAME}" créé.`);
      } else {
         // Si le store existe, on peut vérifier/ajouter des index si besoin
         const transaction = event.target.transaction;
         const store = transaction.objectStore(STORE_NAME);
         if (!store.indexNames.contains('id')) {
             store.createIndex('id', 'id', { unique: true });
             console.log("Index 'id' ajouté.");
         }
          if (!store.indexNames.contains('artist')) {
             store.createIndex('artist', 'artist', { unique: false });
              console.log("Index 'artist' ajouté.");
         }
      }
    };

    request.onerror = (event) => {
      console.error('Erreur IndexedDB:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      console.log('Base de données ouverte avec succès.');
      resolve(event.target.result);
    };
  });
}

// Charger la playlist depuis IndexedDB au démarrage
async function loadInitialPlaylist() {
    try {
        const db = await openDatabase();
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            const loadedTracks = request.result;
            console.log(`${loadedTracks.length} pistes brutes chargées depuis IndexedDB.`);
            playlist = loadedTracks.map(trackData => {
                let audioSrc = null;
                if (trackData.blob instanceof Blob) {
                    try {
                        audioSrc = URL.createObjectURL(trackData.blob);
                    } catch (e) {
                        console.error(`Erreur création URL Object pour ${trackData.title}:`, e);
                    }
                } else {
                    console.warn(`Blob manquant pour la piste: ${trackData.title}`);
                }
                // Retourner l'objet piste pour la playlist en mémoire
                return {
                    id: trackData.id,
                    title: trackData.title,
                    artist: trackData.artist,
                    album: trackData.album,
                    pictureUrl: trackData.pictureUrl || PLACEHOLDER_IMAGE, // Assurer une valeur
                    src: audioSrc,
                    blob: trackData.blob
                };
            }).filter(track => track.src !== null); // Garder seulement les pistes valides

            console.log('Playlist reconstituée:', playlist);
            renderPlaylist(); // Afficher la playlist chargée
            if (playlist.length > 0) {
                updatePlayingStatus(); // Met à jour l'info de la piste 0 (sans la jouer)
            } else {
                updateTrackInfoDisplay(null); // Afficher état vide
            }
        };

        request.onerror = (err) => {
            console.error('Erreur récupération pistes IndexedDB:', err);
            playlist = [];
            renderPlaylist();
            updateTrackInfoDisplay(null);
        };
    } catch (err) {
        console.error('Erreur ouverture DB au chargement:', err);
        playlist = [];
        renderPlaylist();
        updateTrackInfoDisplay(null);
    }
}

// --- Lecture des métadonnées ---

function readMetadata(file) {
  return new Promise((resolve) => { // Ne rejette plus, retourne des défauts
    if (typeof jsmediatags === 'undefined') {
      console.warn("jsmediatags non chargé. Utilisation du nom de fichier.");
      resolve({
        title: file.name.replace(/\.[^/.]+$/, ""), // Nom fichier sans extension
        artist: 'Inconnu',
        album: 'Inconnu',
        pictureUrl: PLACEHOLDER_IMAGE
      });
      return;
    }

    jsmediatags.read(file, {
      onSuccess: (tag) => {
        const tags = tag.tags;
        let pictureUrl = PLACEHOLDER_IMAGE; // Défaut

        if (tags.picture) {
          try {
            const { data, format } = tags.picture;
            let base64String = "";
            for (let i = 0; i < data.length; i++) {
              base64String += String.fromCharCode(data[i]);
            }
            pictureUrl = `data:${format};base64,${window.btoa(base64String)}`;
            console.log(`Pochette trouvée pour: ${tags.title || file.name}`);
          } catch (e) {
            console.error(`Erreur traitement image pour ${tags.title || file.name}:`, e);
            pictureUrl = PLACEHOLDER_IMAGE; // Revenir au défaut en cas d'erreur
          }
        } else {
            // console.log(`Aucune pochette trouvée pour: ${tags.title || file.name}`);
        }

        resolve({
          title: tags.title || file.name.replace(/\.[^/.]+$/, ""),
          artist: tags.artist || 'Inconnu',
          album: tags.album || 'Inconnu',
          pictureUrl: pictureUrl
        });
      },
      onError: (error) => {
        console.warn(`Erreur lecture métadonnées (${error.type}) pour: ${file.name}. Utilisation nom fichier. Info: ${error.info}`);
        resolve({
          title: file.name.replace(/\.[^/.]+$/, ""),
          artist: 'Inconnu',
          album: 'Inconnu',
          pictureUrl: PLACEHOLDER_IMAGE
        });
      }
    });
  });
}


// --- Gestion de la Playlist ---

// Afficher la playlist dans le DOM
function renderPlaylist() {
  playlistItems.innerHTML = ''; // Vider
  if (playlist.length === 0) {
      playlistItems.innerHTML = '<li style="color: #b0b0d0; font-style: italic; cursor: default;">Playlist vide. Ajoutez des fichiers.</li>';
  } else {
    playlist.forEach((track, index) => {
      const li = document.createElement('li');
      li.dataset.index = index; // Stocker l'index

      // Pochette
      const img = document.createElement('img');
      img.src = track.pictureUrl || PLACEHOLDER_IMAGE;
      img.alt = 'Pochette';
      img.onerror = () => { img.src = PLACEHOLDER_IMAGE; }; // Fallback si URL invalide

      // Infos texte
      const span = document.createElement('span');
      span.textContent = `${track.artist} - ${track.title}`;
      span.title = `${track.artist} - ${track.title} (${track.album})`; // Info-bulle complète

      // Bouton Supprimer
      const deleteBtn = document.createElement('button');
      deleteBtn.innerHTML = '<i class="fas fa-times"></i>';
      deleteBtn.className = 'delete-btn';
      deleteBtn.title = 'Supprimer';
      deleteBtn.addEventListener('click', (event) => {
        event.stopPropagation(); // Empêche le clic de jouer la piste
        deleteTrack(index);
      });

      // Clic sur l'élément li pour jouer
      li.addEventListener('click', () => {
        playTrack(index);
      });

      li.appendChild(img);
      li.appendChild(span);
      li.appendChild(deleteBtn);
      playlistItems.appendChild(li);
    });
  }
  // Mettre à jour le style de la piste en cours après le rendu
  updatePlayingStatusHighlight();
}

// Ajouter des fichiers à la playlist et à IndexedDB
fileInput.addEventListener('change', async (event) => {
  const files = event.target.files;
  if (!files.length) return;

  currentTrackDisplay.textContent = "Analyse des fichiers..."; // Feedback
  const originalPlaylistLength = playlist.length;
  let filesAddedCount = 0;

  try {
    const db = await openDatabase();
    const tracksToAdd = []; // Pour ajout groupé à la playlist en mémoire

    for (const file of files) {
       if (!file.type.startsWith('audio/')) {
           console.warn(`Fichier ignoré (pas audio): ${file.name}`);
           continue;
       }
      console.log(`Traitement: ${file.name}`);
      try {
        const metadata = await readMetadata(file);
        // Générer un ID plus fiable que le titre
        const trackId = `${metadata.artist}-${metadata.album}-${metadata.title}-${file.size}-${file.lastModified}`;

        // Vérifier si une piste avec le même ID existe déjà (pour éviter doublons stricts)
         const existingTrackIndexById = playlist.findIndex(t => t.id === trackId);
         // Vérifier aussi par titre (comportement actuel)
         const existingTrackIndexByTitle = playlist.findIndex(t => t.title === metadata.title);

        if (existingTrackIndexByTitle !== -1) {
             console.warn(`Piste "${metadata.title}" existe déjà (basé sur le titre), ignorée.`);
            continue; // Ignorer si le titre existe déjà
        }
        // if (existingTrackIndexById !== -1) {
        //      console.warn(`Piste avec ID "${trackId}" existe déjà, ignorée.`);
        //     continue; // Ignorer si ID exact existe
        // }


        // Création de l'objet piste pour la mémoire (src sera créé au besoin)
        const track = {
          id: trackId,
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          pictureUrl: metadata.pictureUrl,
          src: null, // Sera créé plus tard si nécessaire ou au chargement
          blob: file // Garder le blob pour IndexedDB
        };
        tracksToAdd.push(track); // Ajouter à la liste temporaire

      } catch (readError) {
        console.error(`Erreur lecture métadonnées pour ${file.name}:`, readError);
      }
    } // Fin boucle for files

    // Ajouter les nouvelles pistes à IndexedDB et à la playlist mémoire
    if (tracksToAdd.length > 0) {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        let dbOperations = []; // Promesses pour les ajouts DB

        tracksToAdd.forEach(track => {
            // Préparer l'objet pour DB (sans src temporaire)
            const trackDataToStore = {
                id: track.id,
                title: track.title, // Clé actuelle
                artist: track.artist,
                album: track.album,
                pictureUrl: track.pictureUrl,
                blob: track.blob
            };
             // Utiliser put pour ajouter ou mettre à jour (basé sur la clé 'title')
            const requestPromise = new Promise((resolve, reject) => {
                 const request = store.put(trackDataToStore);
                 request.onsuccess = () => {
                     // Créer l'URL source maintenant qu'on est sûr de l'ajouter
                     track.src = URL.createObjectURL(track.blob);
                     playlist.push(track); // Ajouter à la playlist mémoire seulement si DB ok
                     filesAddedCount++;
                     resolve();
                 };
                 request.onerror = (e) => {
                    console.error(`Erreur ajout DB pour ${track.title}:`, e.target.error);
                    reject(e.target.error); // Rejeter la promesse de cette opération
                 };
            });
            dbOperations.push(requestPromise);
        });

        // Attendre la fin de la transaction DB
         await new Promise((resolve, reject) => {
             transaction.oncomplete = () => {
                 console.log(`${filesAddedCount} piste(s) ajoutée(s) avec succès à DB et playlist.`);
                 resolve();
             };
             transaction.onerror = (err) => {
                 console.error('Erreur transaction IndexedDB:', err);
                 // Ici, la playlist mémoire peut être partiellement mise à jour.
                 // Idéalement, il faudrait annuler les ajouts mémoire si la transaction échoue.
                 // Pour simplifier, on log l'erreur.
                 reject(err);
             };
             // Attendre toutes les opérations put individuelles (même si oncomplete suffit théoriquement)
             Promise.all(dbOperations).catch(e => {}); // Gérer les erreurs individuelles pour ne pas bloquer oncomplete/onerror

         });


        renderPlaylist(); // Mettre à jour l'affichage
        // Jouer la première piste ajoutée si la playlist était vide avant ajout
        if (originalPlaylistLength === 0 && playlist.length > 0) {
            playTrack(0);
        } else {
            updatePlayingStatus(); // Mettre à jour l'affichage de la piste actuelle (si elle n'a pas changé)
        }
    } else {
         console.log("Aucune nouvelle piste à ajouter.");
         updatePlayingStatus(); // Rétablir l'affichage normal
    }

  } catch (err) {
    console.error('Erreur globale lors de l\'ajout de fichiers:', err);
    updatePlayingStatus(); // Rétablir affichage normal
  } finally {
     fileInput.value = null; // Permet de re-sélectionner les mêmes fichiers
     // Remettre un message par défaut si rien ne joue après l'opération
     if (audioPlayer.paused && playlist.length === 0) {
         updateTrackInfoDisplay(null);
     } else if (audioPlayer.paused && playlist.length > 0) {
         updateTrackInfoDisplay(playlist[currentTrackIndex]);
     }
  }
});

// Supprimer une piste
async function deleteTrack(index) {
  if (index < 0 || index >= playlist.length) return;

  const trackToDelete = playlist[index];
  console.log(`Tentative suppression: ${trackToDelete.title}`);

  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    // Supprimer par la clé (qui est 'title' actuellement)
    const request = store.delete(trackToDelete.title);

    await new Promise((resolve, reject) => {
        request.onsuccess = () => {
            console.log(`Piste "${trackToDelete.title}" supprimée de IndexedDB.`);
            resolve();
        };
        request.onerror = (err) => {
            console.error(`Erreur suppression DB pour ${trackToDelete.title}:`, err);
            reject(err); // Empêche la suppression de la playlist mémoire si DB échoue
        };
    });

    // Si la suppression DB réussit, mettre à jour la playlist mémoire et l'UI
    const deletedTrackSrc = playlist[index].src; // Récupérer l'URL avant splice
    playlist.splice(index, 1);

    // Révoquer l'URL Blob pour libérer la mémoire
    if (deletedTrackSrc) {
        URL.revokeObjectURL(deletedTrackSrc);
        console.log(`URL Object révoquée pour: ${trackToDelete.title}`);
    }

    // Gérer l'index de la piste courante
    if (playlist.length === 0) {
      audioPlayer.pause();
      audioPlayer.src = '';
      currentTrackIndex = 0;
      updateTrackInfoDisplay(null);
    } else {
      if (currentTrackIndex === index) {
        // Si la piste supprimée était en cours de lecture
        // Jouer la piste suivante (ou la première si c'était la dernière)
        currentTrackIndex = index % playlist.length; // Reste au même index (qui est maintenant la suivante) ou revient à 0
        playTrack(currentTrackIndex);
      } else if (currentTrackIndex > index) {
        // Si une piste avant celle en cours a été supprimée
        currentTrackIndex--; // Décrémenter l'index
        updatePlayingStatus(); // Mettre à jour l'affichage sans relancer la lecture
      } else {
           // Si une piste après celle en cours a été supprimée, l'index reste bon
           updatePlayingStatus();
      }
    }
    renderPlaylist(); // Mettre à jour l'affichage de la liste

  } catch (err) {
    console.error('Erreur lors de la suppression de la piste:', err);
    // Afficher une notification d'erreur à l'utilisateur ?
  }
}

// Vider toute la playlist
clearPlaylistBtn.addEventListener('click', async () => {
  if (playlist.length === 0) return; // Ne rien faire si déjà vide

  if (confirm('Voulez-vous vraiment vider toute la playlist ?')) {
    console.log('Vidage de la playlist...');
    try {
      const db = await openDatabase();
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear(); // Vider le store IndexedDB

      await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve();
          request.onerror = (err) => reject(err);
      });

      // Révoquer toutes les URLs Blob existantes
      playlist.forEach(track => {
          if (track.src) URL.revokeObjectURL(track.src);
      });

      // Réinitialiser l'état
      playlist = [];
      audioPlayer.pause();
      audioPlayer.src = '';
      progressBar.value = 0;
      timeDisplay.textContent = '0:00 / 0:00';
      currentTrackIndex = 0;
      isShuffle = false; // Optionnel: réinitialiser shuffle/repeat
      repeatMode = 0;
      shuffleBtn.classList.remove('active');
      repeatBtn.classList.remove('active');
      updateTrackInfoDisplay(null);
      renderPlaylist();
      console.log('Playlist vidée.');

    } catch (err) {
      console.error('Erreur lors du vidage de la playlist:', err);
    }
  }
});

// --- Contrôles du Lecteur ---

// Jouer une piste spécifique
function playTrack(index) {
  if (playlist.length === 0 || index < 0 || index >= playlist.length) {
    console.log('Playlist vide ou index invalide.');
    audioPlayer.pause();
    updateTrackInfoDisplay(null);
    return;
  }

  currentTrackIndex = index;
  const track = playlist[currentTrackIndex];

  if (!track.src) {
      console.warn(`Source manquante pour ${track.title}, tentative de recréation...`);
      if(track.blob instanceof Blob) {
          try {
              track.src = URL.createObjectURL(track.blob);
          } catch (e) {
               console.error(`Impossible de recréer l'URL pour ${track.title}`, e);
               // Passer à la suivante pourrait être une option ici
               nextTrack();
               return;
          }
      } else {
          console.error(`Blob manquant, impossible de jouer ${track.title}`);
          // Passer à la suivante ?
           nextTrack();
          return;
      }
  }


  console.log(`Lecture piste ${currentTrackIndex}: ${track.artist} - ${track.title}`);
  if (audioPlayer.src !== track.src) {
      audioPlayer.src = track.src;
  }
  audioPlayer.play().catch(err => {
    console.error('Erreur de lecture:', err);
    // Gérer l'erreur, peut-être essayer la piste suivante ?
  });
  updatePlayingStatus(); // Met à jour l'UI (pochette, titre, highlight)
}

// Mettre à jour l'affichage des informations de la piste actuelle
function updateTrackInfoDisplay(track) {
    if (track) {
        currentTrackDisplay.textContent = `${track.artist} - ${track.title}`;
        currentTrackCover.src = track.pictureUrl || PLACEHOLDER_IMAGE;
        currentTrackCover.onerror = () => { currentTrackCover.src = PLACEHOLDER_IMAGE; };
        document.title = `${track.artist} - ${track.title}`; // Met à jour le titre de la page
    } else {
        currentTrackDisplay.textContent = 'Aucune piste sélectionnée';
        currentTrackCover.src = PLACEHOLDER_IMAGE;
        document.title = 'Lecteur de Musique'; // Titre par défaut
    }
}

// Mettre à jour le surlignage dans la playlist et l'état play/pause
function updatePlayingStatusHighlight() {
    const items = playlistItems.querySelectorAll('li[data-index]');
    items.forEach(item => {
        const itemIndex = parseInt(item.dataset.index, 10);
        if (itemIndex === currentTrackIndex && !audioPlayer.paused) {
            item.classList.add('playing');
        } else {
            item.classList.remove('playing');
        }
    });

    // Mettre à jour les boutons Play/Pause
    if (audioPlayer.paused) {
        playBtn.style.display = 'inline-flex'; // Ou 'flex'
        pauseBtn.style.display = 'none';
    } else {
        playBtn.style.display = 'none';
        pauseBtn.style.display = 'inline-flex'; // Ou 'flex'
    }
}

// Mettre à jour l'état complet (info + highlight)
function updatePlayingStatus() {
    const track = playlist[currentTrackIndex];
    updateTrackInfoDisplay(track);
    updatePlayingStatusHighlight();
}


// Formater le temps en MM:SS
function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
}

// Mise à jour de la barre de progression et du temps
audioPlayer.addEventListener('timeupdate', () => {
  if (audioPlayer.duration) {
    const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    progressBar.value = progress;
    const current = formatTime(audioPlayer.currentTime);
    const duration = formatTime(audioPlayer.duration);
    timeDisplay.textContent = `${current} / ${duration}`;
  } else {
    // Si duration n'est pas encore prête
    progressBar.value = 0;
    timeDisplay.textContent = `${formatTime(audioPlayer.currentTime)} / 0:00`;
  }
});

// Gestion de la fin de piste
audioPlayer.addEventListener('ended', () => {
  console.log('Piste terminée');
  progressBar.value = 0; // Réinitialiser visuellement
  // Ne pas remettre timeDisplay à 0:00 / 0:00, garder la durée finale

  if (repeatMode === 1) { // Répéter la piste actuelle
    console.log('Répétition piste unique');
    audioPlayer.currentTime = 0;
    audioPlayer.play().catch(e => console.error("Erreur replay:", e));
  } else { // Passer à la suivante (aléatoire ou normale), gère repeatMode 2 implicitement
    console.log('Passage à la piste suivante (auto)');
    nextTrack();
    // Si nextTrack ne joue rien (fin de playlist et pas de repeat all), l'état sera mis à jour par playTrack ou updatePlayingStatus
  }
});

// Gérer les erreurs de chargement de média
audioPlayer.addEventListener('error', (e) => {
    console.error("Erreur Audio Player:", audioPlayer.error, e);
    updateTrackInfoDisplay(null); // Indiquer une erreur
    currentTrackDisplay.textContent = "Erreur chargement piste";
    // Peut-être essayer de passer à la piste suivante ?
    // setTimeout(nextTrack, 1000); // Attendre 1s avant d'essayer la suivante
});


// Rendre la barre de progression cliquable
progressBar.addEventListener('click', (event) => {
  if (!audioPlayer.duration) return; // Ne rien faire si pas de durée

  const rect = progressBar.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const width = rect.width;
  const percentage = Math.max(0, Math.min(1, clickX / width)); // Assurer 0 <= percentage <= 1
  audioPlayer.currentTime = percentage * audioPlayer.duration;
  console.log(`Progression changée à ${formatTime(audioPlayer.currentTime)}`);
});

// Contrôle du volume
volumeSlider.addEventListener('input', () => {
  audioPlayer.volume = volumeSlider.value;
});

// Activer/désactiver lecture aléatoire
shuffleBtn.addEventListener('click', () => {
  isShuffle = !isShuffle;
  shuffleBtn.classList.toggle('active', isShuffle);
  console.log(`Lecture aléatoire ${isShuffle ? 'activée' : 'désactivée'}`);
});

// Changer le mode de répétition
repeatBtn.addEventListener('click', () => {
  repeatMode = (repeatMode + 1) % 3; // Cycle 0 -> 1 -> 2 -> 0
  repeatBtn.classList.toggle('active', repeatMode > 0); // Actif si 1 ou 2
  let title = 'Répéter';
  if (repeatMode === 1) title = 'Répéter piste unique';
  if (repeatMode === 2) title = 'Répéter toute la playlist';
  repeatBtn.title = title;
  console.log(`Mode répétition: ${title}`);
});

// Piste suivante
function nextTrack() {
  if (playlist.length === 0) return;

  let newIndex;
  if (isShuffle) {
    newIndex = Math.floor(Math.random() * playlist.length);
    // Éviter de rejouer la même piste en aléatoire si possible
    if (playlist.length > 1 && newIndex === currentTrackIndex) {
        newIndex = (currentTrackIndex + 1) % playlist.length; // Simple décalage pour éviter la répétition immédiate
    }
  } else {
    newIndex = currentTrackIndex + 1;
  }

  // Gérer la fin de playlist selon repeatMode
  if (newIndex >= playlist.length) {
      if (repeatMode === 2) { // Répéter tout
          newIndex = 0;
      } else {
          // Fin de playlist, pas de répétition
          console.log("Fin de la playlist.");
          audioPlayer.pause(); // Arrêter la lecture
          currentTrackIndex = 0; // Revenir au début pour la prochaine lecture manuelle
          progressBar.value = 100; // Indiquer la fin visuellement sur la barre
           // Ne pas appeler playTrack(0) automatiquement
           updatePlayingStatus(); // Mettre à jour l'UI pour refléter l'arrêt
          return; // Sortir de la fonction
      }
  }

  playTrack(newIndex);
}


// Piste précédente
function prevTrack() {
  if (playlist.length === 0) return;

  // Si la lecture est > 3 secondes, revenir au début de la piste actuelle
  if (audioPlayer.currentTime > 3 && !isShuffle) {
      audioPlayer.currentTime = 0;
      return;
  }

  let newIndex;
  if (isShuffle) {
    newIndex = Math.floor(Math.random() * playlist.length);
     // Éviter de rejouer la même piste en aléatoire si possible
    if (playlist.length > 1 && newIndex === currentTrackIndex) {
        newIndex = (currentTrackIndex - 1 + playlist.length) % playlist.length; // Simple décalage
    }
  } else {
    newIndex = currentTrackIndex - 1;
    if (newIndex < 0) {
        if (repeatMode === 2) { // Boucler si Répéter tout
            newIndex = playlist.length - 1;
        } else {
            // Revenir au début de la première piste si on est au début et pas de répétition
            audioPlayer.currentTime = 0;
             if (currentTrackIndex === 0) audioPlayer.pause(); // Mettre en pause si on était déjà sur la première
             updatePlayingStatus();
            return;
        }
    }
  }
  playTrack(newIndex);
}


// Écouteurs pour les boutons principaux
playBtn.addEventListener('click', () => {
  if (playlist.length === 0) {
      // Ouvrir le sélecteur de fichier si la playlist est vide ?
      // fileInput.click();
      return;
  }
  if (!audioPlayer.src && playlist.length > 0) {
      // Si aucune source n'est chargée (ex: après vidage ou au 1er lancement sans autoplay)
      playTrack(currentTrackIndex);
  } else {
      audioPlayer.play().catch(e => console.error("Erreur Play:", e));
  }
});

pauseBtn.addEventListener('click', () => {
  audioPlayer.pause();
});

nextBtn.addEventListener('click', nextTrack);
prevBtn.addEventListener('click', prevTrack);

// Raccourcis clavier (optionnel)
document.addEventListener('keydown', (e) => {
    // Ne pas déclencher si l'utilisateur tape dans un input, etc.
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
    }
    switch (e.code) {
        case 'Space': // Espace pour Play/Pause
             e.preventDefault(); // Empêche le scroll de la page
            if (audioPlayer.paused) {
                playBtn.click();
            } else {
                pauseBtn.click();
            }
            break;
        case 'ArrowRight': // Flèche droite pour Suivant
            nextBtn.click();
            break;
        case 'ArrowLeft': // Flèche gauche pour Précédent
            prevBtn.click();
            break;
        // Ajouter d'autres raccourcis si désiré (ex: volume)
    }
});


// --- Nouvelle fonction pour mettre à jour l'icône et le titre ---
//     (On la crée séparément pour la réutiliser si le volume slider atteint 0)
function updateVolumeIcon() {
    if (!volumeIcon || !audioPlayer) return; // Safety check

    if (audioPlayer.muted || audioPlayer.volume === 0) {
        volumeIcon.classList.remove('fa-volume-up');
        volumeIcon.classList.add('fa-volume-xmark'); // Icône Mute (pour Font Awesome 6)
        volumeIcon.title = 'Activer le son'; // Nouvelle info-bulle
    } else {
        volumeIcon.classList.remove('fa-volume-xmark');
        volumeIcon.classList.add('fa-volume-up');   // Icône Volume normal
        volumeIcon.title = 'Muet'; // Info-bulle initiale
    }
}

// --- Nouvelle fonction pour basculer le mute ---
function toggleMute() {
    if (!audioPlayer) return;
    audioPlayer.muted = !audioPlayer.muted; // Inverse l'état muet
    console.log(`Audio ${audioPlayer.muted ? 'muted' : 'unmuted'}`);
    updateVolumeIcon(); // Met à jour l'icône après avoir changé l'état

    // Optionnel: Si on désactive le mute, s'assurer que le volume n'est pas 0
    // (Sinon l'icône restera sur "mute" à cause de updateVolumeIcon)
    // Si le volume était 0 et qu'on un-mute, on pourrait le remettre à une valeur par défaut.
    // if (!audioPlayer.muted && audioPlayer.volume === 0) {
    //    audioPlayer.volume = 0.5; // Remettre un volume par défaut
    //    volumeSlider.value = 0.5; // Mettre à jour le slider aussi
    //    updateVolumeIcon(); // Re-mettre à jour l'icône car le volume a changé
    // }
}


// --- Ajout de l'écouteur d'événement pour l'icône volume ---
if (volumeIcon) {
    volumeIcon.addEventListener('click', toggleMute);
} else {
    console.warn("L'élément icône de volume (volume-icon) n'a pas été trouvé.");
}

// --- Modification de l'écouteur du slider de volume ---
volumeSlider.addEventListener('input', () => {
  audioPlayer.volume = volumeSlider.value;

  // Si l'utilisateur change le volume, on considère qu'il veut entendre quelque chose
  // donc on désactive le mute *sauf* s'il met le volume à 0.
  if (audioPlayer.volume > 0) {
      audioPlayer.muted = false; // Désactive le mute si le volume est > 0
  }

  updateVolumeIcon(); // Met à jour l'icône en fonction du nouveau volume et de l'état muet
});


// Écouteurs pour mettre à jour l'UI sur play/pause
audioPlayer.addEventListener('play', updatePlayingStatus);
audioPlayer.addEventListener('pause', updatePlayingStatus);

// --- NOUVEAU : Gestion des Thèmes ---

function applyTheme(themeName) {
  // Nettoyer les anciennes classes de thème du body
  // Assurez-vous d'inclure toutes les classes de thème possibles ici
  document.body.classList.remove('theme-light', 'theme-ocean', 'theme-forest');

  const effectiveTheme = themeName || 'default'; // Utiliser 'default' si null ou vide

  if (effectiveTheme !== 'default') {
    document.body.classList.add(effectiveTheme); // Appliquer la nouvelle classe si ce n'est pas le défaut
  }
  console.log(`Thème appliqué: ${effectiveTheme}`);

  // Mettre à jour le bouton actif visuellement
  themeButtons.forEach(btn => {
    if (btn.dataset.theme === effectiveTheme) {
        btn.classList.add('active-theme');
    } else {
        btn.classList.remove('active-theme');
    }
  });

  // Sauvegarder le choix
  try {
      // Sauvegarder 'default' explicitement aussi, ou le thème choisi
      localStorage.setItem(THEME_STORAGE_KEY, effectiveTheme);
  } catch (e) {
      console.warn("Impossible de sauvegarder le thème dans localStorage:", e);
  }
}

function loadSavedTheme() {
  let savedTheme = 'default'; // Thème par défaut
  try {
      // Récupérer le thème, s'il n'y en a pas, getItem retourne null, donc on utilise 'default'
      savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'default';
  } catch (e) {
      console.warn("Impossible de lire le thème depuis localStorage:", e);
      savedTheme = 'default'; // Revenir au défaut en cas d'erreur de lecture
  }
  // Appliquer le thème chargé (ou le défaut)
  applyTheme(savedTheme);
}

// Ajouter les écouteurs aux boutons de thème
if (themeButtons.length > 0) {
    themeButtons.forEach(button => {
      button.addEventListener('click', () => {
        const theme = button.dataset.theme; // Récupère la valeur de data-theme
        applyTheme(theme);
      });
    });
} else {
    console.warn("Sélecteur de thème non trouvé dans le DOM. Vérifiez le HTML et la sélection JS.");
}

// --- Initialisation (Modifiée pour charger le thème en premier) ---

// 1. Charger et appliquer le thème sauvegardé IMMÉDIATEMENT
loadSavedTheme();


// --- Initialisation ---
audioPlayer.volume = volumeSlider.value; // Volume initial
loadInitialPlaylist(); // Charger la playlist depuis IndexedDB au démarrage
// URL de votre Web App Apps Script (déploiement "Web App")
const scriptURL = 'https://script.google.com/macros/s/AKfycby47wFzKyuN5N_82DGX5uCds4VK8zgTdAWF2B9-sNMLGD8K8VTGcNcnT8dW7_48azeg/exec';

// Liste des numéros déjà réservés (sera remplie en appelant chargerStatuts)
const reservedNumbers = [];

// Prix d'un canard, en euros. Source unique côté front : utilisé pour tous
// les calculs ET pour les mentions de prix affichées (voir injectPrix()).
// À garder cohérent avec PRIX_CANARD côté back-end (GoogleSheet/Code.gs).
const PRIX_CANARD = 2;

// Paramètres de la grille : 17 lignes × 19 colonnes = 323 positions
const rows    = 17;
const cols    = 19;
const removed = [321, 322, 323]; // numéros retirés

// Références aux éléments du DOM
const reserveBtn    = document.getElementById('reserve-button');
const modal         = document.getElementById('duckModal');
const modalContent  = modal.querySelector('.modal-content');
const closeModalBtn = document.getElementById('closeModal');
const duckGrid      = document.getElementById('duckGrid');
const selectedSpan  = document.getElementById('selectedNumbers');
const totalSpan     = document.getElementById('totalCost');
const finaliserBtn  = document.getElementById('finaliser');
const commandeForm  = document.getElementById('commandeForm');
const modalBody     = document.getElementById('modalBody');
const loadError     = document.getElementById('loadError');
const loadingIndicator = document.getElementById('loadingIndicator');
const retryLoadBtn  = document.getElementById('retryLoad');

const confirmModal        = document.getElementById('confirmModal');
const confirmModalContent = confirmModal.querySelector('.content');
const closeConfirm        = document.getElementById('closeConfirm');
const confirmText         = document.getElementById('confirmText');

// Tableau de numéros sélectionnés par l’utilisateur
let selected = [];

/* ------------------- Fonctions ------------------- */

// --- Accessibilité des modales : ouverture/fermeture avec piège à focus,
// fermeture via Échap, et restauration du focus sur l'élément déclencheur. ---
let lastFocusedElement = null;

function getFocusableElements(container) {
  return Array.from(container.querySelectorAll(
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter(el => !el.disabled && el.offsetParent !== null);
}

function handleModalKeydown(e, modalEl, contentEl) {
  if (e.key === 'Escape') {
    closeModal(modalEl);
    return;
  }
  if (e.key !== 'Tab') return;
  const focusables = getFocusableElements(contentEl);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function openModal(modalEl, contentEl) {
  lastFocusedElement = document.activeElement;
  modalEl.style.display = 'block';
  contentEl.focus();
  modalEl._keydownHandler = (e) => handleModalKeydown(e, modalEl, contentEl);
  document.addEventListener('keydown', modalEl._keydownHandler);
}

function closeModal(modalEl) {
  modalEl.style.display = 'none';
  if (modalEl._keydownHandler) {
    document.removeEventListener('keydown', modalEl._keydownHandler);
    modalEl._keydownHandler = null;
  }
  if (lastFocusedElement) lastFocusedElement.focus();
}

// Permet d'activer au clavier (Entrée/Espace) un élément avec role="button"
// qui n'est pas un vrai <button> (ex : les <span class="close">).
function bindButtonKeyActivation(el) {
  el.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      el.click();
    }
  });
}
bindButtonKeyActivation(closeModalBtn);
bindButtonKeyActivation(closeConfirm);

// Renseigne toutes les mentions de prix de la page (.prix-canard) à partir de
// PRIX_CANARD, pour qu'une seule constante fasse foi. Le texte littéral présent
// dans le HTML sert de repli si le JS ne s'exécute pas.
function injectPrix() {
  document.querySelectorAll('.prix-canard').forEach(function (el) {
    el.textContent = PRIX_CANARD + ' €';
  });
}
injectPrix();

// Chargement des statuts depuis Google Sheets pour marquer les canards réservés
async function chargerStatuts() {
  reservedNumbers.length = 0;
  try {
    const response = await fetch(scriptURL);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const rowsData = await response.json();
    rowsData.forEach(row => {
      if (row.Statut && row.Statut.toLowerCase() !== 'disponible') {
        reservedNumbers.push(parseInt(row.Numero, 10));
      }
    });
    return true;
  } catch (err) {
    console.error('Erreur lors du chargement des statuts :', err);
    return false;
  }
}

// Charge les disponibilités et affiche soit la grille, soit un message d'erreur
// avec bouton "Réessayer". Tant que le chargement échoue, on ne sait pas quels
// canards sont réellement libres : on bloque la réservation. Un indicateur de
// chargement s'affiche pendant l'appel réseau.
async function chargerEtAfficherGrille() {
  modalBody.style.display = 'none';
  loadError.style.display = 'none';
  loadingIndicator.style.display = 'block';
  const ok = await chargerStatuts();
  loadingIndicator.style.display = 'none';
  if (!ok) {
    loadError.style.display = 'block';
    return;
  }
  modalBody.style.display = '';
  if (!duckGrid.dataset.generated) {
    generateGrid();
    duckGrid.dataset.generated = 'true';
  } else {
    refreshGridReservedState();
  }
}

// Affiche la modale principale et charge/génère la grille
reserveBtn.addEventListener('click', async function(e) {
  e.preventDefault();
  openModal(modal, modalContent);
  await chargerEtAfficherGrille();
});

// Permet de relancer le chargement après un échec
retryLoadBtn.addEventListener('click', chargerEtAfficherGrille);

// Fermer la modale principale
closeModalBtn.addEventListener('click', function() {
  closeModal(modal);
});

// Fermer les modales si on clique en dehors
window.addEventListener('click', function(e) {
  if (e.target === modal) {
    closeModal(modal);
  }
  if (e.target === confirmModal) {
    closeModal(confirmModal);
  }
});

// Génération de la grille cliquable
function generateGrid() {
  const gridWidth  = duckGrid.offsetWidth;
  const gridHeight = gridWidth * (rows / cols);
  duckGrid.style.height = gridHeight + 'px';

  for (let i = 1; i <= rows * cols; i++) {
    if (removed.includes(i)) continue;
    const div = document.createElement('div');
    div.classList.add('duck');
    div.dataset.num = i;

    const row = Math.floor((i - 1) / cols);
    const col = (i - 1) % cols;
    const wPercent = 100 / cols;
    const hPercent = 100 / rows;

    div.style.width  = wPercent + '%';
    div.style.height = hPercent + '%';
    div.style.left   = (col * wPercent) + '%';
    div.style.top    = (row * hPercent) + '%';

    if (reservedNumbers.includes(i)) {
      div.classList.add('reserved');
    }
    // Le CSS (.duck.reserved { pointer-events: none }) empêche déjà les clics
    // sur un canard réservé, donc le listener peut être attaché sans condition.
    div.addEventListener('click', function() {
      toggleSelection(i, div);
    });
    duckGrid.appendChild(div);
  }
}

// Met à jour visuellement la grille déjà générée selon reservedNumbers,
// sans la reconstruire (appelé après un chargement ou une réservation).
function refreshGridReservedState() {
  duckGrid.querySelectorAll('.duck').forEach(div => {
    const num = parseInt(div.dataset.num, 10);
    if (reservedNumbers.includes(num)) {
      div.classList.add('reserved');
      div.classList.remove('selected');
      const idx = selected.indexOf(num);
      if (idx > -1) selected.splice(idx, 1);
    } else {
      div.classList.remove('reserved');
    }
  });
  updateSummary();
}

// Sélection ou désélection d’un canard
function toggleSelection(num, el) {
  const index = selected.indexOf(num);
  if (index > -1) {
    selected.splice(index, 1);
    el.classList.remove('selected');
  } else {
    selected.push(num);
    el.classList.add('selected');
  }
  updateSummary();
}

// Mise à jour du récapitulatif et du montant total
function updateSummary() {
  if (selected.length === 0) {
    selectedSpan.textContent = 'aucun';
  } else {
    const sorted = selected.slice().sort((a,b) => a - b);
    selectedSpan.textContent = sorted.join(', ');
  }
  totalSpan.textContent = (selected.length * PRIX_CANARD) + ' €';
}

commandeForm.addEventListener('submit', async function (e) {
  e.preventDefault();
  // Empêche les clics multiples
  finaliserBtn.disabled = true;
  const originalText = finaliserBtn.textContent;
  finaliserBtn.textContent = 'Traitement en cours...';

  const emailInput = document.getElementById('email');
  const email = emailInput.value.trim();
  const paymentMethod = document.querySelector('input[name="paiement"]:checked')?.value;
  const notifyCheckbox = document.getElementById('notifyCheckbox');
  const prenomInput = document.getElementById('prenom');
  const nomInput = document.getElementById('nom');
  const participationCheckbox = document.getElementById('participation');
  const initiation = document.getElementById('initiation')?.checked || false;

  const prenom = prenomInput ? prenomInput.value.trim() : '';
  const nom = nomInput ? nomInput.value.trim() : '';
  const participation = participationCheckbox ? participationCheckbox.checked : false;
  const notifyNextYear = notifyCheckbox ? notifyCheckbox.checked : false;

  if (selected.length === 0) {
    alert("Veuillez sélectionner au moins un canard.");
    finaliserBtn.disabled = false;
    finaliserBtn.textContent = originalText;
    return;
  }

  if (!paymentMethod) {
    alert("Veuillez sélectionner un mode de paiement.");
    finaliserBtn.disabled = false;
    finaliserBtn.textContent = originalText;
    return;
  }

  const payload = {
    numeros: selected,
    prenom: prenom,
    nom: nom,
    email: email,
    participation: participation,
    moyenPaiement: paymentMethod,
    notifyNextYear: notifyNextYear,
    initiation: initiation,
  };

  // Pas de header Content-Type explicite : le corps part en text/plain,
  // ce qui évite le preflight CORS qu'Apps Script ne sait pas gérer.
  // Sur certains navigateurs (Firefox notamment), la lecture de la réponse
  // peut quand même échouer après la redirection interne d'Apps Script,
  // même si l'écriture a bel et bien réussi côté serveur : on ne traite donc
  // pas un échec de lecture comme un échec d'envoi, on vérifie l'état réel.
  let response = null;
  let lectureImpossible = false;
  try {
    response = await fetch(scriptURL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.warn("Réponse du serveur illisible (probable restriction du navigateur), vérification de secours :", err);
    lectureImpossible = true;
  }

  let confirmedNums;
  let takenNums;
  let depuisReponseServeur = false;

  if (!lectureImpossible && !response.ok) {
    console.error("Le serveur a renvoyé une erreur :", response.status);
    alert("Une erreur est survenue lors de l'enregistrement de votre réservation. Veuillez réessayer.");
    finaliserBtn.disabled = false;
    finaliserBtn.textContent = originalText;
    return;
  }

  if (!lectureImpossible) {
    try {
      const result = await response.json();
      confirmedNums = result.confirmed || [];
      takenNums = result.alreadyTaken || [];
      depuisReponseServeur = true;
    } catch (err) {
      console.warn("Réponse du serveur invalide, vérification de secours :", err);
    }
  }

  // Recharge les disponibilités à jour et met la grille visuellement en phase
  // (un autre canard peut avoir été pris pendant qu'on remplissait le formulaire).
  await chargerStatuts();

  if (!depuisReponseServeur) {
    // Vérification de secours : on déduit le résultat en comparant les numéros
    // demandés à l'état réel après envoi (réponse du serveur illisible).
    confirmedNums = selected.filter(num => reservedNumbers.includes(num));
    takenNums = selected.filter(num => !confirmedNums.includes(num));
  }

  refreshGridReservedState();

  if (confirmedNums.length === 0) {
    alert("Désolé, le(s) numéro(s) " + takenNums.join(', ') +
      " n'ont pas pu être réservé(s) (déjà pris ou erreur). Veuillez réessayer.");
    finaliserBtn.disabled = false;
    finaliserBtn.textContent = originalText;
    return;
  }

  closeModal(modal);
  showConfirmation(confirmedNums, takenNums, paymentMethod, email, notifyNextYear, initiation);
  selected = [];
  updateSummary();

  // Rétablir l’état du bouton
  finaliserBtn.disabled = false;
  finaliserBtn.textContent = originalText;
});



// Échappe les caractères HTML spéciaux pour éviter une injection (XSS)
// quand une valeur saisie par l'utilisateur est insérée via innerHTML.
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Construire et afficher le récapitulatif de confirmation
function showConfirmation(confirmedNums, takenNums, paymentMethod, email, notifyNextYear, initiation) {
  // Message de base avec les numéros triés
  let message  = "Vous avez réservé les canards : " +
    confirmedNums.slice().sort((a, b) => a - b).join(', ');

  // Avertissement si certains numeros demandes avaient deja ete pris entre-temps
  if (takenNums && takenNums.length > 0) {
    message += "<br><strong>Attention :</strong> certains numéros n'ont pas pu vous etre attribués (déjà réservés entre-temps).";
  }

  // Ajout du total
  message += "<br>Total : " + (confirmedNums.length * PRIX_CANARD) + " €";

  // Ajout de la méthode de paiement
  message += "<br>Méthode de paiement : " +
    (paymentMethod === 'virement' ? 'Par virement' : "En espèces le jour de l'évènement");

  // Si virement, ajouter les coordonnées bancaires
  if (paymentMethod === 'virement') {
    message += "<br><br><strong>Veuillez effectuer votre virement à :</strong><br>";
    message += "IBAN : BE04 0634 0580 8831<br>Communication : Course des canards + votre nom";
  }

  // Ajouter l'adresse e-mail
  message += "<br><br>Un e‑mail de confirmation sera envoyé à : " + escapeHtml(email);
  message += "<br><strong>(Attention : si vous ne recevez pas de mail, vérifiez vos spams !)</strong>";

  // Ajouter les options de notification
  if (notifyNextYear) {
    message += "<br>• Vous recevrez une invitation pour la prochaine édition.";
  }
  if (initiation) {
    message += "<br>• Vous recevrez une invitation pour une initiation au Dodgeball avec le DBC de Jodoigne ";
  }

  // Afficher le message dans la fenêtre de confirmation
  confirmText.innerHTML = message;
  openModal(confirmModal, confirmModalContent);
}


// Fermer la modale de confirmation
closeConfirm.addEventListener('click', function() {
  closeModal(confirmModal);
});

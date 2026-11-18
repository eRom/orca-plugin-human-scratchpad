---
status: implemented
date: 2026-11-18
---

# Prototype : l'enregistrement survit-il au démontage du panneau ?

## Résultat

- **Aucun événement de sortie n'arrive.** Quand la barre latérale droite passe à un autre panneau
  (`orca plugin open local.agent-profiles --panel agents`), l'iframe est détruite sans que `pagehide`,
  `visibilitychange` (vers `hidden`) ni `blur` se déclenchent : même un `localStorage.setItem` synchrone
  placé dans ces trois gestionnaires n'a jamais laissé de trace (10 itérations, relecture au montage suivant).
  `blur` n'a de toute façon aucune raison de partir sans focus dans le cadre, la CLI ne pouvant pas cliquer.
- **Mesure principale : 0/10.** Tampon fixé 300 ms après le chargement, démontage 1 s après l'ouverture,
  enregistrement uniquement sur les trois événements : le marqueur `spike-` n'est jamais arrivé dans le fichier.
- **Variante (étape 4) : 10/10.** Enregistrement 300 ms après la pose du tampon, démontage 400 ms après la pose
  (synchronisé sur la ligne `buffer-set` du fichier témoin). Aller-retour `write` mesuré : environ 10 ms.
  Une requête déjà partie au moment du démontage va à son terme côté worker (écriture synchrone).

Le journal console du panneau n'est pas relayé par `orca plugin logs` ni par `dev watch` : les événements
ont été tracés via un fichier témoin (requête `write` forcée) et `localStorage`.

## Commande

```
orca plugin dev reload . ; bun scripts/spike-unmount.ts          # mode events (0/10)
SPIKE_MODE=debounce SPIKE_EVENTS=<fichier témoin> bun scripts/spike-unmount.ts   # variante (10/10)
```

Le script, le panneau prototype et leurs sources ont été supprimés (jetables).

## Décision

`SAVE_DEBOUNCE_MS = 300` (`src/shared/limits.ts`). Il n'existe pas de vidage fiable au démontage :
la seule garantie est le débounce court. **Fenêtre de perte mesurée : une frappe est perdue si le panneau
est démonté moins de 300 ms (plus ~10 ms d'écriture) après la dernière frappe.** À soumettre à Romain avant
la tâche 6 (AC-4).

## À vérifier à la main (tâche 9)

Le cas « barre latérale fermée » (repli de la barre, pas un changement de panneau) n'est pas pilotable par la CLI.

Battu : garder 1000 ms avec vidage sur `pagehide`/`visibilitychange`/`blur` - ces événements ne partent pas au démontage.
